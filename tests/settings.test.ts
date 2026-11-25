import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initDatabase } from "../server/db/client";
import { validateWebhookUrl, getWebhookConfig, saveWebhookConfig } from "../server/core/webhook";
import { getS3CorsConfig, saveS3CorsConfig } from "../server/core/corsConfig";
import { getLocalFallbackConfig, saveLocalFallbackConfig } from "../server/core/fallbackConfig";

describe("Webhook & S3 CORS Settings", () => {
  let tempDir: string;
  let db: ReturnType<typeof initDatabase>["db"];

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gdrives3-settings-test-"));
    db = initDatabase(tempDir, "admin@test.local", "secret123").db;
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("should validate webhook URLs and reject metadata/private/loopback/non-http hosts", () => {
    expect(validateWebhookUrl("https://discord.com/api/webhooks/123/abc")).toBeNull();
    expect(validateWebhookUrl("ftp://example.com/hook")).not.toBeNull();
    expect(validateWebhookUrl("http://169.254.169.254/latest/meta-data")).not.toBeNull();
    expect(validateWebhookUrl("http://127.0.0.1:8787/hook")).not.toBeNull();
    expect(validateWebhookUrl("http://localhost:9000/hook")).not.toBeNull();
    expect(validateWebhookUrl("http://10.0.0.5/hook")).not.toBeNull();
    expect(validateWebhookUrl("http://192.168.1.1/hook")).not.toBeNull();
    expect(validateWebhookUrl("http://[::1]:8080/hook")).not.toBeNull();
  });

  it("should persist webhook config in SQLite system_settings", () => {
    saveWebhookConfig(db, {
      enabled: true,
      url: "https://hooks.slack.com/services/T00/B00/XXX",
      thresholdPercent: 90,
      notifyOnQuota: true,
      notifyOnAuthError: false,
    });
    const loaded = getWebhookConfig(db);
    expect(loaded.enabled).toBe(true);
    expect(loaded.thresholdPercent).toBe(90);
    expect(loaded.notifyOnAuthError).toBe(false);
  });

  it("should persist S3 CORS policy in SQLite system_settings", () => {
    saveS3CorsConfig(db, {
      allowedOrigins: ["https://app.example.com"],
      allowedMethods: ["GET", "PUT"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAgeSeconds: 7200,
    });
    const loaded = getS3CorsConfig(db);
    expect(loaded.allowedOrigins).toEqual(["https://app.example.com"]);
    expect(loaded.allowedMethods).toEqual(["GET", "PUT"]);
    expect(loaded.maxAgeSeconds).toBe(7200);
  });

  it("should persist local VPS fallback policy in SQLite system_settings", () => {
    const defaults = getLocalFallbackConfig(db);
    expect(defaults.enabled).toBe(true);
    expect(defaults.autoSyncToDrive).toBe(true);

    saveLocalFallbackConfig(db, {
      enabled: true,
      maxMb: 2048,
      autoSyncToDrive: false,
      notifyOnFallback: true,
    });
    const loaded = getLocalFallbackConfig(db);
    expect(loaded.enabled).toBe(true);
    expect(loaded.maxMb).toBe(2048);
    expect(loaded.autoSyncToDrive).toBe(false);
    expect(loaded.notifyOnFallback).toBe(true);
  });
});
