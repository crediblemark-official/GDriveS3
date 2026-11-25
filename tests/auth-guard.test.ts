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

  it("should sync admin email and password when env changes while preserving UI password changes if env stays unchanged", async () => {
    const syncDir = mkdtempSync(join(tmpdir(), "gdrives3-admin-sync-"));
    try {
      // 1. Seed initial default credentials (simulates legacy/default boot)
      const boot1 = initDatabase(syncDir, "admin@gdrives3.local", "change-me-now");
      const cipher1 = await TokenCipher.init(Buffer.from(new Uint8Array(32).fill(9)).toString("base64"), syncDir);
      const oauth = new GoogleOAuth("", "", "");
      const api1 = createApiRouter(boot1.db, oauth, cipher1, new S3Engine(boot1.db, new Balancer(boot1.db, oauth, cipher1), oauth, cipher1));

      // Change password via UI while env still uses defaults
      const login1 = await api1.handle(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "admin@gdrives3.local", password: "change-me-now" }),
        })
      );
      expect(login1.status).toBe(200);
      const cookie1 = `gdrives3_session=${(login1.headers.get("set-cookie") || "").match(/gdrives3_session=([^;]+)/)![1]}`;
      const chgRes = await api1.handle(
        new Request("http://localhost/api/auth/change-password", {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie1 },
          body: JSON.stringify({ currentPassword: "change-me-now", newPassword: "ui-password-123" }),
        })
      );
      expect(chgRes.status).toBe(200);
      boot1.sqlite.close();

      // 2. Restart with unchanged env -> UI password must stay valid
      const boot2 = initDatabase(syncDir, "admin@gdrives3.local", "change-me-now");
      const api2 = createApiRouter(boot2.db, oauth, cipher1, new S3Engine(boot2.db, new Balancer(boot2.db, oauth, cipher1), oauth, cipher1));
      const loginUi = await api2.handle(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "admin@gdrives3.local", password: "ui-password-123" }),
        })
      );
      expect(loginUi.status).toBe(200);
      boot2.sqlite.close();

      // 3. Restart with updated env email/password -> admin login updates to match env
      const boot3 = initDatabase(syncDir, "owner@company.local", "env-updated-pass");
      const api3 = createApiRouter(boot3.db, oauth, cipher1, new S3Engine(boot3.db, new Balancer(boot3.db, oauth, cipher1), oauth, cipher1));
      const oldLogin = await api3.handle(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "admin@gdrives3.local", password: "ui-password-123" }),
        })
      );
      expect(oldLogin.status).toBe(401);

      const newLogin = await api3.handle(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "owner@company.local", password: "env-updated-pass" }),
        })
      );
      expect(newLogin.status).toBe(200);
      const loginData = (await newLogin.json()) as { user: { email: string; mustChangePassword: boolean } };
      expect(loginData.user.email).toBe("owner@company.local");
      expect(loginData.user.mustChangePassword).toBe(false);
      boot3.sqlite.close();
    } finally {
      rmSync(syncDir, { recursive: true, force: true });
    }
  });
});
