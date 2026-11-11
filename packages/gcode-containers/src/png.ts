/**
 * Internal PNG header probe (#483) — NOT exported from the package. Reads the pixel size from the
 * mandatory first chunk (IHDR) with explicit bounds checks and no regex. It validates the header only; it
 * never decodes pixels, so a bad IDAT stream is the image consumer's problem, exactly as for comment thumbnails.
 */

/** The 8-byte PNG file signature. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** "IHDR". */
const IHDR = [0x49, 0x48, 0x44, 0x52];
/** Signature (8) + length (4) + "IHDR" (4) + width (4) + height (4). */
const MIN_HEADER_BYTES = 24;
/** The PNG spec caps each dimension at 2^31 - 1. */
const MAX_DIMENSION = 0x7fffffff;

/** `{width, height}` of a PNG, or `null` when the bytes are not a PNG with a sane IHDR (never throws). */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.byteLength < MIN_HEADER_BYTES) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  for (let i = 0; i < IHDR.length; i++) {
    if (bytes[12 + i] !== IHDR[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || width > MAX_DIMENSION || height < 1 || height > MAX_DIMENSION) return null;
  return { width, height };
}
