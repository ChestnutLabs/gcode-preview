/**
 * Test-only ZIP builder for the guard sweep. It builds a valid archive, then lets a test override
 * exactly one header field, so each guard is hit by a one-field mutation of an archive that is
 * otherwise accepted.
 *
 * The CRC here is an independent implementation (not the module's own), so a broken CRC in the
 * reader cannot hide behind a fixture built with the same broken CRC.
 */
import { deflateRawSync } from 'node:zlib';

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function refCrc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface HeaderFields {
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  name: string;
}

export interface BuildEntry {
  name: string;
  data: Uint8Array | string;
  deflate?: boolean;
  /** Replace the stored payload bytes (e.g. corrupt deflate data). */
  payload?: Uint8Array;
  local?: Partial<HeaderFields>;
  central?: Partial<HeaderFields> & { localHeaderOffset?: number };
}

export interface BuildOptions {
  eocd?: Partial<{ totalEntries: number; cdSize: number; cdOffset: number }>;
  /** Bytes placed between the central directory and the EOCD. */
  gapBeforeEocd?: Uint8Array;
  /** Extra raw bytes appended to the central directory (counted in cdSize). */
  cdTail?: Uint8Array;
}

export interface Built {
  bytes: Uint8Array;
  cdOffset: number;
  cdSize: number;
  eocdOffset: number;
  locals: { offset: number; dataStart: number }[];
}

const enc = new TextEncoder();
const bytesOf = (d: Uint8Array | string): Uint8Array => (typeof d === 'string' ? enc.encode(d) : d);

class W {
  private parts: number[] = [];
  u16(n: number): this {
    this.parts.push(n & 0xff, (n >>> 8) & 0xff);
    return this;
  }
  u32(n: number): this {
    this.parts.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
    return this;
  }
  raw(b: Uint8Array): this {
    for (const x of b) this.parts.push(x);
    return this;
  }
  get length(): number {
    return this.parts.length;
  }
  done(): Uint8Array {
    return Uint8Array.from(this.parts);
  }
}

export function buildZip(entries: BuildEntry[], opts: BuildOptions = {}): Built {
  const out = new W();
  const cd = new W();
  const locals: Built['locals'] = [];
  for (const e of entries) {
    const data = bytesOf(e.data);
    const comp = e.payload ?? (e.deflate ? new Uint8Array(deflateRawSync(data)) : data);
    const base: HeaderFields = {
      flags: 0,
      method: e.deflate ? 8 : 0,
      crc: refCrc32(data),
      compressedSize: comp.length,
      uncompressedSize: data.length,
      name: e.name
    };
    const l = { ...base, ...e.local };
    const c = { ...base, ...e.central };
    const offset = out.length;
    const lName = enc.encode(l.name);
    out
      .u32(0x04034b50)
      .u16(20)
      .u16(l.flags)
      .u16(l.method)
      .u16(0)
      .u16(0x2100)
      .u32(l.crc)
      .u32(l.compressedSize)
      .u32(l.uncompressedSize)
      .u16(lName.length)
      .u16(0)
      .raw(lName);
    const dataStart = out.length;
    out.raw(comp);
    locals.push({ offset, dataStart });
    const cName = enc.encode(c.name);
    cd.u32(0x02014b50)
      .u16(20)
      .u16(20)
      .u16(c.flags)
      .u16(c.method)
      .u16(0)
      .u16(0x2100)
      .u32(c.crc)
      .u32(c.compressedSize)
      .u32(c.uncompressedSize)
      .u16(cName.length)
      .u16(0)
      .u16(0)
      .u16(0)
      .u16(0)
      .u32(0)
      .u32(e.central?.localHeaderOffset ?? offset)
      .raw(cName);
  }
  if (opts.cdTail) cd.raw(opts.cdTail);
  const cdBytes = cd.done();
  const cdOffset = out.length;
  out.raw(cdBytes);
  if (opts.gapBeforeEocd) out.raw(opts.gapBeforeEocd);
  const eocdOffset = out.length;
  const total = opts.eocd?.totalEntries ?? entries.length;
  out
    .u32(0x06054b50)
    .u16(0)
    .u16(0)
    .u16(total & 0xffff)
    .u16(total & 0xffff)
    .u32(opts.eocd?.cdSize ?? cdBytes.length)
    .u32(opts.eocd?.cdOffset ?? cdOffset)
    .u16(0);
  return { bytes: out.done(), cdOffset, cdSize: cdBytes.length, eocdOffset, locals };
}

export function putU16(b: Uint8Array, o: number, n: number): void {
  b[o] = n & 0xff;
  b[o + 1] = (n >>> 8) & 0xff;
}

export function putU32(b: Uint8Array, o: number, n: number): void {
  b[o] = n & 0xff;
  b[o + 1] = (n >>> 8) & 0xff;
  b[o + 2] = (n >>> 16) & 0xff;
  b[o + 3] = (n >>> 24) & 0xff;
}
