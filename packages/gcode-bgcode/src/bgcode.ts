/**
 * Binary G-code (`.bgcode`) decoder — spec **version 1** (DD-011; format audited in RR-003).
 *
 * Clean-room from the published Prusa block-format spec — NO code is derived from the AGPL
 * `libbgcode` reference or the AGPL OctoPrint-MeatPack (RR-003 §6). In-memory only, no fs/net.
 *
 * `.bgcode` is a *container* of ordinary G-code: this walks the block structure, verifies per-block
 * CRC32, decompresses, decodes, and concatenates the GCode blocks into a plain-G-code buffer the
 * existing parser consumes unchanged. **Decode-only** — never writes `.bgcode`.
 *
 * Phase 1 (this file) implements the walker + CRC + **None/DEFLATE** compression and **None**
 * encoding. MeatPack (encoding) and heatshrink (compression) are honest, structured "not yet
 * supported" errors until phases 2 and 3.
 */
import { ContainerError, crc32, crc32Final } from '@chestnutlabs/gcode-containers';
import { meatpackDecode } from './meatpack.js';
import { heatshrinkDecode } from './heatshrink.js';

/** ASCII magic at the start of every `.bgcode` file: "GCDE". */
export const BGCODE_MAGIC = 'GCDE';
/** The only file format version this decoder accepts (DD-011 pins v1). */
export const BGCODE_VERSION = 1;

/** Block type IDs (spec §5.2). */
export const BgcodeBlockType = {
  FileMetadata: 0,
  GCode: 1,
  SlicerMetadata: 2,
  PrinterMetadata: 3,
  PrintMetadata: 4,
  Thumbnail: 5
} as const;

/** Compression algorithm IDs (spec §5.2). */
export const BgcodeCompression = {
  None: 0,
  Deflate: 1,
  Heatshrink11: 2, // window 11, lookahead 4
  Heatshrink12: 3 // window 12, lookahead 4
} as const;

/** GCode-block encoding IDs (spec §5.2). */
export const BgcodeEncoding = {
  None: 0,
  MeatPack: 1,
  MeatPackComments: 2
} as const;

/** Metadata read off a walked block header (no payload for non-GCode blocks in phase 1). */
export interface BgcodeBlockInfo {
  type: number;
  compression: number;
  /** GCode/metadata encoding param; 0 for thumbnails. */
  encoding: number;
  uncompressedSize: number;
  compressedSize: number;
}

export interface BgcodeDecodeResult {
  /** The decoded plain G-code (all GCode blocks concatenated in file order). */
  gcode: Uint8Array;
  /** Every block walked, in file order (for diagnostics / phase-4 metadata). */
  blocks: BgcodeBlockInfo[];
  /** Whether the file declared per-block CRC32. */
  checksum: 'none' | 'crc32';
}

export interface BgcodeDecodeOptions {
  /** Hard cap on total decoded G-code bytes — decompression-bomb defense (default 512 MiB). */
  maxOutputBytes?: number;
}

const DEFAULT_MAX_OUTPUT = 512 * 1024 * 1024;

function readU16(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function readU32(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

/** True if `prefix`/`name` look like a `.bgcode` file (magic "GCDE", or a `.bgcode` name). */
export function sniffBgcode(prefix: Uint8Array, name?: string): boolean {
  if (name !== undefined && /\.bgcode$/i.test(name)) return true;
  return (
    prefix.length >= 4 &&
    prefix[0] === 0x47 /* G */ &&
    prefix[1] === 0x43 /* C */ &&
    prefix[2] === 0x44 /* D */ &&
    prefix[3] === 0x45 /* E */
  );
}

/** DEFLATE-decode `data` to at most `limit` bytes via the platform stream (bounded — bomb-safe). */
async function inflate(data: Uint8Array, expected: number, limit: number): Promise<Uint8Array> {
  // Flavor: zlib-wrapped DEFLATE. Confirmed against a real Prusa XL `.bgcode` (phase 4) — its
  // DEFLATE metadata blocks decode with the zlib header, and fail as raw. (bgcode GCode blocks use
  // heatshrink, not DEFLATE; only Slicer/Print metadata blocks are DEFLATE.)
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  // The writer promise must never float unobserved: a corrupt stream errors BOTH ends, and an
  // unawaited writer rejection crashes the process (the #131 fuzzer lesson from gcode-containers).
  let writeError: unknown;
  const writeAll = (async () => {
    await writer.write(data);
    await writer.close();
  })().catch((e: unknown) => {
    writeError = e;
  });
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined && value.byteLength > 0) {
        total += value.byteLength;
        if (total > expected || total > limit) {
          throw new ContainerError('E_BGCODE_BOMB', `deflate output exceeds the declared/limit size (${total})`);
        }
        chunks.push(value);
      }
    }
    await writeAll;
    if (writeError !== undefined) throw writeError;
  } catch (err) {
    await writeAll; // settled by construction; never rejects
    if (err instanceof ContainerError) throw err;
    throw new ContainerError('E_BGCODE_INFLATE', `deflate failed: ${err instanceof Error ? err.message : err}`);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/** Decompress one block's data by its compression ID, clamped to the declared/limit size. */
async function decompress(
  compression: number,
  data: Uint8Array,
  uncompressed: number,
  limit: number
): Promise<Uint8Array> {
  if (compression === BgcodeCompression.None) {
    if (data.length !== uncompressed) {
      throw new ContainerError('E_BGCODE_SIZE', `stored block size disagreement (${data.length} vs ${uncompressed})`);
    }
    return data;
  }
  if (compression === BgcodeCompression.Deflate) {
    const out = await inflate(data, uncompressed, limit);
    if (out.length !== uncompressed) {
      throw new ContainerError('E_BGCODE_SIZE', `deflate size disagreement (${out.length} vs ${uncompressed})`);
    }
    return out;
  }
  if (compression === BgcodeCompression.Heatshrink11 || compression === BgcodeCompression.Heatshrink12) {
    const windowBits = compression === BgcodeCompression.Heatshrink11 ? 11 : 12;
    const out = heatshrinkDecode(data, windowBits, 4, limit);
    if (out.length !== uncompressed) {
      throw new ContainerError('E_BGCODE_SIZE', `heatshrink size disagreement (${out.length} vs ${uncompressed})`);
    }
    return out;
  }
  throw new ContainerError('E_BGCODE_UNSUPPORTED_COMPRESSION', `unknown compression id ${compression}`);
}

/** Decode a GCode block's post-decompression bytes by its encoding ID, bounded to `limit` output bytes. */
function decode(encoding: number, bytes: Uint8Array, limit: number): Uint8Array {
  if (encoding === BgcodeEncoding.None) return bytes;
  // Both MeatPack variants decode identically — comment stripping is an encoder choice (#188 phase 2).
  if (encoding === BgcodeEncoding.MeatPack || encoding === BgcodeEncoding.MeatPackComments) {
    return meatpackDecode(bytes, limit);
  }
  throw new ContainerError('E_BGCODE_UNSUPPORTED_ENCODING', `unknown gcode encoding id ${encoding}`);
}

/**
 * Decode a `.bgcode` v1 buffer to plain G-code. Walks every block, verifies per-block CRC32 (when the
 * file declares it), decompresses + decodes the GCode blocks, and concatenates them in file order.
 * Non-GCode blocks are walked past (their metadata/thumbnails are surfaced in phase 4). Every failure
 * is a structured, bounded `ContainerError` (from `@chestnutlabs/gcode-containers`) — never a crash or
 * an unbounded read/allocation.
 */
export async function openBgcode(bytes: Uint8Array, opts: BgcodeDecodeOptions = {}): Promise<BgcodeDecodeResult> {
  const limit = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
  const len = bytes.length;
  if (len < 10) throw new ContainerError('E_BGCODE_TRUNCATED', 'file shorter than the 10-byte header');
  if (!sniffBgcode(bytes)) throw new ContainerError('E_BGCODE_MAGIC', 'missing "GCDE" magic');
  const version = readU32(bytes, 4);
  if (version !== BGCODE_VERSION)
    throw new ContainerError('E_BGCODE_VERSION', `unsupported file version ${version} (expected 1)`);
  const checksumType = readU16(bytes, 8);
  if (checksumType > 1) throw new ContainerError('E_BGCODE_CHECKSUM', `unknown checksum type ${checksumType}`);
  const hasCrc = checksumType === 1;

  const blocks: BgcodeBlockInfo[] = [];
  const gcodeParts: Uint8Array[] = [];
  let totalOut = 0;
  let off = 10;

  while (off < len) {
    const blockStart = off;
    if (off + 8 > len) throw new ContainerError('E_BGCODE_TRUNCATED', 'truncated block header');
    const type = readU16(bytes, off);
    const compression = readU16(bytes, off + 2);
    const uncompressedSize = readU32(bytes, off + 4);
    off += 8;

    let compressedSize = uncompressedSize;
    if (compression !== BgcodeCompression.None) {
      if (off + 4 > len) throw new ContainerError('E_BGCODE_TRUNCATED', 'truncated block header (compressed size)');
      compressedSize = readU32(bytes, off);
      off += 4;
    }

    // Block parameters: 2 bytes (encoding u16) for metadata/GCode; 6 bytes (format+w+h) for thumbnails.
    const paramLen = type === BgcodeBlockType.Thumbnail ? 6 : 2;
    if (off + paramLen > len) throw new ContainerError('E_BGCODE_TRUNCATED', 'truncated block parameters');
    const encoding = type === BgcodeBlockType.Thumbnail ? 0 : readU16(bytes, off);
    off += paramLen;

    const dataLen = compression === BgcodeCompression.None ? uncompressedSize : compressedSize;
    if (off + dataLen > len) throw new ContainerError('E_BGCODE_TRUNCATED', 'truncated block data');
    const data = bytes.subarray(off, off + dataLen);
    off += dataLen;

    if (hasCrc) {
      if (off + 4 > len) throw new ContainerError('E_BGCODE_TRUNCATED', 'truncated block checksum');
      const stored = readU32(bytes, off);
      const calc = crc32Final(crc32(bytes.subarray(blockStart, off))); // over header + params + data
      if (stored !== calc) {
        throw new ContainerError('E_BGCODE_CRC', `block CRC32 mismatch at offset ${blockStart}`);
      }
      off += 4;
    }

    blocks.push({ type, compression, encoding, uncompressedSize, compressedSize });

    if (type === BgcodeBlockType.GCode) {
      const decompressed = await decompress(compression, data, uncompressedSize, limit - totalOut);
      const decoded = decode(encoding, decompressed, limit - totalOut);
      totalOut += decoded.length;
      if (totalOut > limit)
        throw new ContainerError('E_BGCODE_BOMB', `decoded G-code exceeds the output limit (${totalOut})`);
      gcodeParts.push(decoded);
    }
    // Metadata / thumbnail blocks are walked past here; surfaced via the sink in phase 4.
  }

  const gcode = new Uint8Array(totalOut);
  let o = 0;
  for (const part of gcodeParts) {
    gcode.set(part, o);
    o += part.length;
  }
  return { gcode, blocks, checksum: hasCrc ? 'crc32' : 'none' };
}
