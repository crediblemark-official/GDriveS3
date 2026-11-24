import { describe, it, expect } from "bun:test";
import {
  isOptimizableImage,
  calculateTargetDimensions,
  replaceExtensionWithWebp,
  optimizeImageFile,
} from "../panel/src/lib/imageOptimizer";

describe("Client-side Image Optimizer", () => {
  it("should identify optimizable raster images and skip SVG/GIF/non-images", () => {
    expect(isOptimizableImage(new File(["x"], "photo.jpg", { type: "image/jpeg" }))).toBe(true);
    expect(isOptimizableImage(new File(["x"], "shot.png", { type: "image/png" }))).toBe(true);
    expect(isOptimizableImage(new File(["x"], "logo.svg", { type: "image/svg+xml" }))).toBe(false);
    expect(isOptimizableImage(new File(["x"], "anim.gif", { type: "image/gif" }))).toBe(false);
    expect(isOptimizableImage(new File(["x"], "doc.pdf", { type: "application/pdf" }))).toBe(false);
  });

  it("should preserve aspect ratio when resizing down and keep smaller images untouched", () => {
    expect(calculateTargetDimensions(3840, 2160, 1920)).toEqual({
      width: 1920,
      height: 1080,
      resized: true,
    });
    expect(calculateTargetDimensions(800, 600, 1920)).toEqual({
      width: 800,
      height: 600,
      resized: false,
    });
    expect(calculateTargetDimensions(3840, 2160, 0)).toEqual({
      width: 3840,
      height: 2160,
      resized: false,
    });
  });

  it("should replace filename extension with .webp cleanly", () => {
    expect(replaceExtensionWithWebp("vacation.png")).toBe("vacation.webp");
    expect(replaceExtensionWithWebp("archive.tar.jpg")).toBe("archive.tar.webp");
    expect(replaceExtensionWithWebp("noext")).toBe("noext.webp");
  });

  it("should pass through original file untouched when optimization is disabled", async () => {
    const orig = new File(["raw-bytes"], "photo.png", { type: "image/png" });
    const res = await optimizeImageFile(orig, {
      enabled: false,
      maxWidth: 1920,
      quality: 0.85,
      toWebp: true,
    });
    expect(res.optimized).toBe(false);
    expect(res.file).toBe(orig);
    expect(res.savedBytes).toBe(0);
  });
});
