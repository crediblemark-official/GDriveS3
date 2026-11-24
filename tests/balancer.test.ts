import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { initDatabase } from "../server/db/client";
import { driveAccounts, systemSettings } from "../server/db/schema";
import { TokenCipher } from "../server/core/crypto";
import { GoogleOAuth } from "../server/drive/oauth";
import { Balancer } from "../server/drive/balancer";

describe("Storage Balancer (Real Class)", () => {
  let tempDir: string;
  let db: ReturnType<typeof initDatabase>["db"];
  let cipher: TokenCipher;
  let balancer: Balancer;

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), "g3-balancer-test-"));
    db = initDatabase(tempDir, "admin@test.local", "secret123").db;
    const key = Buffer.from(new Uint8Array(32).fill(9)).toString("base64");
    cipher = await TokenCipher.init(key, tempDir);

    const mockOAuth = {
      refreshAccessToken: async () => "mock-access-token",
    } as unknown as GoogleOAuth;

    balancer = new Balancer(db, mockOAuth, cipher);

    const enc1 = await cipher.encrypt("refresh-1");
    const enc2 = await cipher.encrypt("refresh-2");
    const enc3 = await cipher.encrypt("refresh-3");

    db.insert(driveAccounts)
      .values([
        {
          id: "acc-1",
          email: "a@gmail.com",
          refreshToken: enc1,
          storageUsage: 500,
          storageLimit: 1000,
          dailyBytes: 0,
          weight: 1,
          status: "connected",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-01-01T00:00:00Z",
        },
        {
          id: "acc-2",
          email: "b@gmail.com",
          refreshToken: enc2,
          storageUsage: 200,
          storageLimit: 1000,
          dailyBytes: 0,
          weight: 1,
          status: "connected",
          createdAt: "2026-01-02T00:00:00Z",
          updatedAt: "2026-01-02T00:00:00Z",
        },
        {
          id: "acc-3",
          email: "c@gmail.com",
          refreshToken: enc3,
          storageUsage: 1000, // full, should be skipped
          storageLimit: 1000,
          dailyBytes: 0,
          weight: 1,
          status: "connected",
          createdAt: "2026-01-03T00:00:00Z",
          updatedAt: "2026-01-03T00:00:00Z",
        },
      ])
      .run();
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function setStrategy(strategy: string) {
    db.insert(systemSettings)
      .values({ key: "balancing_strategy", value: strategy })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: strategy } })
      .run();
  }

  it("should pick least_used account with most free space and skip full accounts", async () => {
    setStrategy("least_used");
    const picked = await balancer.pickAccount("file.bin");
    expect(picked.account.id).toBe("acc-2");
    expect(picked.accessToken).toBe("mock-access-token");
  });

  it("should pick fill_first account by oldest createdAt among eligible accounts", async () => {
    setStrategy("fill_first");
    const picked = await balancer.pickAccount("file.bin");
    expect(picked.account.id).toBe("acc-1");
  });

  it("should deterministically map same key under hash strategy", async () => {
    setStrategy("hash");
    const pick1 = await balancer.pickAccount("photos/holiday.jpg");
    const pick2 = await balancer.pickAccount("photos/holiday.jpg");
    expect(pick1.account.id).toBe(pick2.account.id);
  });

  it("should cycle eligible accounts under round_robin and skip revoked/zero-weight accounts", async () => {
    setStrategy("round_robin");
    const p1 = await balancer.pickAccount("k1");
    const p2 = await balancer.pickAccount("k2");
    expect(new Set([p1.account.id, p2.account.id]).size).toBe(2);

    db.update(driveAccounts).set({ status: "revoked" }).where(eq(driveAccounts.id, "acc-1")).run();
    const p3 = await balancer.pickAccount("k3");
    expect(p3.account.id).toBe("acc-2");

    db.update(driveAccounts).set({ status: "connected" }).where(eq(driveAccounts.id, "acc-1")).run();
  });

  it("should record daily and total usage accurately", () => {
    balancer.recordUsage("acc-2", 150);
    const updated = db.select().from(driveAccounts).where(eq(driveAccounts.id, "acc-2")).get();
    expect(updated?.storageUsage).toBe(350);
    expect(updated?.dailyBytes).toBe(150);
  });
});
