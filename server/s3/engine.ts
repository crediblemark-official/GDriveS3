import { eq, and } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import {
  buckets,
  driveAccounts,
  multipartParts,
  objects,
  pendingDriveDeletes,
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
    body: ReadableStream,
    expectedSha256?: string
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

    // 3. Transform stream untuk menghitung ETag, byte size, dan optional SHA-256
    const hasher = new Bun.CryptoHasher("md5");
    const shaHasher = expectedSha256 ? new Bun.CryptoHasher("sha256") : null;
    let totalBytes = 0;

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        hasher.update(chunk);
        if (shaHasher) shaHasher.update(chunk);
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

    if (expectedSha256 && shaHasher) {
      const actualSha = shaHasher.digest("hex");
      if (actualSha !== expectedSha256.toLowerCase()) {
        await this.deleteDriveFile(account.id, driveFileId, key).catch(() => {});
        throw new Error("XAmzContentSHA256Mismatch");
      }
    }

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
        this.deleteDriveFile(existing.accountId, existing.driveFileId, key).catch(() => {});
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
      await Promise.all(
        parts.map(async (p) => {
          await this.deleteDriveFile(p.accountId, p.driveFileId, key);
          this.decrementAccountUsage(p.accountId, p.size);
        })
      );
    } else if (obj.driveFileId && obj.accountId) {
      await this.deleteDriveFile(obj.accountId, obj.driveFileId, key);
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

  uploadPart(uploadId: string, partNumber: number, body: ReadableStream, expectedSha256?: string) {
    return this.multipart.uploadPart(uploadId, partNumber, body, expectedSha256);
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

  private async deleteDriveFile(accountId: string, driveFileId: string, objectKey?: string) {
    try {
      const { accessToken } = await this.getAccountToken(accountId);
      await DriveClient.deleteFile(accessToken, driveFileId);
    } catch (err: any) {
      const now = new Date().toISOString();
      const errMsg = String(err?.message || "Delete failed");
      const existing = this.db
        .select()
        .from(pendingDriveDeletes)
        .where(
          and(
            eq(pendingDriveDeletes.accountId, accountId),
            eq(pendingDriveDeletes.driveFileId, driveFileId)
          )
        )
        .get();

      if (existing) {
        this.db
          .update(pendingDriveDeletes)
          .set({
            attempts: existing.attempts + 1,
            lastError: errMsg,
            updatedAt: now,
          })
          .where(eq(pendingDriveDeletes.id, existing.id))
          .run();
      } else {
        this.db
          .insert(pendingDriveDeletes)
          .values({
            id: crypto.randomUUID(),
            accountId,
            driveFileId,
            objectKey: objectKey || null,
            attempts: 1,
            lastError: errMsg,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    }
  }

  listPendingDeletes() {
    const rows = this.db.select().from(pendingDriveDeletes).all();
    const accMap = new Map(
      this.db
        .select({ id: driveAccounts.id, email: driveAccounts.email })
        .from(driveAccounts)
        .all()
        .map((a) => [a.id, a.email])
    );
    return rows.map((r) => ({
      ...r,
      accountEmail: accMap.get(r.accountId) || "(akun terhapus)",
    }));
  }

  async retryPendingDeletes(): Promise<{ retried: number; succeeded: number; remaining: number }> {
    const pending = this.db.select().from(pendingDriveDeletes).all();
    let succeeded = 0;

    for (const item of pending) {
      const acc = this.db
        .select()
        .from(driveAccounts)
        .where(eq(driveAccounts.id, item.accountId))
        .get();
      if (!acc) {
        // Akun sudah dihapus dari pool; tidak ada token untuk menghapus file di Drive
        this.db.delete(pendingDriveDeletes).where(eq(pendingDriveDeletes.id, item.id)).run();
        succeeded++;
        continue;
      }

      try {
        const { accessToken } = await this.getAccountToken(item.accountId);
        await DriveClient.deleteFile(accessToken, item.driveFileId);
        this.db.delete(pendingDriveDeletes).where(eq(pendingDriveDeletes.id, item.id)).run();
        succeeded++;
      } catch (err: any) {
        this.db
          .update(pendingDriveDeletes)
          .set({
            attempts: item.attempts + 1,
            lastError: String(err?.message || "Retry failed"),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(pendingDriveDeletes.id, item.id))
          .run();
      }
    }

    const remaining = this.db.select().from(pendingDriveDeletes).all().length;
    return { retried: pending.length, succeeded, remaining };
  }

  async auditDrivePool() {
    const accounts = this.db.select().from(driveAccounts).all();
    const bucketRows = this.db.select().from(buckets).all();
    const bucketNameMap = new Map(bucketRows.map((b) => [b.id, b.name]));
    const allObjects = this.db.select().from(objects).all();
    const allMpParts = this.db.select().from(multipartParts).all();
    const pendingIds = new Set(
      this.db
        .select({ driveFileId: pendingDriveDeletes.driveFileId })
        .from(pendingDriveDeletes)
        .all()
        .map((p) => p.driveFileId)
    );

    const dbFileIds = new Set<string>();
    for (const obj of allObjects) {
      if (obj.driveFileId) dbFileIds.add(obj.driveFileId);
      if (obj.isMultipart && obj.parts) {
        try {
          const parsed: ManifestPart[] = JSON.parse(obj.parts);
          for (const p of parsed) dbFileIds.add(p.driveFileId);
        } catch {
          // ignore malformed json
        }
      }
    }
    for (const mp of allMpParts) {
      dbFileIds.add(mp.driveFileId);
    }

    const foundInDrive = new Map<
      string,
      { accountId: string; accountEmail: string; name: string; folderName: string; size: number }
    >();
    const scannedAccounts = new Set<string>();
    const accountErrors: { accountId: string; email: string; error: string }[] = [];

    for (const acc of accounts) {
      if (!acc.folderId) continue;
      try {
        const { accessToken } = await this.getAccountToken(acc.id);
        const topEntries = await DriveClient.listFolderFiles(accessToken, acc.folderId);
        scannedAccounts.add(acc.id);

        for (const entry of topEntries) {
          if (entry.mimeType === "application/vnd.google-apps.folder") {
            const subFiles = await DriveClient.listFolderFiles(accessToken, entry.id);
            for (const f of subFiles) {
              foundInDrive.set(f.id, {
                accountId: acc.id,
                accountEmail: acc.email,
                name: f.name,
                folderName: entry.name,
                size: f.size,
              });
            }
          } else {
            foundInDrive.set(entry.id, {
              accountId: acc.id,
              accountEmail: acc.email,
              name: entry.name,
              folderName: "(root)",
              size: entry.size,
            });
          }
        }
      } catch (err: any) {
        accountErrors.push({
          accountId: acc.id,
          email: acc.email,
          error: String(err?.message || "Gagal memindai Drive"),
        });
      }
    }

    const orphanInDrive: {
      accountId: string;
      accountEmail: string;
      driveFileId: string;
      name: string;
      folderName: string;
      size: number;
      isPendingDelete: boolean;
    }[] = [];

    for (const [driveFileId, info] of foundInDrive.entries()) {
      if (!dbFileIds.has(driveFileId)) {
        orphanInDrive.push({
          ...info,
          driveFileId,
          isPendingDelete: pendingIds.has(driveFileId),
        });
      }
    }

    const accountEmailMap = new Map(accounts.map((a) => [a.id, a.email]));
    const missingInDrive: {
      objectId: string;
      bucketName: string;
      key: string;
      driveFileId: string;
      accountEmail: string;
      size: number;
    }[] = [];

    for (const obj of allObjects) {
      const bName = bucketNameMap.get(obj.bucketId) || "(unknown)";
      if (obj.isMultipart && obj.parts) {
        try {
          const parsed: ManifestPart[] = JSON.parse(obj.parts);
          const missingPart = parsed.find(
            (p) => scannedAccounts.has(p.accountId) && !foundInDrive.has(p.driveFileId)
          );
          if (missingPart) {
            missingInDrive.push({
              objectId: obj.id,
              bucketName: bName,
              key: obj.objectKey,
              driveFileId: missingPart.driveFileId,
              accountEmail: accountEmailMap.get(missingPart.accountId) || missingPart.accountId,
              size: obj.size,
            });
          }
        } catch {
          // ignore
        }
      } else if (obj.accountId && obj.driveFileId) {
        if (scannedAccounts.has(obj.accountId) && !foundInDrive.has(obj.driveFileId)) {
          missingInDrive.push({
            objectId: obj.id,
            bucketName: bName,
            key: obj.objectKey,
            driveFileId: obj.driveFileId,
            accountEmail: accountEmailMap.get(obj.accountId) || obj.accountId,
            size: obj.size,
          });
        }
      }
    }

    return {
      scannedAt: new Date().toISOString(),
      accountsScanned: scannedAccounts.size,
      accountErrors,
      driveFilesCount: foundInDrive.size,
      dbObjectsCount: allObjects.length,
      missingInDrive,
      orphanInDrive,
      pendingDeletesCount: pendingIds.size,
    };
  }

  async cleanupAudit(input: {
    missingObjectIds?: string[];
    orphanItems?: { accountId: string; driveFileId: string }[];
  }): Promise<{ removedDbObjects: number; deletedDriveFiles: number }> {
    let removedDbObjects = 0;
    let deletedDriveFiles = 0;

    for (const objId of input.missingObjectIds || []) {
      const row = this.db.select().from(objects).where(eq(objects.id, objId)).get();
      if (row) {
        this.db.delete(objects).where(eq(objects.id, objId)).run();
        removedDbObjects++;
      }
    }

    for (const orphan of input.orphanItems || []) {
      try {
        const { accessToken } = await this.getAccountToken(orphan.accountId);
        await DriveClient.deleteFile(accessToken, orphan.driveFileId);
        deletedDriveFiles++;
      } catch (err: any) {
        await this.deleteDriveFile(orphan.accountId, orphan.driveFileId, orphan.driveFileId);
      }
    }

    return { removedDbObjects, deletedDriveFiles };
  }
}
