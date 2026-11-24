import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { loadConfig } from "./core/config";
import { TokenCipher } from "./core/crypto";
import { logger, createHttpLogger } from "./core/logger";
import { getS3CorsConfig } from "./core/corsConfig";
import { initDatabase } from "./db/client";
import * as schema from "./db/schema";
import { GoogleOAuth } from "./drive/oauth";
import { Balancer } from "./drive/balancer";
import { S3Engine } from "./s3/engine";
import { createS3Router } from "./s3/routes";
import { createApiRouter } from "./api/routes";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";

async function main() {
  const config = loadConfig();

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

  const balancer = new Balancer(db, oauth, cipher);
  const s3Engine = new S3Engine(db, balancer, oauth, cipher);

  // Ambil metadata storage pool & strategi penyeimbang untuk banner
  const activeAccounts = db
    .select({ email: schema.driveAccounts.email })
    .from(schema.driveAccounts)
    .where(eq(schema.driveAccounts.status, "connected"))
    .all();
  const accountsCount = activeAccounts.length;
  const primaryEmail = activeAccounts[0]?.email;

  const strategySetting = db
    .select()
    .from(schema.systemSettings)
    .where(eq(schema.systemSettings.key, "balancing_strategy"))
    .get();
  const strategyRaw = strategySetting?.value || "round_robin";
  const strategyLabels: Record<string, string> = {
    round_robin: "Round Robin",
    least_used: "Least Used",
    fill_first: "Fill First",
    hash: "Hash Key",
  };
  const balancingStrategy = strategyLabels[strategyRaw] || strategyRaw;

  // 4. Server 1: S3 API Listener (Port 9000) with Dynamic CORS Policy
  const s3Router = createS3Router(db, s3Engine, cipher);
  const s3App = new Elysia()
    .use(createHttpLogger("s3"))
    .onBeforeHandle(({ request, set }) => {
      const origin = request.headers.get("origin");
      const corsCfg = getS3CorsConfig(db);
      const allowAll = corsCfg.allowedOrigins.includes("*");
      const isAllowed = allowAll || (origin ? corsCfg.allowedOrigins.includes(origin) : false);

      if (isAllowed) {
        set.headers["Access-Control-Allow-Origin"] = allowAll ? "*" : (origin || "*");
        set.headers["Access-Control-Allow-Methods"] = corsCfg.allowedMethods.join(", ");
        set.headers["Access-Control-Allow-Headers"] = corsCfg.allowedHeaders.join(", ");
        set.headers["Access-Control-Max-Age"] = String(corsCfg.maxAgeSeconds);
      }

      if (request.method === "OPTIONS") {
        set.status = 204;
        return "";
      }
    })
    .use(s3Router)
    .listen({ port: config.s3Port, hostname: config.host });

  // 5. Server 2: Web Panel & REST API Listener (Port 8787)
  const apiRouter = createApiRouter(db, oauth, cipher, s3Engine);
  const panelApp = new Elysia()
    .use(createHttpLogger("api"))
    .use(cors())
    .use(apiRouter);

  // Serve static dist panel jika ada
  const panelDist = join(import.meta.dir, "../panel/dist");
  if (existsSync(panelDist)) {
    panelApp.get("*", async ({ params }) => {
      const subpath = params["*"];
      if (subpath) {
        const targetPath = join(panelDist, subpath);
        const file = Bun.file(targetPath);
        if (await file.exists()) {
          return file;
        }
      }
      return Bun.file(join(panelDist, "index.html"));
    });
  }

  panelApp.listen({ port: config.port, hostname: config.host });

  // Cetak banner terminal modern & rapi
  logger.printBanner({
    s3Port: config.s3Port,
    panelPort: config.port,
    host: config.host,
    dataDir: config.dataDir,
    oauthConfigured: oauth.isConfigured(),
    accountsCount,
    primaryEmail,
    balancingStrategy,
  });

  // 6. Background Sweeper (membersihkan multipart upload terbengkalai > 24 jam)
  const sweeper = setInterval(async () => {
    try {
      const swept = await s3Engine.sweepStaleMultipartUploads();
      if (swept > 0) {
        logger.info("sweeper", `Membersihkan ${swept} upload multipart yang kedaluwarsa`);
      }
    } catch (err) {
      logger.error("sweeper", "Gagal menjalankan pembersihan multipart", err);
    }
  }, 60 * 60 * 1000);

  // Graceful shutdown
  const shutdown = () => {
    console.log("");
    logger.info("system", "Mematikan server G3...");
    clearInterval(sweeper);
    s3App.stop();
    panelApp.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("fatal", "Gagal memulai server G3", err);
  process.exit(1);
});
