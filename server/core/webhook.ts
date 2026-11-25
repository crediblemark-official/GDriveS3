import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { systemSettings } from "../db/schema";
import { logger } from "./logger";

export interface WebhookConfig {
  enabled: boolean;
  url: string;
  thresholdPercent: number;
  notifyOnQuota: boolean;
  notifyOnAuthError: boolean;
}

export const DEFAULT_WEBHOOK_CONFIG: WebhookConfig = {
  enabled: false,
  url: "",
  thresholdPercent: 85,
  notifyOnQuota: true,
  notifyOnAuthError: true,
};

function isPrivateOrLoopbackHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    host === "::1" ||
    host === "::" ||
    host.startsWith("fe80:") ||
    host.startsWith("fc") ||
    host.startsWith("fd")
  ) {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return true;
    }
  }
  return false;
}

export function validateWebhookUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return "URL webhook tidak valid";
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return "Webhook hanya mendukung protokol http:// atau https://";
  }

  if (isPrivateOrLoopbackHost(parsed.hostname)) {
    return "Host internal/loopback/metadata tidak diizinkan";
  }

  return null;
}

export function getWebhookConfig(db: AppDatabase): WebhookConfig {
  const row = db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, "webhook_config"))
    .get();
  if (!row) return { ...DEFAULT_WEBHOOK_CONFIG };
  try {
    return { ...DEFAULT_WEBHOOK_CONFIG, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_WEBHOOK_CONFIG };
  }
}

export function saveWebhookConfig(db: AppDatabase, cfg: WebhookConfig): void {
  const nowValue = JSON.stringify(cfg);
  const existing = db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, "webhook_config"))
    .get();

  if (existing) {
    db.update(systemSettings)
      .set({ value: nowValue })
      .where(eq(systemSettings.key, "webhook_config"))
      .run();
  } else {
    db.insert(systemSettings)
      .values({ key: "webhook_config", value: nowValue })
      .run();
  }
}

export async function dispatchWebhook(
  url: string,
  event: string,
  message: string,
  details?: Record<string, any>
): Promise<{ ok: boolean; status: number }> {
  const text = `[GDriveS3] ${message}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: text, // Discord compatible
      text,          // Slack compatible
      event,
      timestamp: new Date().toISOString(),
      details: details || {},
    }),
  });
  return { ok: res.ok, status: res.status };
}

const WEBHOOK_COOLDOWN_MS = 60 * 60 * 1000;
const recentWebhookAlerts = new Map<string, number>();

export async function notifyWebhookIfEnabled(
  db: AppDatabase,
  event: "quota_warning" | "auth_error" | "fallback_used",
  message: string,
  details?: Record<string, any>
): Promise<void> {
  const cfg = getWebhookConfig(db);
  if (!cfg.enabled || !cfg.url) return;
  if (event === "quota_warning" && !cfg.notifyOnQuota) return;
  if (event === "auth_error" && !cfg.notifyOnAuthError) return;

  const dedupKey = `${event}:${details?.email || "global"}`;
  const lastSent = recentWebhookAlerts.get(dedupKey);
  if (lastSent && Date.now() - lastSent < WEBHOOK_COOLDOWN_MS) {
    return;
  }
  recentWebhookAlerts.set(dedupKey, Date.now());

  try {
    const res = await dispatchWebhook(cfg.url, event, message, details);
    if (!res.ok) {
      logger.warn("webhook", `Gagal mengirim notifikasi (${event}): HTTP ${res.status}`);
    } else {
      logger.info("webhook", `Notifikasi terkirim (${event})`);
    }
  } catch (err) {
    logger.warn("webhook", `Error mengirim webhook (${event}): ${(err as Error).message}`);
  }
}
