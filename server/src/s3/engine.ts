import { eq, and, like } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { buckets, objects, type ManifestPart } from "../db/schema";
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
    const folderId = account.folderId || "";

    // 2. Buffer/Stream byte & hitung MD5 hash ETag
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

    // 3. Upload stream langsung ke Google Drive
    const fileName = `${key.replace(/\//g, "_")}-${Date.now()}`;
    const driveFileId = await DriveClient.uploadStream(
      accessToken,
      folderId,
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
    const { accessToken } = await this.getAccountToken(srcObj.accountId!);
    const newDriveFileId = await DriveClient.copyFile(
      accessToken,
      srcObj.driveFileId!,
      `${dstKey.replace(/\//g, "_")}-${Date.now()}`
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
