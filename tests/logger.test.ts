import { describe, it, expect } from "bun:test";
import { logger, createHttpLogger } from "../server/core/logger";
import { Elysia } from "elysia";

describe("Terminal Logger Telemetry", () => {
  it("should render startup banner without errors", () => {
    expect(() => {
      logger.printBanner({
        version: "v1.0.0",
        s3Port: 9000,
        panelPort: 8787,
        host: "0.0.0.0",
        dataDir: "./g3-data",
        oauthConfigured: true,
        accountsCount: 1,
        primaryEmail: "info.rasyiqi@gmail.com",
        balancingStrategy: "Round Robin",
      });
    }).not.toThrow();
  });

  it("should log request telemetry cleanly through Elysia middleware", async () => {
    let logged = false;
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      const line = args.join(" ");
      if (line.includes("[s3]") && line.includes("/test-object")) {
        logged = true;
      }
      originalLog(...args);
    };

    try {
      const app = new Elysia()
        .use(createHttpLogger("s3"))
        .get("/test-object", () => "hello");

      const res = await app.handle(new Request("http://localhost/test-object"));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello");
      await new Promise((r) => setTimeout(r, 50));
      expect(logged).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  it("should skip static asset logging to prevent terminal flooding", async () => {
    let loggedStatic = false;
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      const line = args.join(" ");
      if (line.includes("/assets/index.js")) {
        loggedStatic = true;
      }
      originalLog(...args);
    };

    try {
      const app = new Elysia()
        .use(createHttpLogger("panel"))
        .get("/assets/index.js", () => "console.log('chunk');");

      await app.handle(new Request("http://localhost/assets/index.js"));
      expect(loggedStatic).toBe(false);
    } finally {
      console.log = originalLog;
    }
  });
});
