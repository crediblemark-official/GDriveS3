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
  const getCompatEnv = (primary: string, legacy: string, fallback: string = "") =>
    getEnv(primary) || getEnv(legacy) || fallback;

  const dataDir = getCompatEnv("GDRIVES3_DATA_DIR", "G3_DATA_DIR", "./gdrives3-data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  return {
    port: Number(getCompatEnv("GDRIVES3_PORT", "G3_PORT", getEnv("PORT", "8787"))),
    s3Port: Number(getCompatEnv("GDRIVES3_S3_PORT", "G3_S3_PORT", "9000")),
    s3PublicUrl: getCompatEnv("GDRIVES3_S3_PUBLIC_URL", "G3_S3_PUBLIC_URL", "").replace(/\/+$/, ""),
    host: getCompatEnv("GDRIVES3_HOST", "G3_HOST", "0.0.0.0"),
    dataDir,
    adminEmail: getCompatEnv("GDRIVES3_ADMIN_EMAIL", "G3_ADMIN_EMAIL", "admin@gdrives3.local"),
    adminPassword: getCompatEnv("GDRIVES3_ADMIN_PASSWORD", "G3_ADMIN_PASSWORD", "change-me-now"),
    encryptionKey: getCompatEnv("GDRIVES3_ENCRYPTION_KEY", "G3_ENCRYPTION_KEY", ""),
    googleClientId: getCompatEnv("GDRIVES3_GOOGLE_CLIENT_ID", "G3_GOOGLE_CLIENT_ID", ""),
    googleClientSecret: getCompatEnv("GDRIVES3_GOOGLE_CLIENT_SECRET", "G3_GOOGLE_CLIENT_SECRET", ""),
    googleRedirectUri: getCompatEnv(
      "GDRIVES3_GOOGLE_REDIRECT_URI",
      "G3_GOOGLE_REDIRECT_URI",
      "http://localhost:8787/api/accounts/callback"
    ),
    isDev:
      process.env.NODE_ENV !== "production" &&
      getCompatEnv("GDRIVES3_DEV", "G3_DEV", "true") !== "false",
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
  const configured = (
    s3PublicUrl ||
    process.env.GDRIVES3_S3_PUBLIC_URL ||
    process.env.G3_S3_PUBLIC_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (configured) return configured;

  const port = s3Port || Number(process.env.GDRIVES3_S3_PORT || process.env.G3_S3_PORT || 9000);
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
  } else {
    const envHost = process.env.GDRIVES3_HOST || process.env.G3_HOST;
    if (envHost && envHost !== "0.0.0.0") {
      hostname = envHost;
    }
  }

  if (hostname === "0.0.0.0") hostname = "localhost";
  return `${proto}://${hostname}:${port}`;
}
