import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { staticPlugin } from "@elysiajs/static";
import { loadConfig } from "./core/config";
import { TokenCipher } from "./core/crypto";
import { initDatabase } from "./db/client";
import { GoogleOAuth } from "./drive/oauth";
import { Balancer } from "./drive/balancer";
import { S3Engine } from "./s3/engine";
import { createS3Router } from "./s3/routes";
import { createApiRouter } from "./api/routes";
import { existsSync } from "node:fs";
import { join } from "node:path";

async function main() {
  const config = loadConfig();
  console.log("-----------------------------------------");
  console.log("       G3 Storage (Bun + Elysia)         ");
  console.log("-----------------------------------------");

  // 1. Inisialisasi DB SQLite & Admin
  const { db } = initDatabase(config.dataDir, config.adminEmail, config.adminPassword);

  // 2. Cipher AES-GCM
  const cipher = await TokenCipher.init(config.encryptionKey, config.dataDir);

  // 3. Google OAuth & Balancer
  const oauth = new GoogleOAuth(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );
  if (!oauth.isConfigured()) {
    console.log("ℹ️ Google Drive OAuth belum dikonfigurasi (atur G3_GOOGLE_* di .env)");
  }

  const balancer = new Balancer(db, oauth, cipher);
  const s3Engine = new S3Engine(db, balancer, oauth, cipher);

  // 4. Server 1: S3 API Listener (Port 9000)
  const s3Router = createS3Router(db, s3Engine, cipher);
  const s3App = new Elysia()
    .use(cors())
    .use(s3Router)
    .listen({ port: config.s3Port, hostname: config.host }, () => {
      console.log(`📦 S3-compatible API listening on http://${config.host}:${config.s3Port}`);
    });

  // 5. Server 2: Web Panel & REST API Listener (Port 8787)
  const apiRouter = createApiRouter(db, oauth, cipher, s3Engine);
  const panelApp = new Elysia()
    .use(cors())
    .use(apiRouter);

  // Serve static dist panel jika ada
  const panelDist = join(import.meta.dir, "../../panel/dist");
  if (existsSync(panelDist)) {
    panelApp.use(staticPlugin({ assets: panelDist, prefix: "/" }));
    // SPA Fallback untuk Vue Router
    panelApp.get("*", ({ set }) => {
      set.headers["Content-Type"] = "text/html";
      return Bun.file(join(panelDist, "index.html"));
    });
  }

  panelApp.listen({ port: config.port, hostname: config.host }, () => {
    console.log(`⚡ Admin Web Panel listening on http://${config.host}:${config.port}`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\n[g3] Mematikan server...");
    s3App.stop();
    panelApp.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[g3] Fatal error:", err);
  process.exit(1);
});
