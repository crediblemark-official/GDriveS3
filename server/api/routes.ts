import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import type { Database } from "bun:sqlite";
import type { AppDatabase } from "../db/client";
import { sessions } from "../db/schema";
import type { TokenCipher } from "../core/crypto";
import type { GoogleOAuth } from "../drive/oauth";
import type { S3Engine } from "../s3/engine";
import { createAuthRoutes } from "./auth";
import { createAccountsRoutes } from "./accounts";
import { createBucketsRoutes } from "./buckets";
import { createKeysRoutes } from "./keys";
import { createSettingsRoutes } from "./settings";
import { createLogsRoutes } from "./logs";

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/accounts/callback",
]);

export function createApiRouter(
  db: AppDatabase,
  oauth: GoogleOAuth,
  cipher: TokenCipher,
  engine: S3Engine,
  opts?: { s3PublicUrl?: string; s3Port?: number; sqlite?: Database }
) {
  return new Elysia({ prefix: "/api" })
    .onBeforeHandle(({ request, cookie: { gdrives3_session }, set }) => {
      const pathname = new URL(request.url).pathname;
      if (PUBLIC_API_PATHS.has(pathname)) return;

      const token = typeof gdrives3_session?.value === "string" ? gdrives3_session.value : "";
      if (!token) {
        set.status = 401;
        return { error: "Unauthorized" };
      }

      const sess = db.select().from(sessions).where(eq(sessions.token, token)).get();
      if (!sess || new Date(sess.expiresAt) < new Date()) {
        set.status = 401;
        return { error: "Session expired" };
      }
    })
    .use(createAuthRoutes(db))
    .use(createAccountsRoutes(db, oauth, cipher))
    .use(createBucketsRoutes(db, cipher, engine, opts))
    .use(createKeysRoutes(db, cipher))
    .use(createSettingsRoutes(db, engine, opts))
    .use(createLogsRoutes());
}
