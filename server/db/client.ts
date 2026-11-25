import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

export function initDatabase(dataDir: string, adminEmail: string, adminPassword: string) {
  const dbPath = join(dataDir, "gdrives3.db");
  const sqlite = new Database(dbPath, { create: true });
  
  // Pragmas untuk performa tinggi dan konkurensi di SQLite
  sqlite.run("PRAGMA journal_mode = WAL;");
  sqlite.run("PRAGMA synchronous = NORMAL;");
  sqlite.run("PRAGMA foreign_keys = OFF;"); // Application-level integrity per blueprint

  // Drizzle instance
  const db = drizzle(sqlite, { schema });

  // Migrasi tabel otomatis (DDL idempotent)
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT NOT NULL,
      must_change_password INTEGER DEFAULT 0,
      role TEXT DEFAULT 'admin',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS drive_accounts (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      refresh_token TEXT NOT NULL,
      folder_id TEXT,
      weight INTEGER DEFAULT 1,
      storage_limit INTEGER DEFAULT 0,
      storage_usage INTEGER DEFAULT 0,
      daily_bytes INTEGER DEFAULT 0,
      daily_date TEXT,
      status TEXT DEFAULT 'connected',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS buckets (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS objects (
      id TEXT PRIMARY KEY,
      bucket_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      etag TEXT NOT NULL,
      content_type TEXT DEFAULT 'application/octet-stream',
      metadata TEXT,
      account_id TEXT,
      drive_file_id TEXT,
      parts TEXT,
      is_multipart INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS multipart_uploads (
      upload_id TEXT PRIMARY KEY,
      bucket_id TEXT NOT NULL,
      object_key TEXT NOT NULL,
      content_type TEXT DEFAULT 'application/octet-stream',
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS multipart_parts (
      id TEXT PRIMARY KEY,
      upload_id TEXT NOT NULL,
      part_number INTEGER NOT NULL,
      account_id TEXT NOT NULL,
      drive_file_id TEXT NOT NULL,
      size INTEGER NOT NULL,
      etag TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_multipart_parts ON multipart_parts(upload_id, part_number);

    CREATE TABLE IF NOT EXISTS s3_access_keys (
      id TEXT PRIMARY KEY,
      access_key_id TEXT UNIQUE NOT NULL,
      secret_hash TEXT NOT NULL,
      label TEXT,
      permissions TEXT DEFAULT 'read_write',
      allowed_buckets TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_drive_deletes (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      drive_file_id TEXT NOT NULL,
      object_key TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pending_deletes_account ON pending_drive_deletes(account_id);

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrasi kolom baru pada DB lama jika belum ada
  const keyCols = sqlite.query("PRAGMA table_info(s3_access_keys)").all() as { name: string }[];
  const keyColNames = new Set(keyCols.map((c) => c.name));
  if (!keyColNames.has("permissions")) {
    sqlite.run("ALTER TABLE s3_access_keys ADD COLUMN permissions TEXT DEFAULT 'read_write';");
  }
  if (!keyColNames.has("allowed_buckets")) {
    sqlite.run("ALTER TABLE s3_access_keys ADD COLUMN allowed_buckets TEXT;");
  }

  // Deduplikasi baris objek lama sebelum menegakkan UNIQUE INDEX pada (bucket_id, object_key)
  sqlite.run(`
    DELETE FROM objects
    WHERE rowid NOT IN (
      SELECT MAX(rowid) FROM objects GROUP BY bucket_id, object_key
    );
  `);
  const existingObjIdx = sqlite
    .query("SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_objects_bucket_key'")
    .get() as { sql?: string } | null;
  if (existingObjIdx?.sql && !existingObjIdx.sql.toUpperCase().includes("UNIQUE")) {
    sqlite.run("DROP INDEX IF EXISTS idx_objects_bucket_key;");
  }
  sqlite.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_objects_bucket_key ON objects(bucket_id, object_key);");

  // Seed Admin jika belum ada user
  const existing = db.select().from(schema.users).all();
  if (existing.length === 0) {
    const passwordHash = Bun.password.hashSync(adminPassword);
    const now = new Date().toISOString();
    db.insert(schema.users).values({
      id: crypto.randomUUID(),
      email: adminEmail,
      name: "Administrator",
      passwordHash,
      mustChangePassword: 1,
      role: "admin",
      createdAt: now,
      updatedAt: now,
    }).run();
    console.log(`[gdrives3-db] Seeded initial admin account: ${adminEmail}`);
  }

  return { db, sqlite };
}

export type AppDatabase = ReturnType<typeof initDatabase>["db"];
