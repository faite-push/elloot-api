import sharp from "sharp";
import { AppError } from "../../lib/errors";
import { env } from "../../config/env";

export const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** Magic-byte sniffing (do not trust Content-Type alone). */
export function sniffImageMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  // WEBP (RIFF....WEBP)
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export type ProcessedImage = {
  buffer: Buffer;
  mimeType: "image/jpeg" | "image/webp" | "image/png";
  width: number;
  height: number;
  extension: "jpg" | "webp" | "png";
};

/**
 * Validates + normalizes uploads:
 * - Rejects SVG/HTML polyglots via magic bytes
 * - Strips EXIF / metadata
 * - Auto-rotates
 * - Caps dimensions
 * - Re-encodes to safe formats
 */
export async function processImageUpload(
  input: Buffer,
  opts?: { maxEdge?: number; preferWebp?: boolean },
): Promise<ProcessedImage> {
  if (input.byteLength <= 0) {
    throw new AppError(400, "Empty file", "MEDIA_EMPTY");
  }
  if (input.byteLength > env.MEDIA_MAX_BYTES) {
    throw new AppError(
      413,
      `File too large (max ${env.MEDIA_MAX_BYTES} bytes)`,
      "MEDIA_TOO_LARGE",
    );
  }

  const sniffed = sniffImageMime(input);
  if (!sniffed || !ALLOWED_IMAGE_MIME.has(sniffed)) {
    throw new AppError(
      415,
      "Only JPEG, PNG and WebP images are allowed",
      "MEDIA_UNSUPPORTED_TYPE",
    );
  }

  const maxEdge = opts?.maxEdge ?? 2048;
  const preferWebp = opts?.preferWebp ?? true;

  let pipeline = sharp(input, {
    failOn: "error",
    animated: false,
    limitInputPixels: 40_000_000,
  }).rotate();

  const meta = await pipeline.metadata();
  if (!meta.width || !meta.height) {
    throw new AppError(400, "Invalid image", "MEDIA_INVALID_IMAGE");
  }

  pipeline = sharp(input, {
    failOn: "error",
    animated: false,
    limitInputPixels: 40_000_000,
  })
    .rotate()
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    });

  if (preferWebp) {
    const buffer = await pipeline.webp({ quality: 82, effort: 4 }).toBuffer();
    const out = await sharp(buffer).metadata();
    return {
      buffer,
      mimeType: "image/webp",
      width: out.width ?? meta.width,
      height: out.height ?? meta.height,
      extension: "webp",
    };
  }

  if (sniffed === "image/png") {
    const buffer = await pipeline.png({ compressionLevel: 9 }).toBuffer();
    const out = await sharp(buffer).metadata();
    return {
      buffer,
      mimeType: "image/png",
      width: out.width ?? meta.width,
      height: out.height ?? meta.height,
      extension: "png",
    };
  }

  const buffer = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  const out = await sharp(buffer).metadata();
  return {
    buffer,
    mimeType: "image/jpeg",
    width: out.width ?? meta.width,
    height: out.height ?? meta.height,
    extension: "jpg",
  };
}

export function sanitizeOriginalName(name: string | undefined) {
  if (!name) return null;
  const base = name.replace(/[/\\]/g, "").slice(0, 180);
  return base || null;
}
