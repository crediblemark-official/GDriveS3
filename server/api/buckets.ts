import { Elysia } from "elysia";
import { eq, and, sql, asc } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { buckets, objects, s3AccessKeys } from "../db/schema";
import type { S3Engine } from "../s3/engine";
import type { TokenCipher } from "../core/crypto";
import { resolveS3Endpoint } from "../core/config";
import { generatePresignedUrl } from "../s3/sigv4";

export function createBucketsRoutes(
  db: AppDatabase,
  cipher: TokenCipher,
  engine: S3Engine,
  opts?: { s3PublicUrl?: string; s3Port?: number }
) {
  const router = new Elysia();

  // List Buckets (SQLite aggregation — tanpa memuat seluruh baris objek ke memori)
  router.get("/buckets", async () => {
    const list = db.select().from(buckets).all();
    const statsRows = db
      .select({
        bucketId: objects.bucketId,
        objectsCount: sql<number>`count(*)`,
        totalSize: sql<number>`coalesce(sum(${objects.size}), 0)`,
      })
      .from(objects)
      .groupBy(objects.bucketId)
      .all();

    const statsMap = new Map(
      statsRows.map((r) => [r.bucketId, { count: Number(r.objectsCount), size: Number(r.totalSize) }])
    );

    return list.map((b) => {
      const s = statsMap.get(b.id);
      return {
        id: b.id,
        name: b.name,
        createdAt: b.createdAt,
        objectsCount: s?.count ?? 0,
        totalSize: s?.size ?? 0,
      };
    });
  });

  // Create Bucket
  router.post("/buckets", async ({ body, set }) => {
    const { name } = body as { name?: string };
    if (!name || !/^[a-z0-9.-]{3,63}$/.test(name)) {
      set.status = 400;
      return { error: "Nama bucket tidak valid (3-63 karakter a-z, 0-9, dot, minus)" };
    }

    const existing = db.select().from(buckets).where(eq(buckets.name, name)).get();
    if (existing) {
      set.status = 409;
      return { error: "Bucket dengan nama tersebut sudah ada" };
    }

    const newBucket = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
    };
    db.insert(buckets).values(newBucket).run();
    return newBucket;
  });

  // Delete Bucket
  router.delete("/buckets/:id", async ({ params, set }) => {
    const countRow = db
      .select({ count: sql<number>`count(*)` })
      .from(objects)
      .where(eq(objects.bucketId, params.id))
      .get();
    if (Number(countRow?.count || 0) > 0) {
      set.status = 409;
      return { error: "Bucket tidak dapat dihapus karena masih berisi file" };
    }
    db.delete(buckets).where(eq(buckets.id, params.id)).run();
    return { success: true };
  });

  // List Objects in Bucket (SQL prefix filter)
  router.get("/buckets/:id/objects", async ({ params, query }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) return [];

    const prefix = (query.prefix as string) || "";
    const condition = prefix
      ? and(
          eq(objects.bucketId, bucket.id),
          sql`substr(${objects.objectKey}, 1, ${prefix.length}) = ${prefix}`
        )
      : eq(objects.bucketId, bucket.id);

    const rows = db
      .select({
        id: objects.id,
        key: objects.objectKey,
        size: objects.size,
        etag: objects.etag,
        contentType: objects.contentType,
        updatedAt: objects.updatedAt,
      })
      .from(objects)
      .where(condition)
      .orderBy(asc(objects.objectKey))
      .all();

    return rows;
  });

  // Browser Direct Upload
  router.post("/buckets/:id/upload", async ({ params, query, request, set }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) {
      set.status = 404;
      return { error: "Bucket not found" };
    }

    const key = (query.key as string) || "";
    if (!key || !request.body) {
      set.status = 400;
      return { error: "Missing key or request body" };
    }

    const contentType = request.headers.get("content-type") || "application/octet-stream";
    const res = await engine.putObject(bucket.name, key, contentType, "{}", request.body);
    return res;
  });

  // Browser Multipart Upload: Initiate
  router.post("/buckets/:id/multipart/initiate", async ({ params, body, set }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) {
      set.status = 404;
      return { error: "Bucket tidak ditemukan" };
    }
    const { key, contentType = "application/octet-stream" } = body as { key?: string; contentType?: string };
    if (!key) {
      set.status = 400;
      return { error: "Parameter 'key' wajib diisi" };
    }
    const uploadId = await engine.initiateMultipart(bucket.name, key, contentType, "{}");
    return { uploadId };
  });

  // Browser Multipart Upload: Upload Part
  router.post("/buckets/:id/multipart/part", async ({ params, query, request, set }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) {
      set.status = 404;
      return { error: "Bucket tidak ditemukan" };
    }
    const { uploadId, partNumber } = query as { uploadId?: string; partNumber?: string };
    if (!uploadId || !partNumber || !request.body) {
      set.status = 400;
      return { error: "Missing uploadId, partNumber, or body" };
    }
    const res = await engine.uploadPart(uploadId, Number(partNumber), request.body);
    return res;
  });

  // Browser Multipart Upload: Complete
  router.post("/buckets/:id/multipart/complete", async ({ params, body, set }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) {
      set.status = 404;
      return { error: "Bucket tidak ditemukan" };
    }
    const { key, uploadId } = body as { key?: string; uploadId?: string };
    if (!key || !uploadId) {
      set.status = 400;
      return { error: "Missing key or uploadId" };
    }
    const res = await engine.completeMultipart(bucket.name, key, uploadId);
    return res;
  });

  // Browser Multipart Upload: Abort
  router.post("/buckets/:id/multipart/abort", async ({ params, body, set }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) {
      set.status = 404;
      return { error: "Bucket tidak ditemukan" };
    }
    const { uploadId } = body as { uploadId?: string };
    if (!uploadId) {
      set.status = 400;
      return { error: "Missing uploadId" };
    }
    await engine.abortMultipart(uploadId);
    return { success: true };
  });

  // Create Virtual Directory Marker
  router.post("/buckets/:id/folder", async ({ params, body, set }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) {
      set.status = 404;
      return { error: "Bucket tidak ditemukan" };
    }
    const { folderName, prefix } = body as { folderName?: string; prefix?: string };
    if (!folderName) {
      set.status = 400;
      return { error: "Nama folder tidak boleh kosong" };
    }
    const cleanName = folderName.trim().replace(/^\/+|\/+$/g, "");
    const basePrefix = prefix ? prefix.replace(/^\/+|\/+$/g, "") + "/" : "";
    const folderKey = `${basePrefix}${cleanName}/`;

    const emptyStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    const res = await engine.putObject(
      bucket.name,
      folderKey,
      "application/x-directory",
      "{}",
      emptyStream
    );
    return { success: true, key: folderKey, res };
  });

  // Browser Direct Download
  router.get("/buckets/:id/download", async ({ params, query, set }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) {
      set.status = 404;
      return "Bucket not found";
    }
    const key = query.key as string;
    const { obj, response: driveRes } = await engine.getObject(bucket.name, key);

    set.status = driveRes.status;
    set.headers["Content-Type"] = obj.contentType || "application/octet-stream";
    set.headers["Content-Disposition"] = `attachment; filename="${key.split("/").pop()}"`;
    return driveRes.body;
  });

  // Delete Object
  router.delete("/buckets/:id/objects", async ({ params, query }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) return { success: false };
    const key = query.key as string;
    await engine.deleteObject(bucket.name, key);
    return { success: true };
  });

  // Generate S3 Presigned URL
  router.post("/buckets/:id/presign", async ({ params, body, request, set }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) {
      set.status = 404;
      return { error: "Bucket tidak ditemukan" };
    }
    const { key, expiresIn, expiresInSeconds, method = "GET" } = body as {
      key?: string;
      expiresIn?: number;
      expiresInSeconds?: number;
      method?: string;
    };
    if (!key) {
      set.status = 400;
      return { error: "Parameter 'key' wajib diisi" };
    }

    const rawTtl = expiresIn ?? expiresInSeconds ?? 3600;
    const ttl = Math.min(604800, Math.max(60, Math.floor(Number(rawTtl) || 3600)));

    let keyRow = db.select().from(s3AccessKeys).all()[0];
    let secretKey = "";
    if (keyRow) {
      secretKey = await cipher.decrypt(keyRow.secretHash);
    } else {
      const rawKey = new Uint8Array(16);
      const rawSecret = new Uint8Array(32);
      crypto.getRandomValues(rawKey);
      crypto.getRandomValues(rawSecret);
      const accessKeyId = "GDS3" + Buffer.from(rawKey).toString("hex").toUpperCase();
      secretKey = Buffer.from(rawSecret).toString("base64url");
      const secretHash = await cipher.encrypt(secretKey);
      keyRow = {
        id: crypto.randomUUID(),
        accessKeyId,
        secretHash,
        label: "Default Presign Key",
        permissions: "read_write",
        allowedBuckets: null,
        createdAt: new Date().toISOString(),
      };
      db.insert(s3AccessKeys).values(keyRow).run();
    }

    const endpoint = resolveS3Endpoint(request, opts?.s3PublicUrl, opts?.s3Port);

    const url = await generatePresignedUrl({
      endpoint,
      bucket: bucket.name,
      key,
      accessKeyId: keyRow.accessKeyId,
      secretKey,
      expiresInSeconds: ttl,
      method,
    });

    const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
    return { success: true, url, expiresAt, expiresIn: ttl };
  });

  return router;
}
