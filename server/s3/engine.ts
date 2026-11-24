import { eq, and } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import {
  buckets,
  objects,
  type ManifestPart,
} from "../db/schema";
import type { Balancer } from "../drive/balancer";
import { DriveClient } from "../drive/client";
import type { TokenCipher } from "../core/crypto";
import type { GoogleOAuth } from "../drive/oauth";
import { MultipartEngine } from "./multipart";

export class S3Engine {
  private multipart: MultipartEngine;

  constructor(
    private db: AppDatabase,
    private balancer: Balancer,
    private oauth: GoogleOAuth,
    private cipher: TokenCipher
  ) {
    this.multipart = new MultipartEngine(
      this.db,
      this.balancer,
      this.deleteDriveFile.bind(this)
    );
  }

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

    // 3. Transform stream untuk menghitung ETag & byte size secara streaming
    const hasher = new Bun.CryptoHasher("md5");
    let totalBytes = 0;

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

    // 5. Update / Insert di DB
    const existing = this.db
      .select()
      .from(objects)
      .where(and(eq(objects.bucketId, bucket.id), eq(objects.objectKey, key)))
      .get();

    if (existing) {
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

    this.balancer.recordUsage(account.id, totalBytes);
    return { etag, size: totalBytes };
  }

  async getObject(
    bucketName: string,
    key: string,
    rangeHeader?: string | null
  ): Promise<{ obj: any; response: Response }> {
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
            "Content-Type": obj.contentType || "application/octet-stream",
            "Content-Length": String(obj.size || 0),
            ETag: `"${obj.etag}"`,
          },
        }),
      };
    }

    if (!obj.driveFileId || !obj.accountId) throw new Error("ObjectFileCorrupted");

    const { accessToken } = await this.getAccountToken(obj.accountId);
    const driveRes = await DriveClient.downloadStream(accessToken, obj.driveFileId, rangeHeader);

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

    if (obj.isMultipart && obj.parts) {
      const parts: ManifestPart[] = JSON.parse(obj.parts);
      for (const p of parts) {
        this.deleteDriveFile(p.accountId, p.driveFileId).catch(() => {});
      }
    } else if (obj.driveFileId && obj.accountId) {
      this.deleteDriveFile(obj.accountId, obj.driveFileId).catch(() => {});
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
    if (!srcBucket) throw new Error("NoSuchBucket");

    const dstBucket = this.db.select().from(buckets).where(eq(buckets.name, dstBucketName)).get();
    if (!dstBucket) throw new Error("NoSuchBucket");

    const srcObj = this.db
      .select()
      .from(objects)
      .where(and(eq(objects.bucketId, srcBucket.id), eq(objects.objectKey, srcKey)))
      .get();

    if (!srcObj) throw new Error("NoSuchKey");

    if (srcObj.isMultipart) {
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
          parts: srcObj.parts,
          isMultipart: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return { etag: srcObj.etag };
    }

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

  // --- Delegated Multipart Operations ---

  initiateMultipart(bucketName: string, key: string, contentType: string, metadata: string) {
    return this.multipart.initiate(bucketName, key, contentType, metadata);
  }

  uploadPart(uploadId: string, partNumber: number, body: ReadableStream) {
    return this.multipart.uploadPart(uploadId, partNumber, body);
  }

  completeMultipart(bucketName: string, key: string, uploadId: string) {
    return this.multipart.complete(bucketName, key, uploadId, this.deleteObject.bind(this));
  }

  abortMultipart(uploadId: string) {
    return this.multipart.abort(uploadId);
  }

  sweepStaleMultipartUploads(maxAgeMs?: number) {
    return this.multipart.sweepStale(maxAgeMs);
  }

  private async getAccountToken(accountId: string) {
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
