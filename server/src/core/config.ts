import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";

export interface AppConfig {
  port: number;
  s3Port: number;
  host: string;
  dataDir: string;
  adminEmail: string;
  adminPassword: string;
  encryptionKey: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  isDev: boolean;
}

export function loadConfig(): AppConfig {
  const dataDir = process.env.G3_DATA_DIR || "./g3-data";
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  return {
    port: Number(process.env.G3_PORT || process.env.PORT || 8787),
    s3Port: Number(process.env.G3_S3_PORT || 9000),
    host: process.env.G3_HOST || "0.0.0.0",
    dataDir,
    adminEmail: process.env.G3_ADMIN_EMAIL || "admin@g3.local",
    adminPassword: process.env.G3_ADMIN_PASSWORD || "change-me-now",
    encryptionKey: process.env.G3_ENCRYPTION_KEY || "",
    googleClientId: process.env.G3_GOOGLE_CLIENT_ID || "",
    googleClientSecret: process.env.G3_GOOGLE_CLIENT_SECRET || "",
    googleRedirectUri: process.env.G3_GOOGLE_REDIRECT_URI || "http://localhost:8787/api/accounts/callback",
    isDev: process.env.NODE_ENV !== "production" && process.env.G3_DEV !== "false",
  };
}
