import { eq, and } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import {
  buckets,
  driveAccounts,
  objects,
  type ManifestPart,
} from "../db/schema";
import type { Balancer } from "../drive/balancer";
import { DriveClient } from "../drive/client";
import type { TokenCipher } from "../core/crypto";
import type { GoogleOAuth } from "../drive/oauth";
import { notifyWebhookIfEnabled } from "../core/webhook";
import { MultipartEngine } from "./multipart";

function parseByteRange(
  rangeHeader: string,
  totalSize: number
): { start: number; end: number } | null {
  const match = rangeHeader.trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || totalSize <= 0) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    // Suffix byte range: bytes=-500
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, totalSize - suffix);
    end = totalSize - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Math.min(Number(rawEnd), totalSize - 1) : totalSize - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= totalSize) {
    throw new Error("InvalidRange");
  }
  return { start, end };
}

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

    // 2. Pastikan subfolder untuk bucket ada di dalam GDriveS3
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

    // Jika objek adalah multipart, gunakan stitched stream (dengan dukungan Range)
    if (obj.isMultipart && obj.parts) {
      const allParts: ManifestPart[] = JSON.parse(obj.parts);
      const totalSize = obj.size || allParts.reduce((sum, p) => sum + p.size, 0);
      const parsedRange = rangeHeader ? parseByteRange(rangeHeader, totalSize) : null;

      interface PartSlice {
        part: ManifestPart;
        rangeHeader?: string;
      }

      const slices: PartSlice[] = [];
      let offset = 0;
      for (const part of allParts) {
        const partStart = offset;
        const partEnd = offset + part.size - 1;
        offset += part.size;

        if (!parsedRange) {
          slices.push({ part });
        } else if (partEnd >= parsedRange.start && partStart <= parsedRange.end) {
          const localStart = Math.max(0, parsedRange.start - partStart);
          const localEnd = Math.min(part.size - 1, parsedRange.end - partStart);
          slices.push({
            part,
            rangeHeader: `bytes=${localStart}-${localEnd}`,
          });
        }
      }

      let currentSliceIdx = 0;
      let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      const self = this;

      const stitchedStream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          while (currentSliceIdx < slices.length) {
            if (!currentReader) {
              const slice = slices[currentSliceIdx];
              const { accessToken } = await self.getAccountToken(slice.part.accountId);
              const partRes = await DriveClient.downloadStream(
                accessToken,
                slice.part.driveFileId,
                slice.rangeHeader
              );
              if ((!partRes.ok && partRes.status !== 206) || !partRes.body) {
                throw new Error(`Gagal membaca part stream dari Drive (HTTP ${partRes.status})`);
              }
              currentReader = partRes.body.getReader();
            }

            const { done, value } = await currentReader.read();
            if (done) {
              currentReader = null;
              currentSliceIdx++;
              continue;
            }

            controller.enqueue(value);
            return;
          }
          controller.close();
        },
      });

      const responseHeaders: Record<string, string> = {
        "Content-Type": obj.contentType || "application/octet-stream",
        ETag: `"${obj.etag}"`,
        "Accept-Ranges": "bytes",
      };

      if (parsedRange) {
        const contentLength = parsedRange.end - parsedRange.start + 1;
        responseHeaders["Content-Length"] = String(contentLength);
        responseHeaders["Content-Range"] = `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`;
      } else {
        responseHeaders["Content-Length"] = String(totalSize);
      }

      return {
        obj,
        response: new Response(stitchedStream, {
          status: parsedRange ? 206 : 200,
          headers: responseHeaders,
        }),
      };
    }

    if (!obj.driveFileId || !obj.accountId) throw new Error("ObjectFileCorrupted");

    const { accessToken } = await this.getAccountToken(obj.accountId);
    const driveRes = await DriveClient.downloadStream(accessToken, obj.driveFileId, rangeHeader);
    if (!driveRes.ok && driveRes.status !== 206) {
      if (driveRes.status === 416) throw new Error("InvalidRange");
      throw new Error(`Gagal mengunduh file dari Drive (HTTP ${driveRes.status})`);
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

    if (obj.isMultipart && obj.parts) {
      const parts: ManifestPart[] = JSON.parse(obj.parts);
      for (const p of parts) {
        this.deleteDriveFile(p.accountId, p.driveFileId).catch(() => {});
        this.decrementAccountUsage(p.accountId, p.size);
      }
    } else if (obj.driveFileId && obj.accountId) {
      this.deleteDriveFile(obj.accountId, obj.driveFileId).catch(() => {});
      this.decrementAccountUsage(obj.accountId, obj.size || 0);
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

    // Hapus objek tujuan lama jika melakukan overwrite (menghindari duplikasi & mematuhi UNIQUE constraint)
    if (srcBucket.id !== dstBucket.id || srcKey !== dstKey) {
      await this.deleteObject(dstBucketName, dstKey);
    } else {
      return { etag: srcObj.etag };
    }

    if (srcObj.isMultipart && srcObj.parts) {
      const srcParts: ManifestPart[] = JSON.parse(srcObj.parts);
      const copiedParts: ManifestPart[] = [];

      for (let idx = 0; idx < srcParts.length; idx++) {
        const part = srcParts[idx];
        const { account, accessToken } = await this.getAccountToken(part.accountId);
        const rootFolderId = account.folderId || "";
        const targetFolderId = await DriveClient.ensureSubfolder(
          accessToken,
          dstBucketName,
          rootFolderId
        );
        const newDriveFileId = await DriveClient.copyFile(
          accessToken,
          part.driveFileId,
          `${dstKey}.part-${idx + 1}`,
          targetFolderId || rootFolderId
        );
        copiedParts.push({
          accountId: part.accountId,
          driveFileId: newDriveFileId,
          size: part.size,
          etag: part.etag,
        });
        this.balancer.recordUsage(part.accountId, part.size);
      }

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
          parts: JSON.stringify(copiedParts),
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

    this.balancer.recordUsage(srcObj.accountId!, srcObj.size || 0);
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

  listMultipartUploads(bucketName: string) {
    return this.multipart.listUploads(bucketName);
  }

  listParts(uploadId: string) {
    return this.multipart.listParts(uploadId);
  }

  sweepStaleMultipartUploads(maxAgeMs?: number) {
    return this.multipart.sweepStale(maxAgeMs);
  }

  private decrementAccountUsage(accountId: string, bytes: number) {
    if (bytes <= 0) return;
    const acc = this.db.select().from(driveAccounts).where(eq(driveAccounts.id, accountId)).get();
    if (!acc) return;
    const nextUsage = Math.max(0, (acc.storageUsage || 0) - bytes);
    this.db
      .update(driveAccounts)
      .set({ storageUsage: nextUsage, updatedAt: new Date().toISOString() })
      .where(eq(driveAccounts.id, accountId))
      .run();
  }

  private async getAccountToken(accountId: string) {
    const account = this.db.select().from(driveAccounts).where(eq(driveAccounts.id, accountId)).get();
    if (!account) throw new Error("Account not found");

    try {
      const refresh = await this.cipher.decrypt(account.refreshToken);
      const accessToken = await this.oauth.refreshAccessToken(refresh);
      return { account, accessToken };
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("token refresh") || msg.includes("invalid_grant")) {
        this.db
          .update(driveAccounts)
          .set({ status: "revoked", updatedAt: new Date().toISOString() })
          .where(eq(driveAccounts.id, account.id))
          .run();
      }
      void notifyWebhookIfEnabled(
        this.db,
        "auth_error",
        `Gagal refresh token OAuth untuk ${account.email}: ${msg}`,
        { email: account.email }
      );
      throw err;
    }
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
