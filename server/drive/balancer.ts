import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { driveAccounts, systemSettings } from "../db/schema";
import type { TokenCipher } from "../core/crypto";
import type { GoogleOAuth } from "./oauth";
import { getWebhookConfig, notifyWebhookIfEnabled } from "../core/webhook";

const DAILY_UPLOAD_LIMIT = 750 * 1024 * 1024 * 1024; // 750 GB/hari per akun Google

export class Balancer {
  constructor(
    private db: AppDatabase,
    private oauth: GoogleOAuth,
    private cipher: TokenCipher
  ) {}

  private getTodayUTC(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async pickAccount(objectKey: string): Promise<{
    account: typeof driveAccounts.$inferSelect;
    accessToken: string;
  }> {
    const today = this.getTodayUTC();
    const all = this.db.select().from(driveAccounts).all();

    // Filter akun yang eligible
    const candidates = all.filter((acc) => {
      if (acc.status !== "connected" || (acc.weight ?? 1) <= 0) return false;
      if (acc.storageLimit && acc.storageLimit > 0 && (acc.storageUsage ?? 0) >= acc.storageLimit) {
        return false;
      }
      if (acc.dailyDate === today && (acc.dailyBytes ?? 0) >= DAILY_UPLOAD_LIMIT) {
        return false;
      }
      return true;
    });

    if (candidates.length === 0) {
      throw new Error("Tidak ada akun Google Drive yang tersedia di pool");
    }

    // Ambil strategi balancing
    const settingRow = this.db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, "balancing_strategy"))
      .get();
    const strategy = settingRow?.value || "round_robin";

    const chosen = this.choose(strategy, objectKey, candidates);

    // Refresh token dan minta access token baru
    try {
      const decryptedRefresh = await this.cipher.decrypt(chosen.refreshToken);
      const accessToken = await this.oauth.refreshAccessToken(decryptedRefresh);
      return { account: chosen, accessToken };
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("token refresh") || msg.includes("invalid_grant")) {
        this.db
          .update(driveAccounts)
          .set({ status: "revoked", updatedAt: new Date().toISOString() })
          .where(eq(driveAccounts.id, chosen.id))
          .run();
      }
      void notifyWebhookIfEnabled(
        this.db,
        "auth_error",
        `Gagal refresh token OAuth untuk ${chosen.email}: ${msg}`,
        { email: chosen.email }
      );
      throw err;
    }
  }

  private choose(
    strategy: string,
    key: string,
    candidates: (typeof driveAccounts.$inferSelect)[]
  ): typeof driveAccounts.$inferSelect {
    switch (strategy) {
      case "least_used": {
        return [...candidates].sort((a, b) => {
          const freeA = (a.storageLimit || 0) > 0 ? (a.storageLimit! - (a.storageUsage || 0)) : Infinity;
          const freeB = (b.storageLimit || 0) > 0 ? (b.storageLimit! - (b.storageUsage || 0)) : Infinity;
          return freeB - freeA; // terbesar pertama
        })[0];
      }
      case "fill_first": {
        return [...candidates].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      }
      case "hash": {
        let hash = 0;
        for (let i = 0; i < key.length; i++) {
          hash = (hash * 31 + key.charCodeAt(i)) & 0x7fffffff;
        }
        return candidates[hash % candidates.length];
      }
      default: {
        // round_robin
        const cursorRow = this.db
          .select()
          .from(systemSettings)
          .where(eq(systemSettings.key, "balancing_rr_cursor"))
          .get();
        const cursor = Number(cursorRow?.value || 0);
        const pick = candidates[cursor % candidates.length];

        const nextCursor = (cursor + 1) % 1_000_000;
        this.db
          .insert(systemSettings)
          .values({ key: "balancing_rr_cursor", value: String(nextCursor) })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: { value: String(nextCursor) },
          })
          .run();

        return pick;
      }
    }
  }

  recordUsage(accountId: string, bytes: number) {
    const today = this.getTodayUTC();
    const acc = this.db.select().from(driveAccounts).where(eq(driveAccounts.id, accountId)).get();
    if (!acc) return;

    const isSameDay = acc.dailyDate === today;
    const nextDaily = (isSameDay ? (acc.dailyBytes || 0) : 0) + bytes;
    const nextUsage = (acc.storageUsage || 0) + bytes;

    this.db
      .update(driveAccounts)
      .set({
        storageUsage: nextUsage,
        dailyBytes: nextDaily,
        dailyDate: today,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(driveAccounts.id, accountId))
      .run();

    if (acc.storageLimit && acc.storageLimit > 0) {
      const webhookCfg = getWebhookConfig(this.db);
      const pct = Math.round((nextUsage / acc.storageLimit) * 100);
      if (pct >= webhookCfg.thresholdPercent) {
        void notifyWebhookIfEnabled(
          this.db,
          "quota_warning",
          `Kuota Google Drive ${acc.email} mencapai ${pct}% (batas ${webhookCfg.thresholdPercent}%)`,
          { email: acc.email, usagePercent: pct }
        );
      }
    }
  }
}
