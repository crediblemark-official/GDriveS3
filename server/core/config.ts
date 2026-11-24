import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

export interface AppConfig {
  port: number;
  s3Port: number;
  s3PublicUrl: string;
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

  const dataDir = getEnv("GDRIVES3_DATA_DIR", "./gdrives3-data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  return {
    port: Number(getEnv("GDRIVES3_PORT", getEnv("PORT", "8787"))),
    s3Port: Number(getEnv("GDRIVES3_S3_PORT", "9000")),
    s3PublicUrl: getEnv("GDRIVES3_S3_PUBLIC_URL", "").replace(/\/+$/, ""),
    host: getEnv("GDRIVES3_HOST", "0.0.0.0"),
    dataDir,
    adminEmail: getEnv("GDRIVES3_ADMIN_EMAIL", "admin@gdrives3.local"),
    adminPassword: getEnv("GDRIVES3_ADMIN_PASSWORD", "change-me-now"),
    encryptionKey: getEnv("GDRIVES3_ENCRYPTION_KEY", ""),
    googleClientId: getEnv("GDRIVES3_GOOGLE_CLIENT_ID", ""),
    googleClientSecret: getEnv("GDRIVES3_GOOGLE_CLIENT_SECRET", ""),
    googleRedirectUri: getEnv("GDRIVES3_GOOGLE_REDIRECT_URI", "http://localhost:8787/api/accounts/callback"),
    isDev: process.env.NODE_ENV !== "production" && getEnv("GDRIVES3_DEV", "true") !== "false",
  };
}

/**
 * Resolves the public S3 endpoint URL for presigned links and UI snippets.
 * Prefers GDRIVES3_S3_PUBLIC_URL; otherwise derives hostname from the incoming Host header.
 */
export function resolveS3Endpoint(
  request: Request,
  s3PublicUrl?: string,
  s3Port?: number
): string {
  const configured = (s3PublicUrl || process.env.GDRIVES3_S3_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;

  const port = s3Port || Number(process.env.GDRIVES3_S3_PORT || 9000);
  const proto = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "") || "http";
  const rawHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";

  let hostname = "localhost";
  if (rawHost) {
    if (rawHost.startsWith("[")) {
      const endIdx = rawHost.indexOf("]");
      hostname = endIdx >= 0 ? rawHost.slice(0, endIdx + 1) : rawHost;
    } else {
      hostname = rawHost.split(":")[0] || "localhost";
    }
  } else if (process.env.GDRIVES3_HOST && process.env.GDRIVES3_HOST !== "0.0.0.0") {
    hostname = process.env.GDRIVES3_HOST;
  }

  if (hostname === "0.0.0.0") hostname = "localhost";
  return `${proto}://${hostname}:${port}`;
}
