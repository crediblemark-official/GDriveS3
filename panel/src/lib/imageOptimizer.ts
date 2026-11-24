export interface ImageOptimizeOptions {
  enabled: boolean;
  maxWidth: number; // 0 = original dimensions
  quality: number;  // 0.1 - 1.0
  toWebp: boolean;
}

export interface ImageOptimizeResult {
  file: File;
  optimized: boolean;
  originalSize: number;
  optimizedSize: number;
  savedBytes: number;
}

const SKIP_MIMES = new Set(["image/svg+xml", "image/gif"]);

export function isOptimizableImage(file: File): boolean {
  return file.type.startsWith("image/") && !SKIP_MIMES.has(file.type);
}

export function calculateTargetDimensions(
  width: number,
  height: number,
  maxWidth: number
): { width: number; height: number; resized: boolean } {
  if (!maxWidth || maxWidth <= 0 || width <= maxWidth) {
    return { width, height, resized: false };
  }
  const ratio = maxWidth / width;
  return {
    width: maxWidth,
    height: Math.max(1, Math.round(height * ratio)),
    resized: true,
  };
}

export function replaceExtensionWithWebp(filename: string): string {
  const dotIdx = filename.lastIndexOf(".");
  if (dotIdx <= 0) return `${filename}.webp`;
  return `${filename.slice(0, dotIdx)}.webp`;
}

export async function optimizeImageFile(
  file: File,
  options: ImageOptimizeOptions
): Promise<ImageOptimizeResult> {
  if (!options.enabled || !isOptimizableImage(file)) {
    return {
      file,
      optimized: false,
      originalSize: file.size,
      optimizedSize: file.size,
      savedBytes: 0,
    };
  }

  const bitmap = await createImageBitmap(file);
  try {
    const dims = calculateTargetDimensions(bitmap.width, bitmap.height, options.maxWidth);
    const canvas = document.createElement("canvas");
    canvas.width = dims.width;
    canvas.height = dims.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return {
        file,
        optimized: false,
        originalSize: file.size,
        optimizedSize: file.size,
        savedBytes: 0,
      };
    }

    ctx.drawImage(bitmap, 0, 0, dims.width, dims.height);

    const targetMime = options.toWebp ? "image/webp" : file.type;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), targetMime, options.quality)
    );

    if (!blob) {
      return {
        file,
        optimized: false,
        originalSize: file.size,
        optimizedSize: file.size,
        savedBytes: 0,
      };
    }

    // Never inflate file size when dimensions were not resized
    if (!dims.resized && blob.size >= file.size) {
      return {
        file,
        optimized: false,
        originalSize: file.size,
        optimizedSize: file.size,
        savedBytes: 0,
      };
    }

    const nextName = options.toWebp ? replaceExtensionWithWebp(file.name) : file.name;
    const optimizedFile = new File([blob], nextName, {
      type: targetMime,
      lastModified: Date.now(),
    });

    return {
      file: optimizedFile,
      optimized: true,
      originalSize: file.size,
      optimizedSize: optimizedFile.size,
      savedBytes: Math.max(0, file.size - optimizedFile.size),
    };
  } finally {
    bitmap.close();
  }
}
