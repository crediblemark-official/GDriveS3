import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { s3AccessKeys } from "../db/schema";
import type { TokenCipher } from "../core/crypto";

function parseAllowedBuckets(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

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
      permissions: k.permissions || "read_write",
      allowedBuckets: parseAllowedBuckets(k.allowedBuckets),
      createdAt: k.createdAt,
    }));
  });

  // Create Access Key
  router.post("/keys", async ({ body, set }) => {
    const {
      label,
      permissions = "read_write",
      allowedBuckets = null,
    } = (body as {
      label?: string;
      permissions?: string;
      allowedBuckets?: string[] | null;
    }) || {};

    if (permissions !== "read_write" && permissions !== "read_only") {
      set.status = 400;
      return { error: "Permissions harus 'read_write' atau 'read_only'" };
    }

    const normalizedBuckets = Array.isArray(allowedBuckets)
      ? Array.from(new Set(allowedBuckets.map((b) => String(b).trim()).filter(Boolean)))
      : [];
    const allowedBucketsJson = normalizedBuckets.length > 0 ? JSON.stringify(normalizedBuckets) : null;

    const rawKey = new Uint8Array(16);
    const rawSecret = new Uint8Array(32);
    crypto.getRandomValues(rawKey);
    crypto.getRandomValues(rawSecret);

    const accessKeyId = "GDS3" + Buffer.from(rawKey).toString("hex").toUpperCase();
    const secretKey = Buffer.from(rawSecret).toString("base64url");
    const secretHash = await cipher.encrypt(secretKey);

    const newKey = {
      id: crypto.randomUUID(),
      accessKeyId,
      secretHash,
      label: label || "Default Key",
      permissions,
      allowedBuckets: allowedBucketsJson,
      createdAt: new Date().toISOString(),
    };
    db.insert(s3AccessKeys).values(newKey).run();

    return {
      id: newKey.id,
      accessKeyId,
      secretKey, // Ditampilkan satu kali saja saat dibuat
      label: newKey.label,
      permissions: newKey.permissions,
      allowedBuckets: normalizedBuckets.length > 0 ? normalizedBuckets : null,
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
