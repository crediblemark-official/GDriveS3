import { Elysia } from "elysia";
import { eq, and } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { buckets, objects, s3AccessKeys } from "../db/schema";
import type { S3Engine } from "./engine";
import type { TokenCipher } from "../core/crypto";
import { parseSigV4, verifySigV4 } from "./sigv4";
import {
  xmlListBuckets,
  xmlListObjectsV2,
  xmlError,
  xmlCompleteMultipart,
  xmlInitiateMultipart,
} from "./xml";

export function createS3Router(
  db: AppDatabase,
  engine: S3Engine,
  cipher: TokenCipher
) {
  const router = new Elysia();

  // Middleware Auth SigV4
  router.onRequest(async ({ request, set }) => {
    // 1. Parse Credential
    const cred = parseSigV4(request);
    if (!cred) {
      set.status = 403;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("AccessDenied", "Missing or invalid AWS SigV4 credentials", request.url);
    }

    // 2. Cari Access Key di DB
    const keyRow = db
      .select()
      .from(s3AccessKeys)
      .where(eq(s3AccessKeys.accessKeyId, cred.accessKeyId))
      .get();

    if (!keyRow) {
      set.status = 403;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("InvalidAccessKeyId", "Access Key ID tidak ditemukan", request.url);
    }

    // 3. Verifikasi Signature
    const secretKey = await cipher.decrypt(keyRow.secretHash);
    const isValid = await verifySigV4(request, cred, secretKey);

    if (!isValid) {
      set.status = 403;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("SignatureDoesNotMatch", "Signature tidak cocok", request.url);
    }
  });

  // 1. Root Operations (List Buckets)
  router.get("/", async ({ set }) => {
    const allBuckets = db.select().from(buckets).all();
    set.headers["Content-Type"] = "application/xml";
    return xmlListBuckets(allBuckets);
  });

  // 2. Bucket Operations (Create, Delete, List Objects)
  router.get("/:bucket", async ({ params, query, set }) => {
    const bucketName = params.bucket;
    const bucket = db.select().from(buckets).where(eq(buckets.name, bucketName)).get();

    if (!bucket) {
      set.status = 404;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("NoSuchBucket", "Bucket tidak ditemukan", bucketName);
    }

    const prefix = (query.prefix as string) || "";
    const delimiter = (query.delimiter as string) || "";

    const allObjects = db
      .select()
      .from(objects)
      .where(eq(objects.bucketId, bucket.id))
      .all();

    const contents: { key: string; size: number; etag: string; updatedAt: string }[] = [];
    const commonPrefixes = new Set<string>();

    for (const obj of allObjects) {
      if (!obj.objectKey.startsWith(prefix)) continue;

      if (delimiter) {
        const afterPrefix = obj.objectKey.slice(prefix.length);
        const idx = afterPrefix.indexOf(delimiter);
        if (idx >= 0) {
          commonPrefixes.add(prefix + afterPrefix.slice(0, idx + 1));
          continue;
        }
      }

      contents.push({
        key: obj.objectKey,
        size: obj.size,
        etag: obj.etag,
        updatedAt: obj.updatedAt,
      });
    }

    set.headers["Content-Type"] = "application/xml";
    return xmlListObjectsV2(bucketName, prefix, contents, Array.from(commonPrefixes));
  });

  router.put("/:bucket", async ({ params, set }) => {
    const bucketName = params.bucket;
    const existing = db.select().from(buckets).where(eq(buckets.name, bucketName)).get();

    if (existing) {
      set.status = 200;
      return "";
    }

    db.insert(buckets)
      .values({
        id: crypto.randomUUID(),
        name: bucketName,
        createdAt: new Date().toISOString(),
      })
      .run();

    set.status = 200;
    set.headers["Location"] = `/${bucketName}`;
    return "";
  });

  router.delete("/:bucket", async ({ params, set }) => {
    const bucketName = params.bucket;
    const bucket = db.select().from(buckets).where(eq(buckets.name, bucketName)).get();

    if (!bucket) {
      set.status = 404;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("NoSuchBucket", "Bucket tidak ditemukan", bucketName);
    }

    const objCount = db
      .select()
      .from(objects)
      .where(eq(objects.bucketId, bucket.id))
      .all().length;

    if (objCount > 0) {
      set.status = 409;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("BucketNotEmpty", "Bucket masih berisi file", bucketName);
    }

    db.delete(buckets).where(eq(buckets.id, bucket.id)).run();
    set.status = 204;
    return "";
  });

  // 3. Object Operations (Put, Get, Delete, Copy)
  router.put("/:bucket/*", async ({ params, request, set }) => {
    const bucketName = params.bucket;
    const key = params["*"];

    // Cek apakah ini CopyObject (x-amz-copy-source header)
    const copySource = request.headers.get("x-amz-copy-source");
    if (copySource) {
      const cleanSource = decodeURIComponent(copySource.startsWith("/") ? copySource.slice(1) : copySource);
      const slashIdx = cleanSource.indexOf("/");
      const srcBucket = cleanSource.slice(0, slashIdx);
      const srcKey = cleanSource.slice(slashIdx + 1);

      try {
        const { etag } = await engine.copyObject(srcBucket, srcKey, bucketName, key);
        set.headers["ETag"] = `"${etag}"`;
        set.headers["Content-Type"] = "application/xml";
        return `<CopyObjectResult><ETag>"${etag}"</ETag><LastModified>${new Date().toISOString()}</LastModified></CopyObjectResult>`;
      } catch (err: any) {
        set.status = 404;
        set.headers["Content-Type"] = "application/xml";
        return xmlError("NoSuchKey", err.message, key);
      }
    }

    // Normal PUT Object streaming
    const contentType = request.headers.get("content-type") || "application/octet-stream";
    const metadata: Record<string, string> = {};
    for (const [k, v] of request.headers.entries()) {
      if (k.startsWith("x-amz-meta-")) {
        metadata[k.slice(11)] = v;
      }
    }

    if (!request.body) {
      set.status = 400;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("IncompleteBody", "Request body kosong", key);
    }

    try {
      const { etag } = await engine.putObject(
        bucketName,
        key,
        contentType,
        JSON.stringify(metadata),
        request.body
      );
      set.headers["ETag"] = `"${etag}"`;
      set.status = 200;
      return "";
    } catch (err: any) {
      set.status = 500;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("InternalError", err.message, key);
    }
  });

  router.get("/:bucket/*", async ({ params, request, set }) => {
    const bucketName = params.bucket;
    const key = params["*"];
    const rangeHeader = request.headers.get("range");

    try {
      const { obj, response: driveRes } = await engine.getObject(bucketName, key, rangeHeader);

      set.status = driveRes.status;
      set.headers["Content-Type"] = obj.contentType || "application/octet-stream";
      set.headers["ETag"] = `"${obj.etag}"`;
      set.headers["Accept-Ranges"] = "bytes";

      if (driveRes.headers.get("Content-Range")) {
        set.headers["Content-Range"] = driveRes.headers.get("Content-Range")!;
      }
      if (driveRes.headers.get("Content-Length")) {
        set.headers["Content-Length"] = driveRes.headers.get("Content-Length")!;
      }

      return driveRes.body;
    } catch (err: any) {
      set.status = 404;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("NoSuchKey", err.message, key);
    }
  });

  router.delete("/:bucket/*", async ({ params, set }) => {
    const bucketName = params.bucket;
    const key = params["*"];

    await engine.deleteObject(bucketName, key);
    set.status = 204;
    return "";
  });

  return router;
}
