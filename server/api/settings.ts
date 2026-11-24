import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { driveAccounts, buckets, objects, systemSettings } from "../db/schema";
import type { S3Engine } from "../s3/engine";

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

  return router;
}
