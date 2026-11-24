import { Elysia } from "elysia";
import type { AppDatabase } from "../db/client";
import type { TokenCipher } from "../core/crypto";
import type { GoogleOAuth } from "../drive/oauth";
import type { S3Engine } from "../s3/engine";
import { createAuthRoutes } from "./auth";
import { createAccountsRoutes } from "./accounts";
import { createBucketsRoutes } from "./buckets";
import { createKeysRoutes } from "./keys";
import { createSettingsRoutes } from "./settings";
import { createLogsRoutes } from "./logs";

export function createApiRouter(
  db: AppDatabase,
  oauth: GoogleOAuth,
  cipher: TokenCipher,
  engine: S3Engine
) {
  return new Elysia({ prefix: "/api" })
    .use(createAuthRoutes(db))
    .use(createAccountsRoutes(db, oauth, cipher))
    .use(createBucketsRoutes(db, cipher, engine))
    .use(createKeysRoutes(db, cipher))
    .use(createSettingsRoutes(db, engine))
    .use(createLogsRoutes());
}
