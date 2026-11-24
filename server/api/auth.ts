import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { users, sessions } from "../db/schema";

export function createAuthRoutes(db: AppDatabase) {
  const router = new Elysia();

  // Login
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

  // Logout
  router.post("/auth/logout", async ({ cookie: { g3_session } }) => {
    const token = typeof g3_session.value === "string" ? g3_session.value : "";
    if (token) {
      db.delete(sessions).where(eq(sessions.token, token)).run();
      g3_session.remove();
    }
    return { success: true };
  });

  // Current User Session
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

  return router;
}
