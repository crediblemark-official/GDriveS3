import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { join } from "node:path";
import { asc, eq } from "drizzle-orm";
import * as schema from "./schema";

const DEFAULT_ADMIN_EMAIL = "admin@gdrives3.local";
const DEFAULT_ADMIN_PASSWORD = "change-me-now";
const ADMIN_SYNC_SETTING_KEY = "admin_env_sync_signature";

function computeAdminSyncSignature(email: string, password: string): string {
  return new Bun.CryptoHasher("sha256").update(`${email}\0${password}`).digest("hex");
}

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

  // Seed atau sinkronkan akun Admin jika env berubah
  const normalizedEmail = (adminEmail || DEFAULT_ADMIN_EMAIL).trim();
  const effectivePassword = adminPassword || DEFAULT_ADMIN_PASSWORD;
  const currentSig = computeAdminSyncSignature(normalizedEmail, effectivePassword);
  const mustChange = effectivePassword === DEFAULT_ADMIN_PASSWORD ? 1 : 0;
  const now = new Date().toISOString();

  const existing = db
    .select()
    .from(schema.users)
    .orderBy(asc(schema.users.createdAt))
    .all();

  if (existing.length === 0) {
    const passwordHash = Bun.password.hashSync(effectivePassword);
    db.insert(schema.users).values({
      id: crypto.randomUUID(),
      email: normalizedEmail,
      name: "Administrator",
      passwordHash,
      mustChangePassword: mustChange,
      role: "admin",
      createdAt: now,
      updatedAt: now,
    }).run();
    db.insert(schema.systemSettings)
      .values({ key: ADMIN_SYNC_SETTING_KEY, value: currentSig })
      .onConflictDoUpdate({ target: schema.systemSettings.key, set: { value: currentSig } })
      .run();
    console.log(`[gdrives3-db] Seeded initial admin account: ${normalizedEmail}`);
  } else {
    const savedSigRow = db
      .select()
      .from(schema.systemSettings)
      .where(eq(schema.systemSettings.key, ADMIN_SYNC_SETTING_KEY))
      .get();

    const isDefaultEnv =
      normalizedEmail === DEFAULT_ADMIN_EMAIL && effectivePassword === DEFAULT_ADMIN_PASSWORD;
    const shouldSync = savedSigRow
      ? savedSigRow.value !== currentSig
      : !isDefaultEnv;

    if (shouldSync) {
      const targetUser =
        existing.find((u) => u.email === normalizedEmail) ||
        existing.find((u) => u.role === "admin") ||
        existing[0];

      db.update(schema.users)
        .set({
          email: normalizedEmail,
          passwordHash: Bun.password.hashSync(effectivePassword),
          mustChangePassword: mustChange,
          updatedAt: now,
        })
        .where(eq(schema.users.id, targetUser.id))
        .run();

      db.delete(schema.sessions).where(eq(schema.sessions.userId, targetUser.id)).run();
      console.log(`[gdrives3-db] Synced admin credentials from environment: ${normalizedEmail}`);
    }

    if (!savedSigRow || savedSigRow.value !== currentSig) {
      db.insert(schema.systemSettings)
        .values({ key: ADMIN_SYNC_SETTING_KEY, value: currentSig })
        .onConflictDoUpdate({ target: schema.systemSettings.key, set: { value: currentSig } })
        .run();
    }
  }

  return { db, sqlite };
}

export type AppDatabase = ReturnType<typeof initDatabase>["db"];
