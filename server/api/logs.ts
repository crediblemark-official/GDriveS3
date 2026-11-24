import { Elysia } from "elysia";
import { getLogs, clearLogs } from "../core/logger";

export function createLogsRoutes() {
  const router = new Elysia();

  router.get("/logs", ({ query }) => {
    const { service, level, q } = query as {
      service?: string;
      level?: string;
      q?: string;
    };
    return getLogs({ service, level, q });
  });

  router.delete("/logs", () => {
    clearLogs();
    return { success: true };
  });

  return router;
}
