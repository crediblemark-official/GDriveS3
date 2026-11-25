import { eq, and, sql } from "drizzle-orm";
import { existsSync, copyFileSync, renameSync, unlinkSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
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
import { logger } from "../core/logger";
import {
  LOCAL_VPS_ACCOUNT_ID,
  ensureFallbackDir,
  ensureSpoolDir,
  getLocalFallbackConfig,
} from "../core/fallbackConfig";
import { MultipartEngine, type UploadPayloadFn } from "./multipart";

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
    private cipher: TokenCipher,
    private dataDir: string = "./gdrives3-data"
  ) {
    this.multipart = new MultipartEngine(
      this.db,
      this.deleteDriveFile.bind(this),
      this.uploadWithDriveOrFallback.bind(this)
    );
  }

  private resolveFallbackPath(fileId: string): string {
    const dir = resolve(ensureFallbackDir(this.dataDir));
    const safeName = basename(fileId);
    const full = resolve(dir, safeName);
    if (!full.startsWith(dir + sep)) {
      throw new Error("Invalid local fallback path");
    }
    return full;
  }

  private async uploadWithDriveOrFallback(params: {
    bucketName: string;
    objectKey: string;
    driveFileName: string;
    contentType: string;
    body: ReadableStream;
    expectedSha256?: string;
  }): Promise<{ accountId: string; driveFileId: string; size: number; etag: string }> {
    const fallbackCfg = getLocalFallbackConfig(this.db);

    // Mode Zero Local Storage (fallback nonaktif): stream langsung ke Drive
    if (!fallbackCfg.enabled) {
      const { account, accessToken } = await this.balancer.pickAccount(params.objectKey);
      const rootFolderId = account.folderId || "";
      const bucketFolderId = await DriveClient.ensureSubfolder(
        accessToken,
        params.bucketName,
        rootFolderId
      );

      const hasher = new Bun.CryptoHasher("md5");
      const shaHasher = params.expectedSha256 ? new Bun.CryptoHasher("sha256") : null;
      let totalBytes = 0;

      const countingStream = params.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            hasher.update(chunk);
            if (shaHasher) shaHasher.update(chunk);
            totalBytes += chunk.byteLength;
            controller.enqueue(chunk);
          },
        })
      );

      const driveFileId = await DriveClient.uploadStream(
        accessToken,
        bucketFolderId || rootFolderId,
        params.driveFileName,
        params.contentType,
        countingStream
      );

      if (params.expectedSha256 && shaHasher) {
        const actualSha = shaHasher.digest("hex");
        if (actualSha !== params.expectedSha256.toLowerCase()) {
          await this.deleteDriveFile(account.id, driveFileId, params.objectKey).catch(() => {});
          throw new Error("XAmzContentSHA256Mismatch");
        }
      }

      this.balancer.recordUsage(account.id, totalBytes);
      return {
        accountId: account.id,
        driveFileId,
        size: totalBytes,
        etag: hasher.digest("hex"),
      };
    }

    // Mode Fallback VPS Aktif: spool ke file sementara agar aman di-fallback bila Drive gagal di tengah stream
    const spoolDir = ensureSpoolDir(this.dataDir);
    const spoolPath = join(spoolDir, `${crypto.randomUUID()}.tmp`);
    const hasher = new Bun.CryptoHasher("md5");
    const shaHasher = params.expectedSha256 ? new Bun.CryptoHasher("sha256") : null;
    let totalBytes = 0;

    const writer = Bun.file(spoolPath).writer();
    const reader = params.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          hasher.update(value);
          if (shaHasher) shaHasher.update(value);
          totalBytes += value.byteLength;
          writer.write(value);
        }
      }
      await writer.end();
    } catch (err) {
      try {
        await writer.end();
      } catch {
        // ignore
      }
      if (existsSync(spoolPath)) unlinkSync(spoolPath);
      throw err;
    }

    if (params.expectedSha256 && shaHasher) {
      const actualSha = shaHasher.digest("hex");
      if (actualSha !== params.expectedSha256.toLowerCase()) {
        if (existsSync(spoolPath)) unlinkSync(spoolPath);
        throw new Error("XAmzContentSHA256Mismatch");
      }
    }

    const etag = hasher.digest("hex");

    // Coba unggah ke Google Drive terlebih dahulu
    try {
      const { account, accessToken } = await this.balancer.pickAccount(params.objectKey);
      const rootFolderId = account.folderId || "";
      const bucketFolderId = await DriveClient.ensureSubfolder(
        accessToken,
        params.bucketName,
        rootFolderId
      );
      const driveFileId = await DriveClient.uploadStream(
        accessToken,
        bucketFolderId || rootFolderId,
        params.driveFileName,
        params.contentType,
        Bun.file(spoolPath).stream()
      );
      if (existsSync(spoolPath)) unlinkSync(spoolPath);
      this.balancer.recordUsage(account.id, totalBytes);
      return { accountId: account.id, driveFileId, size: totalBytes, etag };
    } catch (driveErr: any) {
      // Fallback ke penyimpanan lokal VPS
      if (fallbackCfg.maxMb > 0) {
        const stats = this.getLocalFallbackStats();
        const maxBytes = fallbackCfg.maxMb * 1024 * 1024;
        if (stats.totalBytes + totalBytes > maxBytes) {
          if (existsSync(spoolPath)) unlinkSync(spoolPath);
          throw new Error(
            `Google Drive gagal (${driveErr?.message}) & batas kuota fallback VPS (${fallbackCfg.maxMb} MB) penuh`
          );
        }
      }

      const localFileId = `${crypto.randomUUID()}.bin`;
      const targetPath = this.resolveFallbackPath(localFileId);
      renameSync(spoolPath, targetPath);

      logger.warn(
        "fallback",
        `Drive gagal (${driveErr?.message || "unknown"}), menyimpan ${params.bucketName}/${params.objectKey} ke VPS (${localFileId})`
      );
      if (fallbackCfg.notifyOnFallback) {
        void notifyWebhookIfEnabled(
          this.db,
          "fallback_used",
          `Upload ${params.bucketName}/${params.objectKey} dialihkan ke penyimpanan VPS karena Google Drive gagal: ${driveErr?.message}`,
          { bucket: params.bucketName, key: params.objectKey, size: totalBytes }
        );
      }

      return {
        accountId: LOCAL_VPS_ACCOUNT_ID,
        driveFileId: localFileId,
        size: totalBytes,
        etag,
      };
    }
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

    const uploaded = await this.uploadWithDriveOrFallback({
      bucketName,
      objectKey: key,
      driveFileName: key,
      contentType,
      body,
      expectedSha256,
    });

    const now = new Date().toISOString();

    // Update / Insert di DB
    const existing = this.db
      .select()
      .from(objects)
      .where(and(eq(objects.bucketId, bucket.id), eq(objects.objectKey, key)))
      .get();

    if (existing) {
      if (existing.isMultipart && existing.parts) {
        const oldParts: ManifestPart[] = JSON.parse(existing.parts);
        for (const p of oldParts) {
          this.deleteDriveFile(p.accountId, p.driveFileId, key).catch(() => {});
        }
      } else if (existing.driveFileId && existing.accountId) {
        this.deleteDriveFile(existing.accountId, existing.driveFileId, key).catch(() => {});
      }
      this.db
        .update(objects)
        .set({
          size: uploaded.size,
          etag: uploaded.etag,
          contentType,
          metadata,
          accountId: uploaded.accountId,
          driveFileId: uploaded.driveFileId,
          parts: null,
          isMultipart: 0,
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
          size: uploaded.size,
          etag: uploaded.etag,
          contentType,
          metadata,
          accountId: uploaded.accountId,
          driveFileId: uploaded.driveFileId,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    return { etag: uploaded.etag, size: uploaded.size };
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
              if (slice.part.accountId === LOCAL_VPS_ACCOUNT_ID) {
                const localFile = Bun.file(self.resolveFallbackPath(slice.part.driveFileId));
                if (!(await localFile.exists())) {
                  throw new Error("Part lokal fallback VPS tidak ditemukan");
                }
                if (slice.rangeHeader) {
                  const m = slice.rangeHeader.match(/^bytes=(\d+)-(\d+)$/);
                  if (m) {
                    currentReader = localFile.slice(Number(m[1]), Number(m[2]) + 1).stream().getReader();
                  } else {
                    currentReader = localFile.stream().getReader();
                  }
                } else {
                  currentReader = localFile.stream().getReader();
                }
              } else {
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

    if (obj.accountId === LOCAL_VPS_ACCOUNT_ID) {
      const localFile = Bun.file(this.resolveFallbackPath(obj.driveFileId));
      if (!(await localFile.exists())) throw new Error("NoSuchKey");
      const totalSize = obj.size || localFile.size;
      const parsedRange = rangeHeader ? parseByteRange(rangeHeader, totalSize) : null;
      const headers: Record<string, string> = {
        "Content-Type": obj.contentType || "application/octet-stream",
        ETag: `"${obj.etag}"`,
        "Accept-Ranges": "bytes",
      };
      if (parsedRange) {
        const contentLen = parsedRange.end - parsedRange.start + 1;
        headers["Content-Range"] = `bytes ${parsedRange.start}-${parsedRange.end}/${totalSize}`;
        headers["Content-Length"] = String(contentLen);
        return {
          obj,
          response: new Response(localFile.slice(parsedRange.start, parsedRange.end + 1).stream(), {
            status: 206,
            headers,
          }),
        };
      }
      headers["Content-Length"] = String(totalSize);
      return {
        obj,
        response: new Response(localFile.stream(), { status: 200, headers }),
      };
    }

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
        if (part.accountId === LOCAL_VPS_ACCOUNT_ID) {
          const srcPath = this.resolveFallbackPath(part.driveFileId);
          const newLocalId = `${crypto.randomUUID()}.bin`;
          copyFileSync(srcPath, this.resolveFallbackPath(newLocalId));
          copiedParts.push({
            accountId: LOCAL_VPS_ACCOUNT_ID,
            driveFileId: newLocalId,
            size: part.size,
            etag: part.etag,
          });
          continue;
        }
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

    if (srcObj.accountId === LOCAL_VPS_ACCOUNT_ID && srcObj.driveFileId) {
      const srcPath = this.resolveFallbackPath(srcObj.driveFileId);
      const newLocalId = `${crypto.randomUUID()}.bin`;
      copyFileSync(srcPath, this.resolveFallbackPath(newLocalId));
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
          accountId: LOCAL_VPS_ACCOUNT_ID,
          driveFileId: newLocalId,
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
    if (accountId === LOCAL_VPS_ACCOUNT_ID) {
      try {
        const localPath = this.resolveFallbackPath(driveFileId);
        if (existsSync(localPath)) unlinkSync(localPath);
      } catch {
        // best effort local delete
      }
      return;
    }

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
          const missingPart = parsed.find((p) =>
            p.accountId === LOCAL_VPS_ACCOUNT_ID
              ? !existsSync(this.resolveFallbackPath(p.driveFileId))
              : scannedAccounts.has(p.accountId) && !foundInDrive.has(p.driveFileId)
          );
          if (missingPart) {
            missingInDrive.push({
              objectId: obj.id,
              bucketName: bName,
              key: obj.objectKey,
              driveFileId: missingPart.driveFileId,
              accountEmail:
                missingPart.accountId === LOCAL_VPS_ACCOUNT_ID
                  ? "VPS Fallback (lokal)"
                  : accountEmailMap.get(missingPart.accountId) || missingPart.accountId,
              size: obj.size,
            });
          }
        } catch {
          // ignore
        }
      } else if (obj.accountId && obj.driveFileId) {
        const isMissing =
          obj.accountId === LOCAL_VPS_ACCOUNT_ID
            ? !existsSync(this.resolveFallbackPath(obj.driveFileId))
            : scannedAccounts.has(obj.accountId) && !foundInDrive.has(obj.driveFileId);
        if (isMissing) {
          missingInDrive.push({
            objectId: obj.id,
            bucketName: bName,
            key: obj.objectKey,
            driveFileId: obj.driveFileId,
            accountEmail:
              obj.accountId === LOCAL_VPS_ACCOUNT_ID
                ? "VPS Fallback (lokal)"
                : accountEmailMap.get(obj.accountId) || obj.accountId,
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

  getLocalFallbackStats(): {
    objectsCount: number;
    totalBytes: number;
    items: { id: string; bucketName: string; key: string; size: number; isMultipart: boolean; updatedAt: string }[];
  } {
    const bucketMap = new Map(
      this.db
        .select()
        .from(buckets)
        .all()
        .map((b) => [b.id, b.name])
    );

    const singleFallback = this.db
      .select()
      .from(objects)
      .where(eq(objects.accountId, LOCAL_VPS_ACCOUNT_ID))
      .all();

    const multipartCandidates = this.db
      .select()
      .from(objects)
      .where(and(eq(objects.isMultipart, 1), sql`${objects.parts} LIKE ${`%${LOCAL_VPS_ACCOUNT_ID}%`}`))
      .all();

    let totalBytes = 0;
    const items: { id: string; bucketName: string; key: string; size: number; isMultipart: boolean; updatedAt: string }[] = [];

    for (const obj of singleFallback) {
      totalBytes += obj.size || 0;
      items.push({
        id: obj.id,
        bucketName: bucketMap.get(obj.bucketId) || "(unknown)",
        key: obj.objectKey,
        size: obj.size || 0,
        isMultipart: false,
        updatedAt: obj.updatedAt,
      });
    }

    for (const obj of multipartCandidates) {
      let localPartBytes = 0;
      try {
        const parts: ManifestPart[] = JSON.parse(obj.parts || "[]");
        for (const p of parts) {
          if (p.accountId === LOCAL_VPS_ACCOUNT_ID) localPartBytes += p.size || 0;
        }
      } catch {
        // ignore
      }
      if (localPartBytes > 0) {
        totalBytes += localPartBytes;
        items.push({
          id: obj.id,
          bucketName: bucketMap.get(obj.bucketId) || "(unknown)",
          key: obj.objectKey,
          size: localPartBytes,
          isMultipart: true,
          updatedAt: obj.updatedAt,
        });
      }
    }

    return {
      objectsCount: items.length,
      totalBytes,
      items,
    };
  }

  async syncLocalFallbackToDrive(): Promise<{ migrated: number; failed: number; remaining: number }> {
    const bucketMap = new Map(
      this.db
        .select()
        .from(buckets)
        .all()
        .map((b) => [b.id, b.name])
    );

    const singleFallback = this.db
      .select()
      .from(objects)
      .where(eq(objects.accountId, LOCAL_VPS_ACCOUNT_ID))
      .all();

    let migrated = 0;
    let failed = 0;

    for (const obj of singleFallback) {
      if (!obj.driveFileId) continue;
      const bucketName = bucketMap.get(obj.bucketId);
      if (!bucketName) continue;
      const localPath = this.resolveFallbackPath(obj.driveFileId);
      if (!existsSync(localPath)) {
        failed++;
        continue;
      }

      try {
        const { account, accessToken } = await this.balancer.pickAccount(obj.objectKey);
        const rootFolderId = account.folderId || "";
        const bucketFolderId = await DriveClient.ensureSubfolder(accessToken, bucketName, rootFolderId);
        const newDriveFileId = await DriveClient.uploadStream(
          accessToken,
          bucketFolderId || rootFolderId,
          obj.objectKey,
          obj.contentType || "application/octet-stream",
          Bun.file(localPath).stream()
        );

        this.db
          .update(objects)
          .set({
            accountId: account.id,
            driveFileId: newDriveFileId,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(objects.id, obj.id))
          .run();

        this.balancer.recordUsage(account.id, obj.size || 0);
        if (existsSync(localPath)) unlinkSync(localPath);
        migrated++;
      } catch {
        failed++;
      }
    }

    const multipartCandidates = this.db
      .select()
      .from(objects)
      .where(and(eq(objects.isMultipart, 1), sql`${objects.parts} LIKE ${`%${LOCAL_VPS_ACCOUNT_ID}%`}`))
      .all();

    for (const obj of multipartCandidates) {
      const bucketName = bucketMap.get(obj.bucketId);
      if (!bucketName || !obj.parts) continue;
      let parts: ManifestPart[];
      try {
        parts = JSON.parse(obj.parts);
      } catch {
        continue;
      }

      let changed = false;
      let objFailed = false;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.accountId !== LOCAL_VPS_ACCOUNT_ID) continue;
        const localPath = this.resolveFallbackPath(p.driveFileId);
        if (!existsSync(localPath)) {
          objFailed = true;
          continue;
        }
        try {
          const { account, accessToken } = await this.balancer.pickAccount(obj.objectKey);
          const rootFolderId = account.folderId || "";
          const bucketFolderId = await DriveClient.ensureSubfolder(accessToken, bucketName, rootFolderId);
          const newDriveFileId = await DriveClient.uploadStream(
            accessToken,
            bucketFolderId || rootFolderId,
            `${obj.objectKey}.part-${i + 1}`,
            "application/octet-stream",
            Bun.file(localPath).stream()
          );
          parts[i] = {
            ...p,
            accountId: account.id,
            driveFileId: newDriveFileId,
          };
          this.balancer.recordUsage(account.id, p.size || 0);
          if (existsSync(localPath)) unlinkSync(localPath);
          changed = true;
        } catch {
          objFailed = true;
        }
      }

      if (changed) {
        this.db
          .update(objects)
          .set({
            parts: JSON.stringify(parts),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(objects.id, obj.id))
          .run();
      }

      if (!objFailed && changed) migrated++;
      else if (objFailed) failed++;
    }

    const remaining = this.getLocalFallbackStats().objectsCount;
    return { migrated, failed, remaining };
  }
}
