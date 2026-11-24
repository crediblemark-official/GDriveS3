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
  xmlListMultipartUploads,
  xmlListParts,
  xmlDeleteResult,
} from "./xml";

const BUCKET_NAME_RE = /^[a-z0-9.-]{3,63}$/;

/**
 * Decodes AWS SigV4 streaming payload framing (`aws-chunked`) into raw bytes.
 */
function decodeAwsChunkedStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  let buffer: Uint8Array = new Uint8Array(0);
  let remainingChunkBytes = 0;
  let expectingCrlfAfterData = false;
  let finished = false;

  const append = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0);
    out.set(b, a.length);
    return out;
  };

  const findCrlf = (buf: Uint8Array): number => {
    for (let i = 0; i < buf.length - 1; i++) {
      if (buf[i] === 13 && buf[i + 1] === 10) return i;
    }
    return -1;
  };

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (finished) return;
        buffer = append(buffer, chunk);

        while (buffer.length > 0 && !finished) {
          if (expectingCrlfAfterData) {
            if (buffer.length < 2) break;
            if (buffer[0] === 13 && buffer[1] === 10) {
              buffer = buffer.subarray(2);
            }
            expectingCrlfAfterData = false;
            continue;
          }

          if (remainingChunkBytes > 0) {
            const take = Math.min(remainingChunkBytes, buffer.length);
            controller.enqueue(buffer.subarray(0, take));
            buffer = buffer.subarray(take);
            remainingChunkBytes -= take;
            if (remainingChunkBytes === 0) {
              expectingCrlfAfterData = true;
            }
            continue;
          }

          const lineEnd = findCrlf(buffer);
          if (lineEnd < 0) break;

          const headerLine = new TextDecoder().decode(buffer.subarray(0, lineEnd));
          buffer = buffer.subarray(lineEnd + 2);
          const hexLen = headerLine.split(";")[0].trim();
          const parsedLen = parseInt(hexLen, 16);
          if (!Number.isFinite(parsedLen) || parsedLen < 0) {
            controller.error(new Error("Invalid aws-chunked framing"));
            return;
          }
          if (parsedLen === 0) {
            finished = true;
            buffer = new Uint8Array(0);
            break;
          }
          remainingChunkBytes = parsedLen;
        }
      },
    })
  );
}

function unwrapPayloadStream(request: Request): ReadableStream<Uint8Array> | null {
  if (!request.body) return null;
  const contentSha = request.headers.get("x-amz-content-sha256") || "";
  if (contentSha.startsWith("STREAMING-AWS4-HMAC-SHA256-PAYLOAD")) {
    return decodeAwsChunkedStream(request.body);
  }
  return request.body;
}

export function createS3Router(
  db: AppDatabase,
  engine: S3Engine,
  cipher: TokenCipher
) {
  const router = new Elysia();

  // Middleware Auth SigV4
  router.onRequest(async ({ request, set }) => {
    // 0. Allow CORS Preflight
    if (request.method === "OPTIONS") return;

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

  // 2. Bucket Operations (Create, Delete, List Objects, List Multipart Uploads)
  router.get("/:bucket", async ({ params, query, set }) => {
    const bucketName = params.bucket;
    const bucket = db.select().from(buckets).where(eq(buckets.name, bucketName)).get();

    if (!bucket) {
      set.status = 404;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("NoSuchBucket", "Bucket tidak ditemukan", bucketName);
    }

    if (query.uploads !== undefined) {
      const uploads = engine.listMultipartUploads(bucketName);
      set.headers["Content-Type"] = "application/xml";
      return xmlListMultipartUploads(bucketName, uploads);
    }

    const prefix = (query.prefix as string) || "";
    const delimiter = (query.delimiter as string) || "";
    const rawMaxKeys = Number(query["max-keys"]);
    const maxKeys = Number.isFinite(rawMaxKeys) && rawMaxKeys > 0 ? Math.min(1000, Math.floor(rawMaxKeys)) : 1000;
    const continuationToken = (query["continuation-token"] as string) || "";
    const startAfter = (query["start-after"] as string) || "";

    let cursorKey = startAfter;
    if (continuationToken) {
      try {
        cursorKey = Buffer.from(continuationToken, "base64").toString("utf-8");
      } catch {
        cursorKey = continuationToken;
      }
    }

    const allObjects = db
      .select()
      .from(objects)
      .where(eq(objects.bucketId, bucket.id))
      .all()
      .sort((a, b) => a.objectKey.localeCompare(b.objectKey));

    type ListedItem =
      | { kind: "content"; sortKey: string; data: { key: string; size: number; etag: string; updatedAt: string } }
      | { kind: "prefix"; sortKey: string };

    const seenPrefixes = new Set<string>();
    const items: ListedItem[] = [];

    for (const obj of allObjects) {
      if (!obj.objectKey.startsWith(prefix)) continue;

      if (delimiter) {
        const afterPrefix = obj.objectKey.slice(prefix.length);
        const idx = afterPrefix.indexOf(delimiter);
        if (idx >= 0) {
          const cp = prefix + afterPrefix.slice(0, idx + 1);
          if (!seenPrefixes.has(cp)) {
            seenPrefixes.add(cp);
            if (!cursorKey || cp > cursorKey) {
              items.push({ kind: "prefix", sortKey: cp });
            }
          }
          continue;
        }
      }

      if (!cursorKey || obj.objectKey > cursorKey) {
        items.push({
          kind: "content",
          sortKey: obj.objectKey,
          data: {
            key: obj.objectKey,
            size: obj.size,
            etag: obj.etag,
            updatedAt: obj.updatedAt,
          },
        });
      }
    }

    items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
    const isTruncated = items.length > maxKeys;
    const page = items.slice(0, maxKeys);
    const nextContinuationToken =
      isTruncated && page.length > 0
        ? Buffer.from(page[page.length - 1].sortKey).toString("base64")
        : undefined;

    const contents = page
      .filter((item): item is Extract<ListedItem, { kind: "content" }> => item.kind === "content")
      .map((item) => item.data);
    const commonPrefixes = page
      .filter((item): item is Extract<ListedItem, { kind: "prefix" }> => item.kind === "prefix")
      .map((item) => item.sortKey);

    set.headers["Content-Type"] = "application/xml";
    return xmlListObjectsV2(bucketName, prefix, contents, commonPrefixes, {
      maxKeys,
      isTruncated,
      continuationToken: continuationToken || undefined,
      nextContinuationToken,
    });
  });

  router.put("/:bucket", async ({ params, set }) => {
    const bucketName = params.bucket;
    if (!BUCKET_NAME_RE.test(bucketName)) {
      set.status = 400;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("InvalidBucketName", "Nama bucket tidak valid (3-63 karakter a-z, 0-9, dot, minus)", bucketName);
    }

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

  // HeadBucket
  router.head("/:bucket", async ({ params, set }) => {
    const bucketName = params.bucket;
    const bucket = db.select().from(buckets).where(eq(buckets.name, bucketName)).get();
    if (!bucket) {
      set.status = 404;
      return "";
    }
    set.status = 200;
    return "";
  });

  // S3 Multi-Object Delete (POST /:bucket?delete)
  router.post("/:bucket", async ({ params, query, request, set }) => {
    const bucketName = params.bucket;
    if (query.delete === undefined) {
      set.status = 400;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("InvalidRequest", "Operasi POST pada bucket memerlukan parameter ?delete", bucketName);
    }

    const bucket = db.select().from(buckets).where(eq(buckets.name, bucketName)).get();
    if (!bucket) {
      set.status = 404;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("NoSuchBucket", "Bucket tidak ditemukan", bucketName);
    }

    const bodyText = await request.text();
    const matches = Array.from(bodyText.matchAll(/<Key>(.*?)<\/Key>/g));
    const keys = matches.map((m) =>
      m[1]
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
    );

    const deleted: string[] = [];
    const errors: { key: string; code: string; message: string }[] = [];

    await Promise.all(
      keys.map(async (key) => {
        try {
          await engine.deleteObject(bucketName, key);
          deleted.push(key);
        } catch (err: any) {
          errors.push({ key, code: "InternalError", message: err.message });
        }
      })
    );

    set.headers["Content-Type"] = "application/xml";
    return xmlDeleteResult(deleted, errors);
  });

  // 3. Object Operations (Put, Get, Delete, Copy, Multipart)
  router.put("/:bucket/*", async ({ params, query, request, set }) => {
    const bucketName = params.bucket;
    const key = params["*"];

    // S3 Multipart UploadPart (?uploadId=...&partNumber=...)
    if (query.uploadId && query.partNumber) {
      const partBody = unwrapPayloadStream(request);
      if (!partBody) {
        set.status = 400;
        set.headers["Content-Type"] = "application/xml";
        return xmlError("IncompleteBody", "Request body kosong", key);
      }
      try {
        const { etag } = await engine.uploadPart(
          query.uploadId as string,
          Number(query.partNumber),
          partBody
        );
        set.headers["ETag"] = `"${etag}"`;
        set.status = 200;
        return "";
      } catch (err: any) {
        set.status = 500;
        set.headers["Content-Type"] = "application/xml";
        return xmlError("InternalError", err.message, key);
      }
    }

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

    const putBody = unwrapPayloadStream(request);
    if (!putBody) {
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
        putBody
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

  // HeadObject
  router.head("/:bucket/*", async ({ params, set }) => {
    const bucketName = params.bucket;
    const key = params["*"];
    const bucket = db.select().from(buckets).where(eq(buckets.name, bucketName)).get();
    if (!bucket) {
      set.status = 404;
      return "";
    }
    const obj = db
      .select()
      .from(objects)
      .where(and(eq(objects.bucketId, bucket.id), eq(objects.objectKey, key)))
      .get();
    if (!obj) {
      set.status = 404;
      return "";
    }
    set.headers["ETag"] = `"${obj.etag}"`;
    set.headers["Content-Type"] = obj.contentType || "application/octet-stream";
    set.headers["Content-Length"] = String(obj.size || 0);
    set.headers["Last-Modified"] = new Date(obj.updatedAt).toUTCString();
    set.headers["Accept-Ranges"] = "bytes";
    set.status = 200;
    return "";
  });

  router.get("/:bucket/*", async ({ params, query, request, set }) => {
    const bucketName = params.bucket;
    const key = params["*"];

    // S3 ListParts (?uploadId=...)
    if (query.uploadId) {
      try {
        const { parts } = engine.listParts(query.uploadId as string);
        set.headers["Content-Type"] = "application/xml";
        return xmlListParts(bucketName, key, query.uploadId as string, parts);
      } catch (err: any) {
        set.status = 404;
        set.headers["Content-Type"] = "application/xml";
        return xmlError("NoSuchUpload", err.message, key);
      }
    }

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
      const msg = String(err?.message || "");
      if (msg === "InvalidRange") {
        set.status = 416;
        set.headers["Content-Type"] = "application/xml";
        return xmlError("InvalidRange", "Requested range not satisfiable", key);
      }
      set.status = 404;
      set.headers["Content-Type"] = "application/xml";
      return xmlError("NoSuchKey", msg, key);
    }
  });

  // S3 Multipart Operations (Initiate & Complete)
  router.post("/:bucket/*", async ({ params, query, request, set }) => {
    const bucketName = params.bucket;
    const key = params["*"];

    // Initiate Multipart Upload (?uploads)
    if (query.uploads !== undefined) {
      const contentType = request.headers.get("content-type") || "application/octet-stream";
      const metadata: Record<string, string> = {};
      for (const [k, v] of request.headers.entries()) {
        if (k.startsWith("x-amz-meta-")) metadata[k.slice(11)] = v;
      }
      try {
        const uploadId = await engine.initiateMultipart(
          bucketName,
          key,
          contentType,
          JSON.stringify(metadata)
        );
        set.headers["Content-Type"] = "application/xml";
        return xmlInitiateMultipart(bucketName, key, uploadId);
      } catch (err: any) {
        set.status = 500;
        set.headers["Content-Type"] = "application/xml";
        return xmlError("InternalError", err.message, key);
      }
    }

    // Complete Multipart Upload (?uploadId=...)
    if (query.uploadId) {
      try {
        const { etag } = await engine.completeMultipart(
          bucketName,
          key,
          query.uploadId as string
        );
        set.headers["Content-Type"] = "application/xml";
        return xmlCompleteMultipart(bucketName, key, etag);
      } catch (err: any) {
        set.status = 500;
        set.headers["Content-Type"] = "application/xml";
        return xmlError("InternalError", err.message, key);
      }
    }

    set.status = 400;
    set.headers["Content-Type"] = "application/xml";
    return xmlError("InvalidRequest", "Operasi POST tidak valid", key);
  });

  router.delete("/:bucket/*", async ({ params, query, set }) => {
    const bucketName = params.bucket;
    const key = params["*"];

    // S3 Abort Multipart Upload (?uploadId=...)
    if (query.uploadId) {
      await engine.abortMultipart(query.uploadId as string);
      set.status = 204;
      return "";
    }

    await engine.deleteObject(bucketName, key);
    set.status = 204;
    return "";
  });

  return router;
}
