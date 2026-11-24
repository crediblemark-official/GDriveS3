import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { driveAccounts } from "../db/schema";
import type { GoogleOAuth } from "../drive/oauth";
import { DriveClient } from "../drive/client";
import type { TokenCipher } from "../core/crypto";
import { getWebhookConfig, notifyWebhookIfEnabled } from "../core/webhook";

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return ch;
    }
  });
}

export function createAccountsRoutes(
  db: AppDatabase,
  oauth: GoogleOAuth,
  cipher: TokenCipher
) {
  const router = new Elysia();

  // List Accounts
  router.get("/accounts", async () => {
    const list = db.select().from(driveAccounts).all();
    return list.map((a) => ({
      id: a.id,
      email: a.email,
      status: a.status,
      weight: a.weight,
      storageLimit: a.storageLimit,
      storageUsage: a.storageUsage,
      dailyBytes: a.dailyBytes,
      createdAt: a.createdAt,
    }));
  });

  // Start OAuth Flow
  router.get("/accounts/connect", async ({ cookie: { g3_oauth_state }, request, set }) => {
    if (!oauth.isConfigured()) {
      set.status = 400;
      return { error: "Google OAuth client belum dikonfigurasi di .env" };
    }
    const state = crypto.randomUUID();
    const isHttps =
      new URL(request.url).protocol === "https:" ||
      request.headers.get("x-forwarded-proto") === "https";
    g3_oauth_state.set({
      value: state,
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
      path: "/",
      maxAge: 600,
    });
    return { url: oauth.getAuthUrl(state) };
  });

  // OAuth Callback
  router.get("/accounts/callback", async ({ query, cookie: { g3_oauth_state }, set }) => {
    const code = query.code as string;
    const state = query.state as string;
    const expectedState = typeof g3_oauth_state?.value === "string" ? g3_oauth_state.value : "";
    g3_oauth_state.remove();

    if (!state || !expectedState || state !== expectedState) {
      set.status = 403;
      return "Invalid OAuth state parameter. Silakan ulangi proses penautan akun.";
    }
    if (!code) {
      set.status = 400;
      return "Missing authorization code";
    }

    try {
      const tokens = await oauth.exchangeCode(code);
      if (!tokens.refresh_token) {
        return "Gagal mendapatkan refresh token. Silakan cabut akses aplikasi di Google Security Settings lalu tautkan ulang.";
      }

      const info = await DriveClient.getAccountInfo(tokens.access_token);
      const encryptedRefresh = await cipher.encrypt(tokens.refresh_token);
      const now = new Date().toISOString();

      const existing = db.select().from(driveAccounts).where(eq(driveAccounts.email, info.email)).get();
      if (existing) {
        db.update(driveAccounts)
          .set({
            refreshToken: encryptedRefresh,
            folderId: info.folderId,
            storageLimit: info.limit,
            storageUsage: info.usage,
            status: "connected",
            updatedAt: now,
          })
          .where(eq(driveAccounts.id, existing.id))
          .run();
      } else {
        db.insert(driveAccounts)
          .values({
            id: crypto.randomUUID(),
            email: info.email,
            refreshToken: encryptedRefresh,
            folderId: info.folderId,
            storageLimit: info.limit,
            storageUsage: info.usage,
            status: "connected",
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }

      const safeEmail = escapeHtml(info.email);
      set.headers["Content-Type"] = "text/html; charset=utf-8";
      return `<!DOCTYPE html>
<html>
  <head>
    <meta http-equiv="refresh" content="0; url=/#/accounts" />
    <title>Berhasil Menautkan Akun</title>
  </head>
  <body style="font-family: system-ui, -apple-system, sans-serif; background: #09090b; color: #f4f4f5; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
    <div style="text-align: center; padding: 24px; border: 1px solid #27272a; border-radius: 16px; background: #18181b; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
      <h2 style="margin: 0 0 8px 0; color: #10b981;">✅ Berhasil Menautkan Akun Google Drive!</h2>
      <p style="margin: 0 0 16px 0; color: #a1a1aa; font-size: 14px;">Akun <strong>${safeEmail}</strong> berhasil terhubung ke pool G3.</p>
      <a href="/#/accounts" style="display: inline-block; padding: 8px 16px; background: #f4f4f5; color: #09090b; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">Kembali ke Panel &rarr;</a>
    </div>
    <script>
      window.location.replace("/#/accounts");
    </script>
  </body>
</html>`;
    } catch (err: any) {
      set.status = 500;
      return `OAuth Error: ${err.message}`;
    }
  });

  // Disconnect Account
  router.delete("/accounts/:id", async ({ params }) => {
    db.delete(driveAccounts).where(eq(driveAccounts.id, params.id)).run();
    return { success: true };
  });

  // Sync Storage Quota from Drive API
  router.post("/accounts/:id/sync", async ({ params, set }) => {
    const acc = db.select().from(driveAccounts).where(eq(driveAccounts.id, params.id)).get();
    if (!acc) {
      set.status = 404;
      return { error: "Akun tidak ditemukan" };
    }
    try {
      const refreshToken = await cipher.decrypt(acc.refreshToken);
      const token = await oauth.refreshAccessToken(refreshToken);
      const info = await DriveClient.getAccountInfo(token);
      const now = new Date().toISOString();

      db.update(driveAccounts)
        .set({
          storageLimit: info.limit,
          storageUsage: info.usage,
          status: "connected",
          updatedAt: now,
        })
        .where(eq(driveAccounts.id, acc.id))
        .run();

      const webhookCfg = getWebhookConfig(db);
      if (info.limit > 0) {
        const pct = Math.round((info.usage / info.limit) * 100);
        if (pct >= webhookCfg.thresholdPercent) {
          void notifyWebhookIfEnabled(
            db,
            "quota_warning",
            `Kuota Google Drive ${acc.email} mencapai ${pct}% (batas ${webhookCfg.thresholdPercent}%)`,
            { email: acc.email, usagePercent: pct }
          );
        }
      }

      return {
        success: true,
        storageLimit: info.limit,
        storageUsage: info.usage,
      };
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("token refresh") || msg.includes("invalid_grant")) {
        db.update(driveAccounts)
          .set({ status: "revoked", updatedAt: new Date().toISOString() })
          .where(eq(driveAccounts.id, acc.id))
          .run();
      }
      void notifyWebhookIfEnabled(
        db,
        "auth_error",
        `Gagal sinkronisasi/refresh token untuk ${acc.email}: ${err.message}`,
        { email: acc.email }
      );
      set.status = 500;
      return { error: `Gagal sinkronisasi kuota: ${err.message}` };
    }
  });

  return router;
}
