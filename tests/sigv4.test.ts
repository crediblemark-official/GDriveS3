import { describe, it, expect } from "bun:test";
import { parseSigV4, verifySigV4, generatePresignedUrl } from "../server/s3/sigv4";

describe("AWS Signature V4", () => {
  const accessKeyId = "G3TESTKEY1234567890";
  const secretKey = "testsecretkeyabcdef1234567890abcdef";

  it("should parse Authorization header", () => {
    const req = new Request("http://localhost:9000/my-bucket/test.txt", {
      headers: {
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/20261124/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789`,
        "x-amz-date": "20261124T120000Z",
      },
    });

    const parsed = parseSigV4(req);
    expect(parsed).not.toBeNull();
    expect(parsed?.accessKeyId).toBe(accessKeyId);
    expect(parsed?.region).toBe("us-east-1");
    expect(parsed?.service).toBe("s3");
    expect(parsed?.isPresigned).toBe(false);
  });

  it("should generate and verify presigned URL", async () => {
    const presignedUrl = await generatePresignedUrl({
      endpoint: "http://localhost:9000",
      bucket: "my-bucket",
      key: "photos/beach.png",
      accessKeyId,
      secretKey,
      expiresInSeconds: 3600,
      method: "GET",
    });

    expect(presignedUrl).toContain("X-Amz-Algorithm=AWS4-HMAC-SHA256");
    expect(presignedUrl).toContain(`X-Amz-Credential=${encodeURIComponent(accessKeyId)}`);
    expect(presignedUrl).toContain("X-Amz-Signature=");

    const req = new Request(presignedUrl, {
      method: "GET",
      headers: {
        host: "localhost:9000",
      },
    });

    const parsed = parseSigV4(req);
    expect(parsed).not.toBeNull();
    expect(parsed?.isPresigned).toBe(true);

    const isValid = await verifySigV4(req, parsed!, secretKey);
    expect(isValid).toBe(true);
  });

  it("should reject tampered presigned request", async () => {
    const presignedUrl = await generatePresignedUrl({
      endpoint: "http://localhost:9000",
      bucket: "my-bucket",
      key: "secret-doc.pdf",
      accessKeyId,
      secretKey,
      expiresInSeconds: 3600,
      method: "GET",
    });

    // Tamper with URL path to try reading another file
    const tamperedUrl = presignedUrl.replace("secret-doc.pdf", "other-file.txt");
    const req = new Request(tamperedUrl, {
      method: "GET",
      headers: { host: "localhost:9000" },
    });

    const parsed = parseSigV4(req);
    expect(parsed).not.toBeNull();
    const isValid = await verifySigV4(req, parsed!, secretKey);
    expect(isValid).toBe(false);
  });
});
