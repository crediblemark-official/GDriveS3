import { eq, like, and } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import {
  buckets,
  objects,
  multipartUploads,
  multipartParts,
  type ManifestPart,
} from "../db/schema";
import type { Balancer } from "../drive/balancer";
import { DriveClient } from "../drive/client";

export class MultipartEngine {
  constructor(
    private db: AppDatabase,
    private balancer: Balancer,
    private deleteDriveFile: (accountId: string, driveFileId: string) => Promise<void>
  ) {}

  async initiate(
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
    body: ReadableStream,
    expectedSha256?: string
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
    const shaHasher = expectedSha256 ? new Bun.CryptoHasher("sha256") : null;
    let partBytes = 0;

    const transformStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        hasher.update(chunk);
        if (shaHasher) shaHasher.update(chunk);
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

    if (expectedSha256 && shaHasher) {
      const actualSha = shaHasher.digest("hex");
      if (actualSha !== expectedSha256.toLowerCase()) {
        await this.deleteDriveFile(account.id, driveFileId).catch(() => {});
        throw new Error("XAmzContentSHA256Mismatch");
      }
    }

    const etag = hasher.digest("hex");

    // Ganti part lama jika partNumber diunggah ulang
    const existingPart = this.db
      .select()
      .from(multipartParts)
      .where(and(eq(multipartParts.uploadId, uploadId), eq(multipartParts.partNumber, partNumber)))
      .get();
    if (existingPart) {
      this.deleteDriveFile(existingPart.accountId, existingPart.driveFileId).catch(() => {});
      this.db.delete(multipartParts).where(eq(multipartParts.id, existingPart.id)).run();
    }

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

  async complete(
    bucketName: string,
    key: string,
    uploadId: string,
    deleteObjectFn: (bName: string, oKey: string) => Promise<void>
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
      await deleteObjectFn(bucketName, key);
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

  async abort(uploadId: string): Promise<void> {
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

  listUploads(bucketName: string) {
    const bucket = this.db.select().from(buckets).where(eq(buckets.name, bucketName)).get();
    if (!bucket) throw new Error("NoSuchBucket");
    return this.db
      .select()
      .from(multipartUploads)
      .where(eq(multipartUploads.bucketId, bucket.id))
      .all();
  }

  listParts(uploadId: string) {
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
    parts.sort((a, b) => a.partNumber - b.partNumber);
    return { upload, parts };
  }

  async sweepStale(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const staleUploads = this.db
      .select()
      .from(multipartUploads)
      .where(like(multipartUploads.createdAt, "%"))
      .all()
      .filter((u) => u.createdAt < cutoff);

    for (const u of staleUploads) {
      await this.abort(u.uploadId).catch(() => {});
    }
    return staleUploads.length;
  }
}
