import { Elysia } from "elysia";
import { eq, sql } from "drizzle-orm";
import type { Database } from "bun:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync, unlinkSync } from "node:fs";
import type { AppDatabase } from "../db/client";
import { driveAccounts, buckets, objects, pendingDriveDeletes, systemSettings } from "../db/schema";
import type { S3Engine } from "../s3/engine";
import { DriveClient } from "../drive/client";
import {
  getWebhookConfig,
  saveWebhookConfig,
  validateWebhookUrl,
  dispatchWebhook,
  type WebhookConfig,
} from "../core/webhook";
import {
  getS3CorsConfig,
  saveS3CorsConfig,
  type S3CorsConfig,
} from "../core/corsConfig";
import { resolveS3Endpoint } from "../core/config";

export function createSettingsRoutes(
  db: AppDatabase,
  engine: S3Engine,
  opts?: { s3PublicUrl?: string; s3Port?: number; sqlite?: Database }
) {
  const router = new Elysia();

  // Aggregate Stats (SQL aggregation)
  router.get("/stats", async ({ request }) => {
    const accounts = db.select().from(driveAccounts).all();
    const bucketCountRow = db.select({ count: sql<number>`count(*)` }).from(buckets).get();
    const objAggRow = db
      .select({
        count: sql<number>`count(*)`,
        totalBytes: sql<number>`coalesce(sum(${objects.size}), 0)`,
      })
      .from(objects)
      .get();
    const pendingDeletesRow = db
      .select({ count: sql<number>`count(*)` })
      .from(pendingDriveDeletes)
      .get();

    const totalStorageLimit = accounts.reduce((acc, a) => acc + (a.storageLimit || 0), 0);
    const totalStorageUsage = accounts.reduce((acc, a) => acc + (a.storageUsage || 0), 0);

    return {
      accountsCount: accounts.length,
      bucketsCount: Number(bucketCountRow?.count || 0),
      objectsCount: Number(objAggRow?.count || 0),
      totalStorageLimit,
      totalStorageUsage,
      totalObjectBytes: Number(objAggRow?.totalBytes || 0),
      pendingDeletesCount: Number(pendingDeletesRow?.count || 0),
      driveTelemetry: DriveClient.getTelemetry(),
      s3Endpoint: resolveS3Endpoint(request, opts?.s3PublicUrl, opts?.s3Port),
      accounts: accounts.map((a) => ({
        id: a.id,
        email: a.email,
        status: a.status,
        storageLimit: a.storageLimit,
        storageUsage: a.storageUsage,
        dailyBytes: a.dailyBytes,
      })),
    };
  });

  // Trigger Storage Garbage Collection (Multipart + Pending Drive Deletes)
  router.post("/storage/gc", async () => {
    const swept = await engine.sweepStaleMultipartUploads(24 * 60 * 60 * 1000);
    const retried = await engine.retryPendingDeletes();
    return {
      success: true,
      staleUploadsSwept: swept,
      pendingDeletesRetried: retried.retried,
      pendingDeletesSucceeded: retried.succeeded,
      pendingDeletesRemaining: retried.remaining,
      message: `Pembersihan selesai: ${swept} upload multipart kedaluwarsa & ${retried.succeeded} antrean hapus Drive dibersihkan.`,
    };
  });

  // Pending Drive Deletes Queue
  router.get("/storage/pending-deletes", async () => {
    return engine.listPendingDeletes();
  });

  router.post("/storage/pending-deletes/retry", async () => {
    const res = await engine.retryPendingDeletes();
    return { success: true, ...res };
  });

  // Drive <-> SQLite Audit & Reconcile
  router.post("/storage/audit", async () => {
    return engine.auditDrivePool();
  });

  router.post("/storage/audit/cleanup", async ({ body }) => {
    const payload = (body as {
      missingObjectIds?: string[];
      orphanItems?: { accountId: string; driveFileId: string }[];
    }) || {};
    const res = await engine.cleanupAudit(payload);
    return { success: true, ...res };
  });

  // Consistent SQLite Snapshot Backup (VACUUM INTO)
  router.get("/storage/backup", async ({ set }) => {
    const sqlite = opts?.sqlite ?? ((db as any).$client as Database | undefined);
    if (!sqlite) {
      set.status = 500;
      return { error: "SQLite handle tidak tersedia" };
    }
    const snapPath = join(tmpdir(), `gdrives3-snap-${crypto.randomUUID()}.db`);
    try {
      sqlite.run(`VACUUM INTO '${snapPath.replace(/'/g, "''")}'`);
      const bytes = readFileSync(snapPath);
      const dateStr = new Date().toISOString().slice(0, 10);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": "application/x-sqlite3",
          "Content-Disposition": `attachment; filename="gdrives3-backup-${dateStr}.db"`,
          "Content-Length": String(bytes.byteLength),
        },
      });
    } finally {
      try {
        unlinkSync(snapPath);
      } catch {
        // ignore cleanup error
      }
    }
  });

  // Get Current Balancing Strategy
  router.get("/settings/balancing", async () => {
    const row = db.select().from(systemSettings).where(eq(systemSettings.key, "balancing_strategy")).get();
    return { strategy: row?.value || "round_robin" };
  });

  // Update Balancing Strategy
  router.put("/settings/balancing", async ({ body, set }) => {
    const { strategy } = body as { strategy?: string };
    const valid = ["round_robin", "least_used", "fill_first", "hash"];
    if (!strategy || !valid.includes(strategy)) {
      set.status = 400;
      return { error: "Strategi balancing tidak valid" };
    }
    db.insert(systemSettings)
      .values({ key: "balancing_strategy", value: strategy })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: strategy } })
      .run();
    return { success: true, strategy };
  });

  // Get Webhook Config
  router.get("/settings/webhook", async () => {
    return getWebhookConfig(db);
  });

  // Update Webhook Config
  router.put("/settings/webhook", async ({ body, set }) => {
    const payload = body as Partial<WebhookConfig>;
    const url = (payload.url || "").trim();
    const enabled = Boolean(payload.enabled);

    if (enabled || url) {
      const err = validateWebhookUrl(url);
      if (err) {
        set.status = 400;
        return { error: err };
      }
    }

    const threshold = Math.min(99, Math.max(10, Number(payload.thresholdPercent || 85)));
    const next: WebhookConfig = {
      enabled,
      url,
      thresholdPercent: threshold,
      notifyOnQuota: payload.notifyOnQuota !== false,
      notifyOnAuthError: payload.notifyOnAuthError !== false,
    };

    saveWebhookConfig(db, next);
    return { success: true, config: next };
  });

  // Test Webhook Delivery
  router.post("/settings/webhook/test", async ({ body, set }) => {
    const payload = (body as { url?: string }) || {};
    const cfg = getWebhookConfig(db);
    const targetUrl = (payload.url || cfg.url || "").trim();

    const err = validateWebhookUrl(targetUrl);
    if (err) {
      set.status = 400;
      return { error: err };
    }

    try {
      const res = await dispatchWebhook(
        targetUrl,
        "test",
        "Uji koneksi webhook dari GDriveS3 berhasil!",
        { source: "panel-settings" }
      );
      if (!res.ok) {
        set.status = 502;
        return { error: `Webhook merespons HTTP ${res.status}` };
      }
      return { success: true, status: res.status };
    } catch (e: any) {
      set.status = 502;
      return { error: `Gagal menghubungi webhook: ${e.message}` };
    }
  });

  // Get S3 CORS Config
  router.get("/settings/cors", async () => {
    return getS3CorsConfig(db);
  });

  // Update S3 CORS Config
  router.put("/settings/cors", async ({ body, set }) => {
    const payload = body as Partial<S3CorsConfig>;
    const allowedOrigins = Array.isArray(payload.allowedOrigins)
      ? payload.allowedOrigins.map((s) => s.trim()).filter(Boolean)
      : ["*"];
    const allowedMethods = Array.isArray(payload.allowedMethods)
      ? payload.allowedMethods.map((m) => m.trim().toUpperCase()).filter(Boolean)
      : ["GET", "PUT", "POST", "DELETE", "HEAD"];
    const allowedHeaders = Array.isArray(payload.allowedHeaders)
      ? payload.allowedHeaders.map((h) => h.trim()).filter(Boolean)
      : ["*"];
    const maxAgeSeconds = Math.max(0, Number(payload.maxAgeSeconds ?? 3600));

    if (allowedOrigins.length === 0) {
      set.status = 400;
      return { error: "Minimal harus ada 1 origin (atau '*')" };
    }

    const next: S3CorsConfig = {
      allowedOrigins,
      allowedMethods,
      allowedHeaders,
      maxAgeSeconds,
    };

    saveS3CorsConfig(db, next);
    return { success: true, config: next };
  });

  return router;
}
