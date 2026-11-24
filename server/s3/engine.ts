import { eq, and, like } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import {
  buckets,
  objects,
  multipartUploads,
  multipartParts,
  driveAccounts,
  type ManifestPart,
} from "../db/schema";
import type { Balancer } from "../drive/balancer";
import { DriveClient } from "../drive/client";
import type { TokenCipher } from "../core/crypto";
import type { GoogleOAuth } from "../drive/oauth";

export class S3Engine {
  constructor(
    private db: AppDatabase,
    private balancer: Balancer,
    private oauth: GoogleOAuth,
    private cipher: TokenCipher
  ) {}

  async putObject(
    bucketName: string,
    key: string,
    contentType: string,
    metadata: string,
    body: ReadableStream
  ): Promise<{ etag: string; size: number }> {
    const bucket = this.db.select().from(buckets).where(eq(buckets.name, bucketName)).get();
    if (!bucket) throw new Error("NoSuchBucket");

    // 1. Pilih akun Google Drive melalui balancer
    const { account, accessToken } = await this.balancer.pickAccount(key);
    const rootFolderId = account.folderId || "";

    // 2. Pastikan subfolder untuk bucket ada di dalam G3 Storage
    const bucketFolderId = await DriveClient.ensureSubfolder(
      accessToken,
      bucketName,
      rootFolderId
    );

    // 3. Buffer/Stream byte & hitung MD5 hash ETag
    // Gunakan Bun CryptoHasher untuk inline MD5
    const hasher = new Bun.CryptoHasher("md5");
    let totalBytes = 0;

    // Transform stream untuk menghitung ETag & byte size secara streaming
    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        hasher.update(chunk);
        totalBytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });

    const countingStream = body.pipeThrough(transformStream);

    // 4. Upload stream langsung ke folder bucket di Google Drive
    const fileName = key;
    const driveFileId = await DriveClient.uploadStream(
      accessToken,
      bucketFolderId || rootFolderId,
      fileName,
      contentType,
      countingStream
    );

    const etag = hasher.digest("hex");
    const now = new Date().toISOString();

    // 4. Update / Insert di DB
    const existing = this.db
      .select()
      .from(objects)
      .where(and(eq(objects.bucketId, bucket.id), eq(objects.objectKey, key)))
      .get();

    if (existing) {
      // Hapus file lama di Drive (asinkron / best effort)
      if (existing.driveFileId && existing.accountId) {
        this.deleteDriveFile(existing.accountId, existing.driveFileId).catch(() => {});
      }
      this.db
        .update(objects)
        .set({
          size: totalBytes,
          etag,
          contentType,
          metadata,
          accountId: account.id,
          driveFileId,
          updatedAt: now,
        })
        .where(eq(objects.id, existing.id))
        .run();
    } else {
      this.db
        .insert(objects)
        .values({
          id: crypto.randomUUID(),
          bucketId: bucket.id,
          objectKey: key,
          size: totalBytes,
          etag,
          contentType,
          metadata,
          accountId: account.id,
          driveFileId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    // 5. Catat konsumsi kuota
    this.balancer.recordUsage(account.id, totalBytes);

    return { etag, size: totalBytes };
  }

  async getObject(
    bucketName: string,
    key: string,
    rangeHeader?: string | null
  ): Promise<{
    obj: typeof objects.$inferSelect;
    response: Response;
  }> {
    const bucket = this.db.select().from(buckets).where(eq(buckets.name, bucketName)).get();
    if (!bucket) throw new Error("NoSuchBucket");

    const obj = this.db
      .select()
      .from(objects)
      .where(and(eq(objects.bucketId, bucket.id), eq(objects.objectKey, key)))
      .get();

    if (!obj) throw new Error("NoSuchKey");

    // Jika objek adalah multipart, gunakan stitched stream
    if (obj.isMultipart && obj.parts) {
      const parts: ManifestPart[] = JSON.parse(obj.parts);
      let currentPartIdx = 0;
      let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      const self = this;

      const stitchedStream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          while (currentPartIdx < parts.length) {
            if (!currentReader) {
              const part = parts[currentPartIdx];
              const { accessToken } = await self.getAccountToken(part.accountId);
              const partRes = await DriveClient.downloadStream(accessToken, part.driveFileId);
              if (!partRes.body) throw new Error("Gagal membaca part stream dari Drive");
              currentReader = partRes.body.getReader();
            }

            const { done, value } = await currentReader.read();
            if (done) {
              currentReader = null;
              currentPartIdx++;
              continue;
            }

            controller.enqueue(value);
            return;
          }
          controller.close();
        },
      });

      return {
        obj,
        response: new Response(stitchedStream, {
          status: 200,
          headers: {
            "Content-Length": String(obj.size),
            "Content-Type": obj.contentType || "application/octet-stream",
          },
        }),
      };
    }

    if (!obj.accountId || !obj.driveFileId) {
      throw new Error("Object backing file hilang");
    }

    const { accessToken } = await this.getAccountToken(obj.accountId);
    const driveRes = await DriveClient.downloadStream(accessToken, obj.driveFileId, rangeHeader);

    if (!driveRes.ok) {
      throw new Error(`Gagal download dari Drive: ${driveRes.statusText}`);
    }

    return { obj, response: driveRes };
  }

  async deleteObject(bucketName: string, key: string): Promise<void> {
    const bucket = this.db.select().from(buckets).where(eq(buckets.name, bucketName)).get();
    if (!bucket) return;

    const obj = this.db
      .select()
      .from(objects)
      .where(and(eq(objects.bucketId, bucket.id), eq(objects.objectKey, key)))
      .get();

    if (!obj) return;

    if (obj.accountId && obj.driveFileId) {
      await this.deleteDriveFile(obj.accountId, obj.driveFileId);
    }

    this.db.delete(objects).where(eq(objects.id, obj.id)).run();
  }

  async copyObject(
    srcBucketName: string,
    srcKey: string,
    dstBucketName: string,
    dstKey: string
  ): Promise<{ etag: string }> {
    const srcBucket = this.db.select().from(buckets).where(eq(buckets.name, srcBucketName)).get();
    const dstBucket = this.db.select().from(buckets).where(eq(buckets.name, dstBucketName)).get();
    if (!srcBucket || !dstBucket) throw new Error("NoSuchBucket");

    const srcObj = this.db
      .select()
      .from(objects)
      .where(and(eq(objects.bucketId, srcBucket.id), eq(objects.objectKey, srcKey)))
      .get();

    if (!srcObj) throw new Error("NoSuchKey");

    // Jika copy ke diri sendiri (update metadata only)
    if (srcBucket.id === dstBucket.id && srcKey === dstKey) {
      return { etag: srcObj.etag };
    }

    // Server-side copy di Google Drive tanpa transit byte!
    const { account, accessToken } = await this.getAccountToken(srcObj.accountId!);
    const rootFolderId = account.folderId || "";
    const targetFolderId = await DriveClient.ensureSubfolder(
      accessToken,
      dstBucketName,
      rootFolderId
    );

    const newDriveFileId = await DriveClient.copyFile(
      accessToken,
      srcObj.driveFileId!,
      dstKey,
      targetFolderId || rootFolderId
    );

    const now = new Date().toISOString();
    this.db
      .insert(objects)
      .values({
        id: crypto.randomUUID(),
        bucketId: dstBucket.id,
        objectKey: dstKey,
        size: srcObj.size,
        etag: srcObj.etag,
        contentType: srcObj.contentType,
        metadata: srcObj.metadata,
        accountId: srcObj.accountId,
        driveFileId: newDriveFileId,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return { etag: srcObj.etag };
  }

  // --- S3 Multipart Upload Engine ---

  async initiateMultipart(
    bucketName: string,
    key: string,
    contentType: string,
    metadata: string
  ): Promise<string> {
    const bucket = this.db.select().from(buckets).where(eq(buckets.name, bucketName)).get();
    if (!bucket) throw new Error("NoSuchBucket");

    const uploadId = crypto.randomUUID().replace(/-/g, "");
    this.db
      .insert(multipartUploads)
      .values({
        uploadId,
        bucketId: bucket.id,
        objectKey: key,
        contentType,
        metadata,
        createdAt: new Date().toISOString(),
      })
      .run();

    return uploadId;
  }

  async uploadPart(
    uploadId: string,
    partNumber: number,
    body: ReadableStream
  ): Promise<{ etag: string }> {
    const upload = this.db
      .select()
      .from(multipartUploads)
      .where(eq(multipartUploads.uploadId, uploadId))
      .get();
    if (!upload) throw new Error("NoSuchUpload");

    const bucket = this.db.select().from(buckets).where(eq(buckets.id, upload.bucketId)).get();
    if (!bucket) throw new Error("NoSuchBucket");

    const { account, accessToken } = await this.balancer.pickAccount(upload.objectKey);
    const rootFolderId = account.folderId || "";
    const bucketFolderId = await DriveClient.ensureSubfolder(
      accessToken,
      bucket.name,
      rootFolderId
    );

    const hasher = new Bun.CryptoHasher("md5");
    let partBytes = 0;

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        hasher.update(chunk);
        partBytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });

    const countingStream = body.pipeThrough(transformStream);
    const partFileName = `part-${uploadId}-${partNumber}`;

    const driveFileId = await DriveClient.uploadStream(
      accessToken,
      bucketFolderId || rootFolderId,
      partFileName,
      "application/octet-stream",
      countingStream
    );

    const etag = hasher.digest("hex");

    this.db
      .insert(multipartParts)
      .values({
        id: crypto.randomUUID(),
        uploadId,
        partNumber,
        accountId: account.id,
        driveFileId,
        size: partBytes,
        etag,
      })
      .run();

    this.balancer.recordUsage(account.id, partBytes);
    return { etag };
  }

  async completeMultipart(
    bucketName: string,
    key: string,
    uploadId: string
  ): Promise<{ etag: string; size: number }> {
    const bucket = this.db.select().from(buckets).where(eq(buckets.name, bucketName)).get();
    if (!bucket) throw new Error("NoSuchBucket");

    const upload = this.db
      .select()
      .from(multipartUploads)
      .where(eq(multipartUploads.uploadId, uploadId))
      .get();
    if (!upload) throw new Error("NoSuchUpload");

    const parts = this.db
      .select()
      .from(multipartParts)
      .where(eq(multipartParts.uploadId, uploadId))
      .all();
    if (parts.length === 0) throw new Error("No parts uploaded");

    parts.sort((a, b) => a.partNumber - b.partNumber);

    const concatHasher = new Bun.CryptoHasher("md5");
    let totalSize = 0;
    const manifestParts: ManifestPart[] = [];

    for (const p of parts) {
      totalSize += p.size;
      const partMd5Buffer = Buffer.from(p.etag, "hex");
      concatHasher.update(partMd5Buffer);
      manifestParts.push({
        accountId: p.accountId,
        driveFileId: p.driveFileId,
        size: p.size,
        etag: p.etag,
      });
    }

    const etag = `${concatHasher.digest("hex")}-${parts.length}`;
    const now = new Date().toISOString();

    const existing = this.db
      .select()
      .from(objects)
      .where(and(eq(objects.bucketId, bucket.id), eq(objects.objectKey, key)))
      .get();
    if (existing) {
      this.deleteObject(bucketName, key).catch(() => {});
    }

    this.db
      .insert(objects)
      .values({
        id: crypto.randomUUID(),
        bucketId: bucket.id,
        objectKey: key,
        size: totalSize,
        etag,
        contentType: upload.contentType || "application/octet-stream",
        metadata: upload.metadata,
        parts: JSON.stringify(manifestParts),
        isMultipart: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    this.db.delete(multipartParts).where(eq(multipartParts.uploadId, uploadId)).run();
    this.db.delete(multipartUploads).where(eq(multipartUploads.uploadId, uploadId)).run();

    return { etag, size: totalSize };
  }

  async abortMultipart(uploadId: string): Promise<void> {
    const parts = this.db
      .select()
      .from(multipartParts)
      .where(eq(multipartParts.uploadId, uploadId))
      .all();

    for (const p of parts) {
      this.deleteDriveFile(p.accountId, p.driveFileId).catch(() => {});
    }

    this.db.delete(multipartParts).where(eq(multipartParts.uploadId, uploadId)).run();
    this.db.delete(multipartUploads).where(eq(multipartUploads.uploadId, uploadId)).run();
  }

  async sweepStaleMultipartUploads(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const staleUploads = this.db
      .select()
      .from(multipartUploads)
      .where(like(multipartUploads.createdAt, "%"))
      .all()
      .filter((u) => u.createdAt < cutoff);

    for (const u of staleUploads) {
      await this.abortMultipart(u.uploadId).catch(() => {});
    }
    return staleUploads.length;
  }

  private async getAccountToken(accountId: string) {
    const acc = this.db.select().from(buckets).all(); // dummy to avoid circular
    const { driveAccounts } = await import("../db/schema");
    const account = this.db.select().from(driveAccounts).where(eq(driveAccounts.id, accountId)).get();
    if (!account) throw new Error("Account not found");

    const refresh = await this.cipher.decrypt(account.refreshToken);
    const accessToken = await this.oauth.refreshAccessToken(refresh);
    return { account, accessToken };
  }

  private async deleteDriveFile(accountId: string, driveFileId: string) {
    try {
      const { accessToken } = await this.getAccountToken(accountId);
      await DriveClient.deleteFile(accessToken, driveFileId);
    } catch {
      // Best effort deletion
    }
  }
}
