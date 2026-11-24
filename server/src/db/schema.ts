import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  passwordHash: text("password_hash").notNull(),
  mustChangePassword: integer("must_change_password").default(0),
  role: text("role").default("admin"), // "admin" | "editor" | "viewer"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
}, (t) => [
  index("idx_sessions_user").on(t.userId),
]);

export const driveAccounts = sqliteTable("drive_accounts", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  refreshToken: text("refresh_token").notNull(), // Encrypted AES-GCM
  folderId: text("folder_id"),
  weight: integer("weight").default(1),
  storageLimit: integer("storage_limit").default(0), // Bytes
  storageUsage: integer("storage_usage").default(0), // Bytes
  dailyBytes: integer("daily_bytes").default(0), // Bytes uploaded today
  dailyDate: text("daily_date"), // YYYY-MM-DD
  status: text("status").default("connected"), // "connected" | "disconnected" | "revoked"
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const buckets = sqliteTable("buckets", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

export interface ManifestPart {
  accountId: string;
  driveFileId: string;
  size: number;
  etag: string;
}

export const objects = sqliteTable("objects", {
  id: text("id").primaryKey(),
  bucketId: text("bucket_id").notNull(),
  objectKey: text("object_key").notNull(),
  size: integer("size").notNull().default(0),
  etag: text("etag").notNull(),
  contentType: text("content_type").default("application/octet-stream"),
  metadata: text("metadata"), // JSON of x-amz-meta-*
  accountId: text("account_id"),
  driveFileId: text("drive_file_id"),
  parts: text("parts"), // JSON ManifestPart[] jika file di-chunk (>64MB) atau multipart
  isMultipart: integer("is_multipart").default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [
  index("idx_objects_bucket_key").on(t.bucketId, t.objectKey),
]);

export const multipartUploads = sqliteTable("multipart_uploads", {
  uploadId: text("upload_id").primaryKey(),
  bucketId: text("bucket_id").notNull(),
  objectKey: text("object_key").notNull(),
  contentType: text("content_type").default("application/octet-stream"),
  metadata: text("metadata"),
  createdAt: text("created_at").notNull(),
}, (t) => [
  index("idx_multipart_bucket").on(t.bucketId),
]);

export const multipartParts = sqliteTable("multipart_parts", {
  id: text("id").primaryKey(),
  uploadId: text("upload_id").notNull(),
  partNumber: integer("part_number").notNull(),
  accountId: text("account_id").notNull(),
  driveFileId: text("drive_file_id").notNull(),
  size: integer("size").notNull(),
  etag: text("etag").notNull(),
}, (t) => [
  index("idx_multipart_parts").on(t.uploadId, t.partNumber),
]);

export const s3AccessKeys = sqliteTable("s3_access_keys", {
  id: text("id").primaryKey(),
  accessKeyId: text("access_key_id").notNull().unique(),
  secretHash: text("secret_hash").notNull(), // Encrypted AES-GCM
  label: text("label"),
  createdAt: text("created_at").notNull(),
});

export const systemSettings = sqliteTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
