import { Buffer } from "node:buffer";

const S3_ENDPOINT = "http://localhost:9000";
const ACCESS_KEY_ID = "G36EDCFF5437E5EFF0655CAC822AB20851";
const SECRET_ACCESS_KEY = "wLXrKTkGgHTz08VfyDlH_Bt4Z4QcC8zIquH-JEUHA9w";
const REGION = "us-east-1";
const SERVICE = "s3";

async function hmac(key: string | Uint8Array, data: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const rawKey = typeof key === "string" ? enc.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return new Uint8Array(signature);
}

function sha256Hex(data: string | Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(data).digest("hex");
}

async function s3Fetch(
  method: string,
  path: string,
  body: string | Uint8Array = "",
  contentType: string = "text/plain"
) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = sha256Hex(body);
  const url = new URL(path, S3_ENDPOINT);

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
  };
  if (method === "PUT" && body) {
    headers["content-type"] = contentType;
  }

  const sortedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k.toLowerCase()}:${headers[k].trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = await hmac(`AWS4${SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = await hmac(kDate, REGION);
  const kService = await hmac(kRegion, SERVICE);
  const kSigning = await hmac(kService, "aws4_request");
  const signatureBytes = await hmac(kSigning, stringToSign);
  const signature = Buffer.from(signatureBytes).toString("hex");

  const authHeader = `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url.toString(), {
    method,
    headers: {
      ...headers,
      Authorization: authHeader,
    },
    body: method !== "GET" && method !== "HEAD" && body ? body : undefined,
  });
}

async function runTests() {
  console.log("====================================================");
  console.log("       G3 S3 Compatibility & Drive E2E Test         ");
  console.log("====================================================");
  console.log("Access Key ID:", ACCESS_KEY_ID);
  console.log("Endpoint     :", S3_ENDPOINT);

  // 1. List Buckets
  console.log("\n[Test 1] ListBuckets (GET /)");
  const listRes = await s3Fetch("GET", "/");
  console.log("Status:", listRes.status);
  const listXml = await listRes.text();
  console.log("Response XML:\n", listXml);

  // 2. PutObject (Upload file ke bucket 'testos')
  console.log("\n[Test 2] PutObject (PUT /testos/halo-dunia.txt)");
  const fileContent = "Halo dari G3 S3 Google Drive! Waktu tes: " + new Date().toISOString();
  const putRes = await s3Fetch("PUT", "/testos/halo-dunia.txt", fileContent, "text/plain");
  console.log("Status:", putRes.status);
  console.log("ETag Header:", putRes.headers.get("etag"));

  // 3. ListObjects (GET /testos)
  console.log("\n[Test 3] ListObjectsV2 (GET /testos)");
  const listObjRes = await s3Fetch("GET", "/testos");
  console.log("Status:", listObjRes.status);
  const listObjXml = await listObjRes.text();
  console.log("Response XML:\n", listObjXml);

  // 4. GetObject (Download file dari Google Drive via S3 API)
  console.log("\n[Test 4] GetObject (GET /testos/halo-dunia.txt)");
  const getRes = await s3Fetch("GET", "/testos/halo-dunia.txt");
  console.log("Status:", getRes.status);
  console.log("Content-Type:", getRes.headers.get("content-type"));
  const downloadedContent = await getRes.text();
  console.log("Isi File yang Diunduh:\n", downloadedContent);

  if (downloadedContent === fileContent) {
    console.log("\n🎉 SEMUA TES S3 BERHASIL 100%! Data berhasil diunggah & dibaca langsung dari Google Drive!");
  } else {
    console.error("\n❌ Konten file tidak cocok!");
  }
}

runTests().catch(console.error);
