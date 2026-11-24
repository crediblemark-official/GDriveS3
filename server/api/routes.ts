import { Elysia, t } from "elysia";
import { eq, desc } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { users, sessions, driveAccounts, buckets, objects, s3AccessKeys, systemSettings } from "../db/schema";
import type { TokenCipher } from "../core/crypto";
import type { GoogleOAuth } from "../drive/oauth";
import { DriveClient } from "../drive/client";
import type { S3Engine } from "../s3/engine";

export function createApiRouter(
  db: AppDatabase,
  oauth: GoogleOAuth,
  cipher: TokenCipher,
  engine: S3Engine
) {
  const router = new Elysia({ prefix: "/api" });

  // 1. Auth & Session
  router.post("/auth/login", async ({ body, cookie: { g3_session }, set }) => {
    const { email, password } = body as { email?: string; password?: string };
    if (!email || !password) {
      set.status = 400;
      return { error: "Email dan password wajib diisi" };
    }

    const user = db.select().from(users).where(eq(users.email, email.trim())).get();
    if (!user || !Bun.password.verifySync(password, user.passwordHash)) {
      set.status = 401;
      return { error: "Email atau password salah" };
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.insert(sessions).values({
      id: crypto.randomUUID(),
      userId: user.id,
      token,
      expiresAt,
      createdAt: new Date().toISOString(),
    }).run();

    g3_session.set({
      value: token,
      httpOnly: true,
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  });

  router.post("/auth/logout", async ({ cookie: { g3_session } }) => {
    const token = typeof g3_session.value === "string" ? g3_session.value : "";
    if (token) {
      db.delete(sessions).where(eq(sessions.token, token)).run();
      g3_session.remove();
    }
    return { success: true };
  });

  router.get("/me", async ({ cookie: { g3_session }, set }) => {
    const token = typeof g3_session.value === "string" ? g3_session.value : "";
    if (!token) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const sess = db.select().from(sessions).where(eq(sessions.token, token)).get();
    if (!sess || new Date(sess.expiresAt) < new Date()) {
      set.status = 401;
      return { error: "Session expired" };
    }

    const user = db.select().from(users).where(eq(users.id, sess.userId)).get();
    if (!user) {
      set.status = 401;
      return { error: "User not found" };
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  });

  // 2. Stats
  router.get("/stats", async () => {
    const accounts = db.select().from(driveAccounts).all();
    const allBuckets = db.select().from(buckets).all();
    const allObjects = db.select().from(objects).all();

    const totalStorageLimit = accounts.reduce((acc, a) => acc + (a.storageLimit || 0), 0);
    const totalStorageUsage = accounts.reduce((acc, a) => acc + (a.storageUsage || 0), 0);
    const totalObjectBytes = allObjects.reduce((acc, o) => acc + (o.size || 0), 0);

    return {
      accountsCount: accounts.length,
      bucketsCount: allBuckets.length,
      objectsCount: allObjects.length,
      totalStorageLimit,
      totalStorageUsage,
      totalObjectBytes,
      accounts: accounts.map((a) => ({
        id: a.id,
        email: a.email,
        status: a.status,
        storageLimit: a.storageLimit,
        storageUsage: a.storageUsage,
        dailyBytes: a.dailyBytes,
      })),
    };
  });

  // 3. Accounts (Google Drive)
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

  router.get("/accounts/connect", async ({ set }) => {
    if (!oauth.isConfigured()) {
      set.status = 400;
      return { error: "Google OAuth client belum dikonfigurasi di .env" };
    }
    const state = crypto.randomUUID();
    return { url: oauth.getAuthUrl(state) };
  });

  router.get("/accounts/callback", async ({ query, set }) => {
    const code = query.code as string;
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

      // Redirect balik ke dashboard panel
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
      <p style="margin: 0 0 16px 0; color: #a1a1aa; font-size: 14px;">Akun <strong>${info.email}</strong> berhasil terhubung ke pool G3.</p>
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

  router.delete("/accounts/:id", async ({ params, set }) => {
    db.delete(driveAccounts).where(eq(driveAccounts.id, params.id)).run();
    return { success: true };
  });

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
          updatedAt: now,
        })
        .where(eq(driveAccounts.id, acc.id))
        .run();

      return {
        success: true,
        storageLimit: info.limit,
        storageUsage: info.usage,
      };
    } catch (err: any) {
      set.status = 500;
      return { error: `Gagal sinkronisasi kuota: ${err.message}` };
    }
  });

  // 4. Buckets & File Manager
  router.get("/buckets", async () => {
    const list = db.select().from(buckets).all();
    return list.map((b) => {
      const objs = db.select().from(objects).where(eq(objects.bucketId, b.id)).all();
      const totalSize = objs.reduce((sum, o) => sum + (o.size || 0), 0);
      return {
        id: b.id,
        name: b.name,
        createdAt: b.createdAt,
        objectsCount: objs.length,
        totalSize,
      };
    });
  });

  router.post("/buckets", async ({ body, set }) => {
    const { name } = body as { name?: string };
    if (!name || !/^[a-z0-9.-]{3,63}$/.test(name)) {
      set.status = 400;
      return { error: "Nama bucket tidak valid (3-63 karakter a-z, 0-9, dot, minus)" };
    }

    const existing = db.select().from(buckets).where(eq(buckets.name, name)).get();
    if (existing) {
      set.status = 409;
      return { error: "Bucket dengan nama tersebut sudah ada" };
    }

    const newBucket = {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
    };
    db.insert(buckets).values(newBucket).run();
    return newBucket;
  });

  router.delete("/buckets/:id", async ({ params, set }) => {
    const objs = db.select().from(objects).where(eq(objects.bucketId, params.id)).all();
    if (objs.length > 0) {
      set.status = 409;
      return { error: "Bucket tidak dapat dihapus karena masih berisi file" };
    }
    db.delete(buckets).where(eq(buckets.id, params.id)).run();
    return { success: true };
  });

  router.get("/buckets/:id/objects", async ({ params, query }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) return [];

    const prefix = (query.prefix as string) || "";
    const allObjs = db.select().from(objects).where(eq(objects.bucketId, bucket.id)).all();

    return allObjs
      .filter((o) => o.objectKey.startsWith(prefix))
      .map((o) => ({
        id: o.id,
        key: o.objectKey,
        size: o.size,
        etag: o.etag,
        contentType: o.contentType,
        updatedAt: o.updatedAt,
      }));
  });

  // Browser Direct Upload
  router.post("/buckets/:id/upload", async ({ params, query, request, set }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) {
      set.status = 404;
      return { error: "Bucket not found" };
    }

    const key = (query.key as string) || "";
    if (!key || !request.body) {
      set.status = 400;
      return { error: "Missing key or request body" };
    }

    const contentType = request.headers.get("content-type") || "application/octet-stream";
    const res = await engine.putObject(bucket.name, key, contentType, "{}", request.body);
    return res;
  });

  // Create Virtual Directory Marker
  router.post("/buckets/:id/folder", async ({ params, body, set }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) {
      set.status = 404;
      return { error: "Bucket tidak ditemukan" };
    }
    const { folderName, prefix } = body as { folderName?: string; prefix?: string };
    if (!folderName) {
      set.status = 400;
      return { error: "Nama folder tidak boleh kosong" };
    }
    const cleanName = folderName.trim().replace(/^\/+|\/+$/g, "");
    const basePrefix = prefix ? prefix.replace(/^\/+|\/+$/g, "") + "/" : "";
    const folderKey = `${basePrefix}${cleanName}/`;

    const emptyStream = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
    const res = await engine.putObject(
      bucket.name,
      folderKey,
      "application/x-directory",
      "{}",
      emptyStream
    );
    return { success: true, key: folderKey, res };
  });

  // Browser Direct Download
  router.get("/buckets/:id/download", async ({ params, query, set }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) {
      set.status = 404;
      return "Bucket not found";
    }
    const key = query.key as string;
    const { obj, response: driveRes } = await engine.getObject(bucket.name, key);

    set.status = driveRes.status;
    set.headers["Content-Type"] = obj.contentType || "application/octet-stream";
    set.headers["Content-Disposition"] = `attachment; filename="${key.split("/").pop()}"`;
    return driveRes.body;
  });

  router.delete("/buckets/:id/objects", async ({ params, query }) => {
    const bucket = db.select().from(buckets).where(eq(buckets.id, params.id)).get();
    if (!bucket) return { success: false };
    const key = query.key as string;
    await engine.deleteObject(bucket.name, key);
    return { success: true };
  });

  // 5. Access Keys (S3 Credentials)
  router.get("/keys", async () => {
    const list = db.select().from(s3AccessKeys).all();
    return list.map((k) => ({
      id: k.id,
      accessKeyId: k.accessKeyId,
      label: k.label,
      createdAt: k.createdAt,
    }));
  });

  router.post("/keys", async ({ body }) => {
    const { label } = body as { label?: string };
    const rawKey = new Uint8Array(16);
    const rawSecret = new Uint8Array(32);
    crypto.getRandomValues(rawKey);
    crypto.getRandomValues(rawSecret);

    const accessKeyId = "G3" + Buffer.from(rawKey).toString("hex").toUpperCase();
    const secretKey = Buffer.from(rawSecret).toString("base64url");
    const secretHash = await cipher.encrypt(secretKey);

    const newKey = {
      id: crypto.randomUUID(),
      accessKeyId,
      secretHash,
      label: label || "Default Key",
      createdAt: new Date().toISOString(),
    };
    db.insert(s3AccessKeys).values(newKey).run();

    return {
      id: newKey.id,
      accessKeyId,
      secretKey, // Ditampilkan satu kali saja saat create
      label: newKey.label,
      createdAt: newKey.createdAt,
    };
  });

  router.delete("/keys/:id", async ({ params }) => {
    db.delete(s3AccessKeys).where(eq(s3AccessKeys.id, params.id)).run();
    return { success: true };
  });

  // 6. Maintenance & Settings
  router.post("/storage/gc", async () => {
    const swept = await engine.sweepStaleMultipartUploads(24 * 60 * 60 * 1000);
    return {
      success: true,
      staleUploadsSwept: swept,
      message: `Pembersihan selesai: ${swept} upload multipart yang kedaluwarsa telah dihapus dari Google Drive.`,
    };
  });

  router.get("/settings/balancing", async () => {
    const row = db.select().from(systemSettings).where(eq(systemSettings.key, "balancing_strategy")).get();
    return { strategy: row?.value || "round_robin" };
  });

  router.put("/settings/balancing", async ({ body, set }) => {
    const { strategy } = body as { strategy?: string };
    const valid = ["round_robin", "least_used", "fill_first", "hash"];
    if (!strategy || !valid.includes(strategy)) {
      set.status = 400;
      return { error: "Strategi balancing tidak valid" };
    }
    db.insert(systemSettings)
      .values({ key: "balancing_strategy", value: strategy })
      .onConflictDoUpdate({ target: systemSettings.key, set: { value: strategy } })
      .run();
    return { success: true, strategy };
  });

  return router;
}
