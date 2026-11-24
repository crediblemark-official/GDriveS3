import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { s3AccessKeys } from "../db/schema";
import type { TokenCipher } from "../core/crypto";

export function createKeysRoutes(
  db: AppDatabase,
  cipher: TokenCipher
) {
  const router = new Elysia();

  // List S3 Access Keys
  router.get("/keys", async () => {
    const list = db.select().from(s3AccessKeys).all();
    return list.map((k) => ({
      id: k.id,
      accessKeyId: k.accessKeyId,
      label: k.label,
      createdAt: k.createdAt,
    }));
  });

  // Create Access Key
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
      secretKey, // Ditampilkan satu kali saja saat dibuat
      label: newKey.label,
      createdAt: newKey.createdAt,
    };
  });

  // Delete Access Key
  router.delete("/keys/:id", async ({ params }) => {
    db.delete(s3AccessKeys).where(eq(s3AccessKeys.id, params.id)).run();
    return { success: true };
  });

  return router;
}
