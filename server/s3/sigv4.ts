import { Buffer } from "node:buffer";

export interface ParsedCredential {
  accessKeyId: string;
  date: string;
  region: string;
  service: string;
  signedHeaders: string[];
  signature: string;
  isPresigned: boolean;
}

export function parseSigV4(req: Request): ParsedCredential | null {
  const authHeader = req.headers.get("authorization");
  const url = new URL(req.url);

  // 1. Cek Authorization Header: AWS4-HMAC-SHA256 Credential=AKIA.../20261124/us-east-1/s3/aws4_request, ...
  if (authHeader?.startsWith("AWS4-HMAC-SHA256 ")) {
    const credMatch = authHeader.match(/Credential=([^,]+)/);
    const signedHeadersMatch = authHeader.match(/SignedHeaders=([^,]+)/);
    const sigMatch = authHeader.match(/Signature=([a-f0-9]+)/);

    if (!credMatch || !signedHeadersMatch || !sigMatch) return null;

    const [accessKeyId, date, region, service] = credMatch[1].split("/");
    const signedHeaders = signedHeadersMatch[1].split(";");
    const signature = sigMatch[1];

    return {
      accessKeyId,
      date,
      region,
      service,
      signedHeaders,
      signature,
      isPresigned: false,
    };
  }

  // 2. Cek Presigned Query String (?X-Amz-Algorithm=AWS4-HMAC-SHA256&...)
  if (url.searchParams.get("X-Amz-Algorithm") === "AWS4-HMAC-SHA256") {
    const credParam = url.searchParams.get("X-Amz-Credential");
    const signedHeadersParam = url.searchParams.get("X-Amz-SignedHeaders");
    const signature = url.searchParams.get("X-Amz-Signature");

    if (!credParam || !signedHeadersParam || !signature) return null;

    const [accessKeyId, date, region, service] = credParam.split("/");
    const signedHeaders = signedHeadersParam.split(";");

    return {
      accessKeyId,
      date,
      region,
      service,
      signedHeaders,
      signature,
      isPresigned: true,
    };
  }

  return null;
}

export async function verifySigV4(
  req: Request,
  cred: ParsedCredential,
  secretKey: string
): Promise<boolean> {
  const url = new URL(req.url);

  // 1. Canonical Headers
  const canonicalHeaders = cred.signedHeaders
    .map((h) => {
      const lower = h.toLowerCase();
      const val = lower === "host" ? (url.host) : (req.headers.get(h) || "");
      return `${lower}:${val.trim()}\n`;
    })
    .join("");

  // 2. Canonical Query String
  const queryParams: [string, string][] = [];
  for (const [k, v] of url.searchParams.entries()) {
    if (cred.isPresigned && k === "X-Amz-Signature") continue;
    queryParams.push([encodeURIComponent(k), encodeURIComponent(v)]);
  }
  queryParams.sort(([a], [b]) => a.localeCompare(b));
  const canonicalQuery = queryParams.map(([k, v]) => `${k}=${v}`).join("&");

  // 3. Payload Hash
  let payloadHash = "UNSIGNED-PAYLOAD";
  if (!cred.isPresigned) {
    payloadHash = req.headers.get("x-amz-content-sha256") || "UNSIGNED-PAYLOAD";
  }

  // 4. Canonical Request
  const canonicalRequest = [
    req.method,
    url.pathname,
    canonicalQuery,
    canonicalHeaders,
    cred.signedHeaders.join(";"),
    payloadHash,
  ].join("\n");

  // 5. String to Sign
  const amzDate = cred.isPresigned
    ? url.searchParams.get("X-Amz-Date") || ""
    : req.headers.get("x-amz-date") || "";

  const canonicalHash = new Bun.CryptoHasher("sha256")
    .update(canonicalRequest)
    .digest("hex");

  const scope = `${cred.date}/${cred.region}/${cred.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    canonicalHash,
  ].join("\n");

  // 6. Key Derivation HMAC-SHA256
  const kDate = await hmacSHA256(`AWS4${secretKey}`, cred.date);
  const kRegion = await hmacSHA256(kDate, cred.region);
  const kService = await hmacSHA256(kRegion, cred.service);
  const kSigning = await hmacSHA256(kService, "aws4_request");

  const calculatedSig = Buffer.from(await hmacSHA256(kSigning, stringToSign)).toString("hex");

  // 7. Constant-Time Compare
  return timingSafeEqual(cred.signature, calculatedSig);
}

async function hmacSHA256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? enc.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export async function generatePresignedUrl({
  endpoint,
  bucket,
  key,
  accessKeyId,
  secretKey,
  expiresInSeconds = 3600,
  method = "GET",
  region = "us-east-1",
}: {
  endpoint: string;
  bucket: string;
  key: string;
  accessKeyId: string;
  secretKey: string;
  expiresInSeconds?: number;
  method?: string;
  region?: string;
}): Promise<string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const cleanEndpoint = endpoint.replace(/\/+$/, "");
  const cleanKey = key.replace(/^\/+/, "");
  const targetUrl = new URL(`${cleanEndpoint}/${bucket}/${cleanKey}`);

  const scope = `${dateStamp}/${region}/s3/aws4_request`;

  targetUrl.searchParams.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
  targetUrl.searchParams.set("X-Amz-Credential", `${accessKeyId}/${scope}`);
  targetUrl.searchParams.set("X-Amz-Date", amzDate);
  targetUrl.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  targetUrl.searchParams.set("X-Amz-SignedHeaders", "host");

  // Canonical Query String
  const queryParams: [string, string][] = [];
  for (const [k, v] of targetUrl.searchParams.entries()) {
    queryParams.push([encodeURIComponent(k), encodeURIComponent(v)]);
  }
  queryParams.sort(([a], [b]) => a.localeCompare(b));
  const canonicalQuery = queryParams.map(([k, v]) => `${k}=${v}`).join("&");

  // Canonical Request
  const canonicalHeaders = `host:${targetUrl.host}\n`;
  const canonicalRequest = [
    method.toUpperCase(),
    targetUrl.pathname,
    canonicalQuery,
    canonicalHeaders,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const canonicalHash = new Bun.CryptoHasher("sha256")
    .update(canonicalRequest)
    .digest("hex");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    canonicalHash,
  ].join("\n");

  const kDate = await hmacSHA256(`AWS4${secretKey}`, dateStamp);
  const kRegion = await hmacSHA256(kDate, region);
  const kService = await hmacSHA256(kRegion, "s3");
  const kSigning = await hmacSHA256(kService, "aws4_request");
  const signature = Buffer.from(await hmacSHA256(kSigning, stringToSign)).toString("hex");

  targetUrl.searchParams.set("X-Amz-Signature", signature);
  return targetUrl.toString();
}
