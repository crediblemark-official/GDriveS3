import { describe, it, expect } from "bun:test";
import { formatBytes } from "../panel/src/lib/format";

describe("formatBytes Utility", () => {
  it("should format 0 and negative bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(null as any)).toBe("0 B");
  });

  it("should format bytes, KB, MB, GB, and TB correctly", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1536 * 1024)).toBe("1.5 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
    expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe("1 TB");
  });
});
