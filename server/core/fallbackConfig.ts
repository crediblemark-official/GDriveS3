import { eq } from "drizzle-orm";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AppDatabase } from "../db/client";
import { systemSettings } from "../db/schema";

export const LOCAL_VPS_ACCOUNT_ID = "__local_vps__";

export interface LocalFallbackConfig {
  enabled: boolean;
  maxMb: number; // 0 = unlimited
  autoSyncToDrive: boolean;
  notifyOnFallback: boolean;
}

export const DEFAULT_LOCAL_FALLBACK_CONFIG: LocalFallbackConfig = {
  enabled: true,
  maxMb: 0,
  autoSyncToDrive: true,
  notifyOnFallback: true,
};

export function getLocalFallbackConfig(db: AppDatabase): LocalFallbackConfig {
  const row = db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, "local_fallback_config"))
    .get();
  if (!row) return { ...DEFAULT_LOCAL_FALLBACK_CONFIG };
  try {
    return { ...DEFAULT_LOCAL_FALLBACK_CONFIG, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_LOCAL_FALLBACK_CONFIG };
  }
}

export function saveLocalFallbackConfig(db: AppDatabase, cfg: LocalFallbackConfig): void {
  const value = JSON.stringify(cfg);
  db.insert(systemSettings)
    .values({ key: "local_fallback_config", value })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value },
    })
    .run();
}

export function ensureFallbackDir(dataDir: string): string {
  const dir = join(dataDir, "vps-fallback");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function ensureSpoolDir(dataDir: string): string {
  const dir = join(dataDir, "tmp-spool");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
