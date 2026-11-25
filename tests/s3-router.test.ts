import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Buffer } from "node:buffer";
import { initDatabase } from "../server/db/client";
import { driveAccounts, s3AccessKeys } from "../server/db/schema";
import { TokenCipher } from "../server/core/crypto";
import { GoogleOAuth } from "../server/drive/oauth";
import { DriveClient } from "../server/drive/client";
import { Balancer } from "../server/drive/balancer";
import { S3Engine } from "../server/s3/engine";
import { createS3Router } from "../server/s3/routes";
import { createApiRouter } from "../server/api/routes";
import { encodeRfc3986 } from "../server/s3/sigv4";

async function signRequest(
  method: string,
  urlStr: string,
  accessKeyId: string,
  secretKey: string,
  body: string | Uint8Array = "",
  extraHeaders: Record<string, string> = {}
): Promise<Request> {
  const url = new URL(urlStr);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash =
    extraHeaders["x-amz-content-sha256"] ||
    new Bun.CryptoHasher("sha256").update(body).digest("hex");

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    ...extraHeaders,
  };

  const sortedKeys = Object.keys(headers).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = sortedKeys
    .map((k) => {
      const origKey = Object.keys(headers).find((h) => h.toLowerCase() === k)!;
      return `${k}:${headers[origKey].trim()}\n`;
    })
    .join("");
  const signedHeaders = sortedKeys.join(";");

  const queryParams: [string, string][] = [];
  for (const [k, v] of url.searchParams.entries()) {
    queryParams.push([encodeRfc3986(k), encodeRfc3986(v)]);
  }
  queryParams.sort(([a], [b]) => a.localeCompare(b));
  const canonicalQuery = queryParams.map(([k, v]) => `${k}=${v}`).join("&");

  const canonicalPath = url.pathname
    .split("/")
    .map((seg) => encodeRfc3986(decodeURIComponent(seg)))
    .join("/");

  const canonicalRequest = [
    method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/us-east-1/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    new Bun.CryptoHasher("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const hmac = async (key: string | ArrayBuffer, data: string) => {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      typeof key === "string" ? enc.encode(key) : key,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    return crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  };

  const kDate = await hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmac(kDate, "us-east-1");
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const sig = Buffer.from(await hmac(kSigning, stringToSign)).toString("hex");

  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  return new Request(urlStr, {
    method,
    headers,
    body: method !== "GET" && method !== "HEAD" && body !== "" ? body : undefined,
  });
}

describe("S3 Router & Engine Integration", () => {
  let tempDir: string;
  let s3Router: ReturnType<typeof createS3Router>;
  let apiRouter: ReturnType<typeof createApiRouter>;
  let sessionCookie: string;
  const accessKeyId = "GDS3INTEGRATIONKEY0001";
  const secretKey = "integration-secret-key-xyz-123";
  const driveFiles = new Map<string, Uint8Array>();
  let fileSeq = 1;
  let failDeletes = false;
  let failUploads = false;
  let return429Once = false;
  const originalFetch = globalThis.fetch;

  beforeAll(async () => {
    process.env.GDRIVES3_DRIVE_RETRY_BASE_MS = "1";
    DriveClient.resetTelemetry();
    tempDir = mkdtempSync(join(tmpdir(), "gdrives3-s3-router-test-"));
    const { db } = initDatabase(tempDir, "admin@test.local", "secret123");
    const encKey = Buffer.from(new Uint8Array(32).fill(5)).toString("base64");
    const cipher = await TokenCipher.init(encKey, tempDir);
    const oauth = new GoogleOAuth("cid", "csec", "http://localhost:8787/api/accounts/callback");
    const balancer = new Balancer(db, oauth, cipher);
    const engine = new S3Engine(db, balancer, oauth, cipher, tempDir);

    s3Router = createS3Router(db, engine, cipher);
    apiRouter = createApiRouter(db, oauth, cipher, engine, { s3Port: 9000 });

    // Seed Drive account & S3 Access Key
    db.insert(driveAccounts)
      .values({
        id: "drive-acc-1",
        email: "pool1@gmail.com",
        refreshToken: await cipher.encrypt("refresh-token-pool1"),
        folderId: "root-folder-id",
        weight: 1,
        storageLimit: 10_000_000,
        storageUsage: 0,
        dailyBytes: 0,
        status: "connected",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .run();

    db.insert(s3AccessKeys)
      .values({
        id: "s3-key-1",
        accessKeyId,
        secretHash: await cipher.encrypt(secretKey),
        label: "Integration Key",
        createdAt: new Date().toISOString(),
      })
      .run();

    // Login to get session cookie for panel API tests
    const loginRes = await apiRouter.handle(
      new Request("http://localhost:8787/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@test.local", password: "secret123" }),
      })
    );
    const match = (loginRes.headers.get("set-cookie") || "").match(/gdrives3_session=([^;]+)/);
    sessionCookie = `gdrives3_session=${match![1]}`;

    // Mock Google OAuth & Google Drive v3 APIs
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === "https://oauth2.googleapis.com/token") {
        return new Response(JSON.stringify({ access_token: "mock-token", expires_in: 3600 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.startsWith("https://www.googleapis.com/drive/v3/files?q=")) {
        const q = new URL(url).searchParams.get("q") || "";
        if (q.includes("'root-folder-id' in parents") && !q.includes("mimeType =")) {
          return new Response(
            JSON.stringify({
              files: [
                {
                  id: "bucket-folder-1",
                  name: "test-bucket",
                  mimeType: "application/vnd.google-apps.folder",
                  size: "0",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        if (q.includes("'bucket-folder-1' in parents")) {
          const items = Array.from(driveFiles.entries()).map(([id, data]) => ({
            id,
            name: id,
            mimeType: "application/octet-stream",
            size: String(data.length),
          }));
          return new Response(JSON.stringify({ files: items }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ files: [{ id: "bucket-folder-1" }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url === "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable") {
        if (failUploads) {
          return new Response(JSON.stringify({ error: { message: "Drive upload unavailable" } }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (return429Once) {
          return429Once = false;
          return new Response("Rate limit", { status: 429, headers: { "Retry-After": "0" } });
        }
        const uploadId = `drive-file-${fileSeq++}`;
        return new Response("", {
          status: 200,
          headers: { Location: `https://mock-drive-upload/${uploadId}` },
        });
      }

      if (url.startsWith("https://mock-drive-upload/")) {
        const fileId = url.split("/").pop()!;
        const buf = init?.body
          ? new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer())
          : new Uint8Array(0);
        driveFiles.set(fileId, buf);
        return new Response(JSON.stringify({ id: fileId }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const copyMatch = url.match(/https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/]+)\/copy/);
      if (copyMatch) {
        const srcId = copyMatch[1];
        const newId = `drive-file-${fileSeq++}`;
        const srcData = driveFiles.get(srcId) || new Uint8Array(0);
        driveFiles.set(newId, new Uint8Array(srcData));
        return new Response(JSON.stringify({ id: newId }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const fileMatch = url.match(/https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^?]+)/);
      if (fileMatch) {
        const fileId = fileMatch[1];
        if (init?.method === "DELETE") {
          if (failDeletes) {
            return new Response("Internal Drive Failure", { status: 500 });
          }
          driveFiles.delete(fileId);
          return new Response("", { status: 204 });
        }
        const data = driveFiles.get(fileId);
        if (!data) return new Response("Not Found", { status: 404 });

        const headers = new Headers(init?.headers);
        const range = headers.get("Range");
        if (range) {
          const m = range.match(/^bytes=(\d+)-(\d+)$/);
          if (m) {
            const s = Number(m[1]);
            const e = Math.min(Number(m[2]), data.length - 1);
            const slice = data.slice(s, e + 1);
            return new Response(slice, {
              status: 206,
              headers: {
                "Content-Range": `bytes ${s}-${e}/${data.length}`,
                "Content-Length": String(slice.length),
              },
            });
          }
        }
        return new Response(data, {
          status: 200,
          headers: { "Content-Length": String(data.length) },
        });
      }

      return originalFetch(input, init);
    }) as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should validate bucket names on PUT /:bucket and create valid bucket", async () => {
    const badReq = await signRequest("PUT", "http://localhost:9000/Invalid_Bucket!", accessKeyId, secretKey);
    const badRes = await s3Router.handle(badReq);
    expect(badRes.status).toBe(400);
    expect(await badRes.text()).toContain("InvalidBucketName");

    const okReq = await signRequest("PUT", "http://localhost:9000/test-bucket", accessKeyId, secretKey);
    const okRes = await s3Router.handle(okReq);
    expect(okRes.status).toBe(200);
  });

  it("should support ListObjectsV2 pagination and aws-chunked PutObject", async () => {
    // Upload 3 objects, one using aws-chunked framing
    for (const key of ["a.txt", "b.txt"]) {
      const req = await signRequest("PUT", `http://localhost:9000/test-bucket/${key}`, accessKeyId, secretKey, `content-${key}`);
      expect((await s3Router.handle(req)).status).toBe(200);
    }

    const chunkPayload = "5;chunk-signature=0000\r\nhello\r\n0;chunk-signature=0000\r\n\r\n";
    const chunkReq = await signRequest(
      "PUT",
      "http://localhost:9000/test-bucket/c.txt",
      accessKeyId,
      secretKey,
      chunkPayload,
      { "x-amz-content-sha256": "STREAMING-AWS4-HMAC-SHA256-PAYLOAD" }
    );
    expect((await s3Router.handle(chunkReq)).status).toBe(200);

    // Verify decoded content of c.txt
    const getC = await s3Router.handle(
      await signRequest("GET", "http://localhost:9000/test-bucket/c.txt", accessKeyId, secretKey)
    );
    expect(await getC.text()).toBe("hello");

    // Paginate max-keys=2
    const page1Res = await s3Router.handle(
      await signRequest("GET", "http://localhost:9000/test-bucket?list-type=2&max-keys=2", accessKeyId, secretKey)
    );
    const page1Xml = await page1Res.text();
    expect(page1Xml).toContain("<IsTruncated>true</IsTruncated>");
    expect(page1Xml).toContain("<Key>a.txt</Key>");
    expect(page1Xml).toContain("<Key>b.txt</Key>");
    expect(page1Xml).not.toContain("<Key>c.txt</Key>");

    const tokenMatch = page1Xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
    expect(tokenMatch).not.toBeNull();

    const page2Res = await s3Router.handle(
      await signRequest(
        "GET",
        `http://localhost:9000/test-bucket?list-type=2&max-keys=2&continuation-token=${encodeURIComponent(tokenMatch![1])}`,
        accessKeyId,
        secretKey
      )
    );
    const page2Xml = await page2Res.text();
    expect(page2Xml).toContain("<IsTruncated>false</IsTruncated>");
    expect(page2Xml).toContain("<Key>c.txt</Key>");
  });

  it("should honor expiresInSeconds on /presign and serve multipart Range & independent CopyObject", async () => {
    const bucketsRes = await apiRouter.handle(
      new Request("http://localhost:8787/api/buckets", { headers: { Cookie: sessionCookie } })
    );
    const bucketList = (await bucketsRes.json()) as { id: string; name: string }[];
    const bucketId = bucketList.find((b) => b.name === "test-bucket")!.id;

    // 1. Presign with expiresInSeconds (like PresignModal.vue)
    const presignRes = await apiRouter.handle(
      new Request(`http://localhost:8787/api/buckets/${bucketId}/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
        body: JSON.stringify({ key: "a.txt", expiresInSeconds: 86400 }),
      })
    );
    const presignData = (await presignRes.json()) as { url: string; expiresIn: number };
    expect(presignData.expiresIn).toBe(86400);
    expect(presignData.url).not.toContain("0.0.0.0");
    expect(presignData.url).toContain("X-Amz-Expires=86400");

    // 2. Multipart Upload -> Range GET -> CopyObject -> Delete Source
    const initRes = await s3Router.handle(
      await signRequest("POST", "http://localhost:9000/test-bucket/multi.bin?uploads", accessKeyId, secretKey)
    );
    const initXml = await initRes.text();
    const uploadId = initXml.match(/<UploadId>([^<]+)<\/UploadId>/)![1];

    await s3Router.handle(
      await signRequest(
        "PUT",
        `http://localhost:9000/test-bucket/multi.bin?uploadId=${uploadId}&partNumber=1`,
        accessKeyId,
        secretKey,
        "ABCDE"
      )
    );
    await s3Router.handle(
      await signRequest(
        "PUT",
        `http://localhost:9000/test-bucket/multi.bin?uploadId=${uploadId}&partNumber=2`,
        accessKeyId,
        secretKey,
        "FGHIJ"
      )
    );

    const listPartsRes = await s3Router.handle(
      await signRequest(
        "GET",
        `http://localhost:9000/test-bucket/multi.bin?uploadId=${uploadId}`,
        accessKeyId,
        secretKey
      )
    );
    const listPartsXml = await listPartsRes.text();
    expect(listPartsXml).toContain("<PartNumber>1</PartNumber>");
    expect(listPartsXml).toContain("<PartNumber>2</PartNumber>");

    const compRes = await s3Router.handle(
      await signRequest(
        "POST",
        `http://localhost:9000/test-bucket/multi.bin?uploadId=${uploadId}`,
        accessKeyId,
        secretKey
      )
    );
    expect(compRes.status).toBe(200);

    // Range GET across part boundary (bytes 3..7 -> "DEFGH")
    const rangeRes = await s3Router.handle(
      await signRequest("GET", "http://localhost:9000/test-bucket/multi.bin", accessKeyId, secretKey, "", {
        range: "bytes=3-7",
      })
    );
    expect(rangeRes.status).toBe(206);
    expect(rangeRes.headers.get("content-range")).toBe("bytes 3-7/10");
    expect(await rangeRes.text()).toBe("DEFGH");

    // Copy multipart object
    const copyRes = await s3Router.handle(
      await signRequest("PUT", "http://localhost:9000/test-bucket/multi-copy.bin", accessKeyId, secretKey, "", {
        "x-amz-copy-source": "/test-bucket/multi.bin",
      })
    );
    expect(copyRes.status).toBe(200);

    // Delete original multipart object; copy MUST still be intact!
    await s3Router.handle(
      await signRequest("DELETE", "http://localhost:9000/test-bucket/multi.bin", accessKeyId, secretKey)
    );

    const getCopyRes = await s3Router.handle(
      await signRequest("GET", "http://localhost:9000/test-bucket/multi-copy.bin", accessKeyId, secretKey)
    );
    expect(getCopyRes.status).toBe(200);
    expect(await getCopyRes.text()).toBe("ABCDEFGHIJ");
  });

  it("should enforce scoped read-only access keys and verify payload SHA-256", async () => {
    // Create second bucket via root key
    await s3Router.handle(
      await signRequest("PUT", "http://localhost:9000/other-bucket", accessKeyId, secretKey)
    );

    // Create scoped read-only key for test-bucket only
    const keyRes = await apiRouter.handle(
      new Request("http://localhost:8787/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sessionCookie },
        body: JSON.stringify({
          label: "Scoped RO",
          permissions: "read_only",
          allowedBuckets: ["test-bucket"],
        }),
      })
    );
    expect(keyRes.status).toBe(200);
    const roKey = (await keyRes.json()) as { accessKeyId: string; secretKey: string; permissions: string };
    expect(roKey.permissions).toBe("read_only");

    // Read on allowed bucket succeeds
    const okGet = await s3Router.handle(
      await signRequest("GET", "http://localhost:9000/test-bucket/a.txt", roKey.accessKeyId, roKey.secretKey)
    );
    expect(okGet.status).toBe(200);

    // ListBuckets only returns test-bucket
    const listBuckets = await s3Router.handle(
      await signRequest("GET", "http://localhost:9000/", roKey.accessKeyId, roKey.secretKey)
    );
    const listXml = await listBuckets.text();
    expect(listXml).toContain("<Name>test-bucket</Name>");
    expect(listXml).not.toContain("<Name>other-bucket</Name>");

    // Write on allowed bucket rejected (403)
    const blockedPut = await s3Router.handle(
      await signRequest("PUT", "http://localhost:9000/test-bucket/fail.txt", roKey.accessKeyId, roKey.secretKey, "hi")
    );
    expect(blockedPut.status).toBe(403);

    // Read on disallowed bucket rejected (403)
    const blockedBucket = await s3Router.handle(
      await signRequest("GET", "http://localhost:9000/other-bucket", roKey.accessKeyId, roKey.secretKey)
    );
    expect(blockedBucket.status).toBe(403);

    // Payload SHA-256 mismatch rejected (400)
    const badShaReq = await signRequest(
      "PUT",
      "http://localhost:9000/test-bucket/badsha.txt",
      accessKeyId,
      secretKey,
      "actual-body",
      { "x-amz-content-sha256": "f".repeat(64) }
    );
    const badShaRes = await s3Router.handle(badShaReq);
    expect(badShaRes.status).toBe(400);
    expect(await badShaRes.text()).toContain("XAmzContentSHA256Mismatch");
  });

  it("should retry Drive 429, queue failed deletes, audit Drive orphans, and export SQLite snapshot", async () => {
    // 1. Trigger 429 retry on upload
    return429Once = true;
    const retryPut = await s3Router.handle(
      await signRequest("PUT", "http://localhost:9000/test-bucket/retry.txt", accessKeyId, secretKey, "retry-ok")
    );
    expect(retryPut.status).toBe(200);
    const tel = DriveClient.getTelemetry();
    expect(tel.rateLimitHits).toBeGreaterThanOrEqual(1);
    expect(tel.retryAttempts).toBeGreaterThanOrEqual(1);

    // 2. Force Drive DELETE failure -> queued in pending_drive_deletes -> retry succeeds
    failDeletes = true;
    const delRes = await s3Router.handle(
      await signRequest("DELETE", "http://localhost:9000/test-bucket/retry.txt", accessKeyId, secretKey)
    );
    expect(delRes.status).toBe(204);

    const pendingRes = await apiRouter.handle(
      new Request("http://localhost:8787/api/storage/pending-deletes", { headers: { Cookie: sessionCookie } })
    );
    const pendingList = (await pendingRes.json()) as any[];
    expect(pendingList.length).toBeGreaterThanOrEqual(1);

    failDeletes = false;
    const retryDelRes = await apiRouter.handle(
      new Request("http://localhost:8787/api/storage/pending-deletes/retry", {
        method: "POST",
        headers: { Cookie: sessionCookie },
      })
    );
    const retryDelData = (await retryDelRes.json()) as { succeeded: number; remaining: number };
    expect(retryDelData.succeeded).toBeGreaterThanOrEqual(1);
    expect(retryDelData.remaining).toBe(0);

    // 3. Inject an orphan file in Drive and run Audit
    driveFiles.set("orphan-drive-file-999", new Uint8Array([1, 2, 3, 4]));
    const auditRes = await apiRouter.handle(
      new Request("http://localhost:8787/api/storage/audit", {
        method: "POST",
        headers: { Cookie: sessionCookie },
      })
    );
    expect(auditRes.status).toBe(200);
    const auditData = (await auditRes.json()) as { orphanInDrive: { driveFileId: string }[] };
    expect(auditData.orphanInDrive.some((o) => o.driveFileId === "orphan-drive-file-999")).toBe(true);

    // 4. Download consistent SQLite snapshot
    const backupRes = await apiRouter.handle(
      new Request("http://localhost:8787/api/storage/backup", { headers: { Cookie: sessionCookie } })
    );
    expect(backupRes.status).toBe(200);
    expect(backupRes.headers.get("content-type")).toBe("application/x-sqlite3");
    const headerStr = new TextDecoder().decode(new Uint8Array(await backupRes.arrayBuffer()).subarray(0, 15));
    expect(headerStr).toBe("SQLite format 3");
  });

  it("should fallback to VPS local storage when Drive upload fails and migrate back to Drive on sync", async () => {
    // 1. Force Google Drive upload failures
    failUploads = true;
    const putReq = await signRequest(
      "PUT",
      "http://localhost:9000/test-bucket/fallback.txt",
      accessKeyId,
      secretKey,
      "vps-fallback-payload",
      { "Content-Type": "text/plain" }
    );
    const putRes = await s3Router.handle(putReq);
    expect(putRes.status).toBe(200);

    // 2. Read full object and byte-range directly from VPS fallback disk
    const getReq = await signRequest(
      "GET",
      "http://localhost:9000/test-bucket/fallback.txt",
      accessKeyId,
      secretKey
    );
    const getRes = await s3Router.handle(getReq);
    expect(getRes.status).toBe(200);
    expect(await getRes.text()).toBe("vps-fallback-payload");

    const rangeReq = await signRequest(
      "GET",
      "http://localhost:9000/test-bucket/fallback.txt",
      accessKeyId,
      secretKey,
      "",
      { Range: "bytes=0-3" }
    );
    const rangeRes = await s3Router.handle(rangeReq);
    expect(rangeRes.status).toBe(206);
    expect(await rangeRes.text()).toBe("vps-");

    // 3. CopyObject while Drive is down also writes copy to VPS fallback
    const copyReq = await signRequest(
      "PUT",
      "http://localhost:9000/test-bucket/fallback-copy.txt",
      accessKeyId,
      secretKey,
      "",
      { "x-amz-copy-source": "/test-bucket/fallback.txt" }
    );
    const copyRes = await s3Router.handle(copyReq);
    expect(copyRes.status).toBe(200);

    // 4. Inspect fallback stats via panel API
    const fbRes = await apiRouter.handle(
      new Request("http://localhost:8787/api/storage/fallback", {
        headers: { Cookie: sessionCookie },
      })
    );
    expect(fbRes.status).toBe(200);
    const fbData = (await fbRes.json()) as {
      stats: { objectsCount: number; totalBytes: number };
    };
    expect(fbData.stats.objectsCount).toBe(2);
    expect(fbData.stats.totalBytes).toBe(40);

    // 5. Disabling fallback causes Drive failures to return 500
    const disableRes = await apiRouter.handle(
      new Request("http://localhost:8787/api/settings/fallback", {
        method: "PUT",
        headers: { Cookie: sessionCookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: false,
          maxMb: 0,
          autoSyncToDrive: true,
          notifyOnFallback: true,
        }),
      })
    );
    expect(disableRes.status).toBe(200);

    const rejectedReq = await signRequest(
      "PUT",
      "http://localhost:9000/test-bucket/rejected.txt",
      accessKeyId,
      secretKey,
      "should-fail",
      { "Content-Type": "text/plain" }
    );
    const rejectedRes = await s3Router.handle(rejectedReq);
    expect(rejectedRes.status).toBe(500);

    // Re-enable fallback and recover Drive
    await apiRouter.handle(
      new Request("http://localhost:8787/api/settings/fallback", {
        method: "PUT",
        headers: { Cookie: sessionCookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          maxMb: 0,
          autoSyncToDrive: true,
          notifyOnFallback: true,
        }),
      })
    );
    failUploads = false;

    // 6. Sync VPS fallback objects back to Google Drive
    const syncRes = await apiRouter.handle(
      new Request("http://localhost:8787/api/storage/fallback/sync", {
        method: "POST",
        headers: { Cookie: sessionCookie },
      })
    );
    expect(syncRes.status).toBe(200);
    const syncData = (await syncRes.json()) as { migrated: number; failed: number; remaining: number };
    expect(syncData.migrated).toBe(2);
    expect(syncData.failed).toBe(0);
    expect(syncData.remaining).toBe(0);

    // 7. Verify object is now readable from Google Drive
    const afterSyncReq = await signRequest(
      "GET",
      "http://localhost:9000/test-bucket/fallback.txt",
      accessKeyId,
      secretKey
    );
    const afterSyncRes = await s3Router.handle(afterSyncReq);
    expect(afterSyncRes.status).toBe(200);
    expect(await afterSyncRes.text()).toBe("vps-fallback-payload");
  });
});
