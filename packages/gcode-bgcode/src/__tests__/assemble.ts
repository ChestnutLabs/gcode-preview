/**
 * TEST-ONLY `.bgcode` writer — clean-room from the format spec (not shipped; the package is
 * decode-only). Lets the phase-1 tests generate valid `.bgcode` fixtures (None/DEFLATE compression,
 * None encoding, ± CRC32) without PrusaSlicer and without touching any AGPL code. Real PrusaSlicer
 * files are added for golden-equivalence in phase 4.
 */
import { crc32, crc32Final } from '@chestnutlabs/gcode-containers';
import { BgcodeCompression, BgcodeBlockType } from '../bgcode.js';

export interface AssembleBlock {
  type: number;
  compression: number;
  /** Encoding u16 for GCode/metadata blocks (ignored for thumbnails). */
  encoding?: number;
  /** Thumbnail params (only when type === Thumbnail). */
  thumbnail?: { format: number; width: number; height: number };
  /** The uncompressed block payload. */
  data: Uint8Array;
}

export interface AssembleOptions {
  checksum?: 'none' | 'crc32';
  version?: number;
  magic?: string; // override for adversarial tests
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  const reader = cs.readable.getReader();
  const done = (async () => {
    await writer.write(data);
    await writer.close();
  })();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done: d, value } = await reader.read();
    if (d) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  await done;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

function pushU16(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >>> 8) & 0xff);
}
function pushU32(arr: number[], v: number): void {
  arr.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
}

/** Assemble a valid `.bgcode` v1 buffer from the given blocks. */
export async function assembleBgcode(blocks: AssembleBlock[], opts: AssembleOptions = {}): Promise<Uint8Array> {
  const checksum = opts.checksum ?? 'crc32';
  const out: number[] = [];
  // File header.
  const magic = opts.magic ?? 'GCDE';
  for (let i = 0; i < magic.length; i++) out.push(magic.charCodeAt(i) & 0xff);
  pushU32(out, opts.version ?? 1);
  pushU16(out, checksum === 'crc32' ? 1 : 0);

  for (const b of blocks) {
    const stored = b.compression === BgcodeCompression.Deflate ? await deflateRaw(b.data) : b.data;
    const block: number[] = [];
    pushU16(block, b.type);
    pushU16(block, b.compression);
    pushU32(block, b.data.length); // uncompressed size
    if (b.compression !== BgcodeCompression.None) pushU32(block, stored.length); // compressed size
    // Parameters.
    if (b.type === BgcodeBlockType.Thumbnail) {
      const t = b.thumbnail ?? { format: 0, width: 0, height: 0 };
      pushU16(block, t.format);
      pushU16(block, t.width);
      pushU16(block, t.height);
    } else {
      pushU16(block, b.encoding ?? 0);
    }
    // Data.
    for (const byte of stored) block.push(byte);
    // Per-block CRC over header + params + data.
    if (checksum === 'crc32') pushU32(block, crc32Final(crc32(Uint8Array.from(block))));
    for (const byte of block) out.push(byte);
  }
  return Uint8Array.from(out);
}
