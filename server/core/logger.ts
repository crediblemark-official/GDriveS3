/**
 * High-Precision Minimalist Terminal Logger for G3 Storage
 * Formats startup banners, request telemetry, and system events.
 */

// ANSI Styling Tokens
const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",

  // Foreground
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",

  // Bright
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightCyan: "\x1b[96m",
  brightRed: "\x1b[91m",
};

export interface BannerInfo {
  version?: string;
  s3Port: number;
  panelPort: number;
  host: string;
  dataDir: string;
  oauthConfigured: boolean;
  accountsCount?: number;
  primaryEmail?: string;
  balancingStrategy?: string;
}

function timestamp(): string {
  const now = new Date();
  return (
    ansi.gray +
    now.toTimeString().split(" ")[0] +
    ansi.reset
  );
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function padEndVisible(str: string, targetLen: number): string {
  const visible = stripAnsi(str).length;
  const padding = Math.max(0, targetLen - visible);
  return str + " ".repeat(padding);
}

function colorStatus(status: number): string {
  if (status >= 200 && status < 300) return `${ansi.brightGreen}${status}${ansi.reset}`;
  if (status >= 300 && status < 400) return `${ansi.cyan}${status}${ansi.reset}`;
  if (status >= 400 && status < 500) return `${ansi.yellow}${status}${ansi.reset}`;
  return `${ansi.brightRed}${status}${ansi.reset}`;
}

function colorMethod(method: string): string {
  const m = method.padEnd(6, " ");
  switch (method) {
    case "GET":
      return `${ansi.blue}${m}${ansi.reset}`;
    case "POST":
      return `${ansi.green}${m}${ansi.reset}`;
    case "PUT":
      return `${ansi.cyan}${m}${ansi.reset}`;
    case "DELETE":
      return `${ansi.red}${m}${ansi.reset}`;
    case "HEAD":
    case "OPTIONS":
      return `${ansi.gray}${m}${ansi.reset}`;
    default:
      return `${ansi.white}${m}${ansi.reset}`;
  }
}

function colorDuration(ms: number): string {
  const str = `${ms.toFixed(1)}ms`.padStart(7, " ");
  if (ms < 100) return `${ansi.dim}${str}${ansi.reset}`;
  if (ms < 500) return `${ansi.yellow}${str}${ansi.reset}`;
  return `${ansi.brightRed}${str}${ansi.reset}`;
}

export const logger = {
  info(service: string, msg: string) {
    console.log(`${timestamp()} ${ansi.cyan}[${service.padEnd(7, " ")}]${ansi.reset} ${msg}`);
  },

  success(service: string, msg: string) {
    console.log(`${timestamp()} ${ansi.green}[${service.padEnd(7, " ")}]${ansi.reset} ${ansi.bold}${msg}${ansi.reset}`);
  },

  warn(service: string, msg: string) {
    console.log(`${timestamp()} ${ansi.yellow}[${service.padEnd(7, " ")}]${ansi.reset} ${msg}`);
  },

  error(service: string, msg: string, err?: any) {
    console.error(
      `${timestamp()} ${ansi.brightRed}[${service.padEnd(7, " ")}] ERROR:${ansi.reset} ${msg}`,
      err ? err : ""
    );
  },

  printBanner(info: BannerInfo) {
    const s3Url = `http://${info.host === "0.0.0.0" ? "localhost" : info.host}:${info.s3Port}`;
    const panelUrl = `http://${info.host === "0.0.0.0" ? "localhost" : info.host}:${info.panelPort}`;
    const bunVer = `Bun ${Bun.version} (Linux)`;
    const appVer = info.version || "v1.0.0";

    const oauthStatus = info.oauthConfigured
      ? `${ansi.brightGreen}● Aktif${ansi.reset}${info.primaryEmail ? ` ${ansi.dim}(${info.primaryEmail})${ansi.reset}` : ""}`
      : `${ansi.yellow}○ Belum diatur${ansi.reset} ${ansi.dim}(atur G3_GOOGLE_* di .env)${ansi.reset}`;

    const poolStatus = info.accountsCount && info.accountsCount > 0
      ? `${ansi.brightGreen}${info.accountsCount} Akun Google${ansi.reset} ${ansi.dim}(${info.balancingStrategy || "Round Robin"})${ansi.reset}`
      : `${ansi.gray}0 Akun (Tautkan di Panel)${ansi.reset}`;

    const WIDTH = 52;
    const boxRow = (content: string) => `  ${ansi.gray}│${ansi.reset}  ${padEndVisible(content, WIDTH)}  ${ansi.gray}│${ansi.reset}`;

    const titleLeft = `${ansi.bold}${ansi.brightCyan}G3 Storage${ansi.reset} ${ansi.dim}${appVer}${ansi.reset}`;
    const titleRight = `${ansi.dim}${bunVer}${ansi.reset}`;
    const gap = Math.max(1, WIDTH - stripAnsi(titleLeft).length - stripAnsi(titleRight).length);

    console.log("");
    console.log(`  ${ansi.gray}┌${"─".repeat(WIDTH + 4)}┐${ansi.reset}`);
    console.log(boxRow(`${titleLeft}${" ".repeat(gap)}${titleRight}`));
    console.log(boxRow(`${ansi.dim}S3-Compatible Object Storage over Google Drive${ansi.reset}`));
    console.log(`  ${ansi.gray}├${"─".repeat(WIDTH + 4)}┤${ansi.reset}`);
    console.log(boxRow(""));
    console.log(boxRow(`${ansi.cyan}➜${ansi.reset}  ${ansi.bold}S3 Gateway:${ansi.reset}   ${ansi.brightGreen}${s3Url}${ansi.reset}`));
    console.log(boxRow(`${ansi.cyan}➜${ansi.reset}  ${ansi.bold}Web Panel:${ansi.reset}    ${ansi.brightCyan}${panelUrl}${ansi.reset}`));
    console.log(boxRow(""));
    console.log(boxRow(`${ansi.dim}•  OAuth:${ansi.reset}        ${oauthStatus}`));
    console.log(boxRow(`${ansi.dim}•  Storage Pool:${ansi.reset} ${poolStatus}`));
    console.log(boxRow(`${ansi.dim}•  Database:${ansi.reset}     ${ansi.dim}SQLite (${info.dataDir}/g3.db)${ansi.reset}`));
    console.log(boxRow(`${ansi.dim}•  Sweeper:${ansi.reset}      ${ansi.dim}Multipart cleanup aktif (tiap 1 jam)${ansi.reset}`));
    console.log(boxRow(""));
    console.log(`  ${ansi.gray}└${"─".repeat(WIDTH + 4)}┘${ansi.reset}`);
    console.log("");
  },
};

/**
 * Creates Elysia Request Logger Plugin
 */
export function createHttpLogger(serviceName: "s3" | "api" | "panel") {
  const requestTimers = new WeakMap<Request, number>();

  const serviceTag = serviceName === "s3"
    ? `${ansi.cyan}[s3]   ${ansi.reset}`
    : serviceName === "api"
    ? `${ansi.magenta}[api]  ${ansi.reset}`
    : `${ansi.gray}[panel]${ansi.reset}`;

  return (app: any) =>
    app
      .onRequest(({ request }: any) => {
        requestTimers.set(request, performance.now());
      })
      .onAfterResponse(({ request, set }: any) => {
        const url = new URL(request.url);
        const path = url.pathname;

        // Skip static asset spam in panel to keep terminal clean and high-signal
        if (
          path.startsWith("/assets/") ||
          path.endsWith(".ico") ||
          path.endsWith(".png") ||
          path.endsWith(".jpg") ||
          path.endsWith(".svg") ||
          path.endsWith(".map")
        ) {
          return;
        }

        const t0 = requestTimers.get(request) || performance.now();
        requestTimers.delete(request);
        const duration = performance.now() - t0;

        const method = colorMethod(request.method);
        const status = colorStatus(set.status || 200);
        const dur = colorDuration(duration);

        console.log(
          `${timestamp()} ${serviceTag} ${method} ${path.padEnd(32, " ")} ${status} ${dur}`
        );
      });
}
