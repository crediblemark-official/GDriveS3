import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase } from "../server/db/client";
import { TokenCipher } from "../server/core/crypto";
import { GoogleOAuth } from "../server/drive/oauth";
import { Balancer } from "../server/drive/balancer";
import { S3Engine } from "../server/s3/engine";
import { createApiRouter } from "../server/api/routes";

describe("API Session Auth Guard", () => {
  let tempDir: string;
  let api: ReturnType<typeof createApiRouter>;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "gdrives3-auth-test-"));
    const { db } = initDatabase(tempDir, "admin@test.local", "secret123");
    const key = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
    const cipher = await TokenCipher.init(key, tempDir);
    const oauth = new GoogleOAuth("", "", "");
    const balancer = new Balancer(db, oauth, cipher);
    const engine = new S3Engine(db, balancer, oauth, cipher);
    api = createApiRouter(db, oauth, cipher, engine);
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should expose public /api/health and block protected /api/* routes with 401", async () => {
    const healthRes = await api.handle(new Request("http://localhost/api/health"));
    expect(healthRes.status).toBe(200);
    expect(await healthRes.json()).toEqual({ ok: true, status: "healthy" });

    const keysRes = await api.handle(new Request("http://localhost/api/keys"));
    expect(keysRes.status).toBe(401);

    const logsRes = await api.handle(new Request("http://localhost/api/logs"));
    expect(logsRes.status).toBe(401);
  });

  it("should allow login and grant access to protected routes with gdrives3_session cookie", async () => {
    const loginRes = await api.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "admin@test.local", password: "secret123" }),
      })
    );
    expect(loginRes.status).toBe(200);

    const setCookie = loginRes.headers.get("set-cookie") || "";
    const match = setCookie.match(/gdrives3_session=([^;]+)/);
    expect(match).not.toBeNull();
    const sessionCookie = `gdrives3_session=${match![1]}`;

    const keysRes = await api.handle(
      new Request("http://localhost/api/keys", {
        headers: { Cookie: sessionCookie },
      })
    );
    expect(keysRes.status).toBe(200);
  });

  it("should rate-limit repeated failed login attempts with 429", async () => {
    const ipHeader = { "x-forwarded-for": "203.0.113.77", "Content-Type": "application/json" };
    for (let i = 0; i < 10; i++) {
      const res = await api.handle(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: ipHeader,
          body: JSON.stringify({ email: "admin@test.local", password: "wrong-password" }),
        })
      );
      expect(res.status).toBe(401);
    }

    const blockedRes = await api.handle(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: ipHeader,
        body: JSON.stringify({ email: "admin@test.local", password: "wrong-password" }),
      })
    );
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get("retry-after")).toBeTruthy();
  });
});
