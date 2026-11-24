import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { driveAccounts, buckets, objects, systemSettings } from "../db/schema";
import type { S3Engine } from "../s3/engine";
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

export function createSettingsRoutes(
  db: AppDatabase,
  engine: S3Engine
) {
  const router = new Elysia();

  // Aggregate Stats
  router.get("/stats", async () => {
    const accounts = db.select().from(driveAccounts).all();
    const allBuckets = db.select().from(buckets).all();
    const allObjects = db.select().from(objects).all();

    const totalStorageLimit = accounts.reduce((acc, a) => acc + (a.storageLimit || 0), 0);
    const totalStorageUsage = accounts.reduce((acc, a) => acc + (a.storageUsage || 0), 0);
    const totalObjectBytes = allObjects.reduce((acc, o) => acc + (o.size || 0), 0);

    return {
      accountsCount: accounts.length,
      bucketsCount: allBuckets.length,
      objectsCount: allObjects.length,
      totalStorageLimit,
      totalStorageUsage,
      totalObjectBytes,
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

  // Trigger Storage Garbage Collection
  router.post("/storage/gc", async () => {
    const swept = await engine.sweepStaleMultipartUploads(24 * 60 * 60 * 1000);
    return {
      success: true,
      staleUploadsSwept: swept,
      message: `Pembersihan selesai: ${swept} upload multipart yang kedaluwarsa telah dihapus dari Google Drive.`,
    };
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
        "Uji koneksi webhook dari G3 Storage berhasil!",
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
