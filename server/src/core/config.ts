import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

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
  const fileEnv: Record<string, string> = {};
  if (existsSync(".env")) {
    const lines = readFileSync(".env", "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        fileEnv[key] = val;
      }
    }
  }

  const getEnv = (k: string, fallback: string = "") => process.env[k] || fileEnv[k] || fallback;

  const dataDir = getEnv("G3_DATA_DIR", "./g3-data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  return {
    port: Number(getEnv("G3_PORT", getEnv("PORT", "8787"))),
    s3Port: Number(getEnv("G3_S3_PORT", "9000")),
    host: getEnv("G3_HOST", "0.0.0.0"),
    dataDir,
    adminEmail: getEnv("G3_ADMIN_EMAIL", "admin@g3.local"),
    adminPassword: getEnv("G3_ADMIN_PASSWORD", "change-me-now"),
    encryptionKey: getEnv("G3_ENCRYPTION_KEY", ""),
    googleClientId: getEnv("G3_GOOGLE_CLIENT_ID", ""),
    googleClientSecret: getEnv("G3_GOOGLE_CLIENT_SECRET", ""),
    googleRedirectUri: getEnv("G3_GOOGLE_REDIRECT_URI", "http://localhost:8787/api/accounts/callback"),
    isDev: process.env.NODE_ENV !== "production" && getEnv("G3_DEV", "true") !== "false",
  };
}
