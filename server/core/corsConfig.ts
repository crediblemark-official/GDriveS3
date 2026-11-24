import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { systemSettings } from "../db/schema";

export interface S3CorsConfig {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  maxAgeSeconds: number;
}

export const DEFAULT_S3_CORS_CONFIG: S3CorsConfig = {
  allowedOrigins: ["*"],
  allowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
  allowedHeaders: ["*"],
  maxAgeSeconds: 3600,
};

export function getS3CorsConfig(db: AppDatabase): S3CorsConfig {
  const row = db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, "s3_cors_config"))
    .get();
  if (!row) return { ...DEFAULT_S3_CORS_CONFIG };
  try {
    return { ...DEFAULT_S3_CORS_CONFIG, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_S3_CORS_CONFIG };
  }
}

export function saveS3CorsConfig(db: AppDatabase, cfg: S3CorsConfig): void {
  const value = JSON.stringify(cfg);
  const existing = db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, "s3_cors_config"))
    .get();

  if (existing) {
    db.update(systemSettings)
      .set({ value })
      .where(eq(systemSettings.key, "s3_cors_config"))
      .run();
  } else {
    db.insert(systemSettings)
      .values({ key: "s3_cors_config", value })
      .run();
  }
}
