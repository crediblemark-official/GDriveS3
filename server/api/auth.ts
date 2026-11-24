import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client";
import { users, sessions } from "../db/schema";

export function createAuthRoutes(db: AppDatabase) {
  const router = new Elysia();

  // Login
  router.post("/auth/login", async ({ body, cookie: { gdrives3_session }, request, set }) => {
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
    const isHttps =
      new URL(request.url).protocol === "https:" ||
      request.headers.get("x-forwarded-proto") === "https" ||
      process.env.GDRIVES3_COOKIE_SECURE === "true";

    db.insert(sessions).values({
      id: crypto.randomUUID(),
      userId: user.id,
      token,
      expiresAt,
      createdAt: new Date().toISOString(),
    }).run();

    gdrives3_session.set({
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: isHttps,
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        mustChangePassword: Boolean(user.mustChangePassword),
      },
    };
  });

  // Logout
  router.post("/auth/logout", async ({ cookie: { gdrives3_session } }) => {
    const token = typeof gdrives3_session.value === "string" ? gdrives3_session.value : "";
    if (token) {
      db.delete(sessions).where(eq(sessions.token, token)).run();
      gdrives3_session.remove();
    }
    return { success: true };
  });

  // Current User Session
  router.get("/me", async ({ cookie: { gdrives3_session }, set }) => {
    const token = typeof gdrives3_session.value === "string" ? gdrives3_session.value : "";
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
        mustChangePassword: Boolean(user.mustChangePassword),
      },
    };
  });

  // Change Password
  router.post("/auth/change-password", async ({ body, cookie: { gdrives3_session }, set }) => {
    const token = typeof gdrives3_session.value === "string" ? gdrives3_session.value : "";
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

    const { currentPassword, newPassword } = body as {
      currentPassword?: string;
      newPassword?: string;
    };
    if (!currentPassword || !newPassword) {
      set.status = 400;
      return { error: "Password lama dan baru wajib diisi" };
    }
    if (newPassword.length < 8) {
      set.status = 400;
      return { error: "Password baru minimal 8 karakter" };
    }
    if (!Bun.password.verifySync(currentPassword, user.passwordHash)) {
      set.status = 400;
      return { error: "Password lama tidak sesuai" };
    }

    db.update(users)
      .set({
        passwordHash: Bun.password.hashSync(newPassword),
        mustChangePassword: 0,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, user.id))
      .run();

    return { success: true };
  });

  return router;
}
