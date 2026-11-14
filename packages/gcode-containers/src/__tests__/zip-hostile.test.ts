/**
 * Hostile-input sweep of the ZIP reader and the PNG header probe. Every expectation is a literal; archives
 * come from the test-only builder (independent CRC) or are hand-assembled byte by byte.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONTAINER_LIMITS, crc32, crc32Final, extractEntry, readDirectory, streamEntry } from '../zip.js';
import { readPngSize } from '../png.js';
import { buildZip, putU32 } from './zip-builder.js';

const enc = new TextEncoder();
const L = DEFAULT_CONTAINER_LIMITS;
afterEach(() => vi.unstubAllGlobals());

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code ?? `non-ContainerError:${String(e)}`;
  }
  return undefined;
}
const names = (b: Uint8Array): string[] => readDirectory(b, L).entries.map((e) => e.name);
const one = (extra: Parameters<typeof buildZip>[1] = {}) => buildZip([{ name: 'a.txt', data: 'x' }], extra);

describe('defaults and CRC32 (literals)', () => {
  it('DEFAULT_CONTAINER_LIMITS', () => {
    expect(DEFAULT_CONTAINER_LIMITS).toEqual({
      maxEntries: 4096,
      maxEntryNameBytes: 1024,
      maxExpandedBytesPerEntry: 536870912,
      maxExpandedBytesTotal: 1073741824,
      maxMetadataBytes: 8388608
    });
  });
  it('crc32 raw and final values for known inputs; the default seed is all-ones; chaining equals one pass', () => {
    expect(crc32(enc.encode('a'))).toBe(0x174841bc);
    expect(crc32(enc.encode('b'))).toBe(0x8e411006); // top bit set: must come back unsigned
    expect(crc32Final(crc32(enc.encode('123456789')))).toBe(0xcbf43926);
    expect(crc32Final(crc32(enc.encode('a')))).toBe(0xe8b7be43);
    expect(crc32Final(crc32(enc.encode('89'), crc32(enc.encode('1234567'))))).toBe(0xcbf43926);
  });
});

describe('end-of-central-directory search', () => {
  it('finds an EOCD under a 65,535 / 65,536 byte trailer; 65,537 is not found', () => {
    const base = one().bytes;
    const withTrail = (n: number) => {
      const z = new Uint8Array(base.length + n);
      z.set(base);
      return z;
    };
    expect(names(withTrail(65535))).toEqual(['a.txt']);
    expect(names(withTrail(65536))).toEqual(['a.txt']);
    expect(codeOf(() => readDirectory(withTrail(65537), L))).toBe('E_CONTAINER_FORMAT');
  });
  it('an EOCD signature needs a full 22 bytes: 22 → empty archive, 21 → not a ZIP, empty input → not a ZIP', () => {
    const z22 = new Uint8Array(22);
    putU32(z22, 0, 0x06054b50);
    expect(names(z22)).toEqual([]);
    const z21 = new Uint8Array(21);
    putU32(z21, 0, 0x06054b50);
    expect(codeOf(() => readDirectory(z21, L))).toBe('E_CONTAINER_FORMAT');
    expect(codeOf(() => readDirectory(new Uint8Array(0), L))).toBe('E_CONTAINER_FORMAT');
  });
  it('a fake EOCD planted in the trailing bytes wins (last signature) and fails as a malformed directory', () => {
    const real = one().bytes;
    const z = new Uint8Array(real.length + 22);
    z.set(real);
    putU32(z, real.length, 0x06054b50);
    z[real.length + 10] = 1; // total entries 1
    expect(() => readDirectory(z, L)).toThrow(/malformed central directory at entry 0/);
  });
});

describe('EOCD / central directory header claims', () => {
  it('entry count above the real count → malformed at the first missing entry', () => {
    expect(() => readDirectory(one({ eocd: { totalEntries: 3 } }).bytes, L)).toThrow(
      /malformed central directory at entry 1/
    );
  });
  it('entry count 0 reads an empty archive; count 4096 ok, 4097 → E_CONTAINER_LIMIT_ENTRIES', () => {
    expect(names(one({ eocd: { totalEntries: 0 } }).bytes)).toEqual([]);
    const many = (n: number) => buildZip(Array.from({ length: n }, (_, i) => ({ name: `f${i}`, data: '' }))).bytes;
    expect(names(many(4096)).length).toBe(4096);
    expect(codeOf(() => readDirectory(many(4097), L))).toBe('E_CONTAINER_LIMIT_ENTRIES');
  });
  it('central directory size/offset: too large → FORMAT; a size one short still reads (entries are counted, not sized)', () => {
    const b = one();
    expect(codeOf(() => readDirectory(one({ eocd: { cdSize: b.cdSize + 100 } }).bytes, L))).toBe('E_CONTAINER_FORMAT');
    expect(codeOf(() => readDirectory(one({ eocd: { cdOffset: b.bytes.length } }).bytes, L))).toBe(
      'E_CONTAINER_FORMAT'
    );
    expect(names(one({ eocd: { cdSize: b.cdSize - 1 } }).bytes)).toEqual(['a.txt']);
  });
  it('zip64: an 0xFFFF count, 0xFFFFFFFF offset/size, and a zip64 EOCD signature up to 76 bytes before the EOCD', () => {
    expect(codeOf(() => readDirectory(one({ eocd: { totalEntries: 0xffff } }).bytes, L))).toBe('E_CONTAINER_ZIP64');
    expect(codeOf(() => readDirectory(one({ eocd: { cdOffset: 0xffffffff } }).bytes, L))).toBe('E_CONTAINER_ZIP64');
    expect(codeOf(() => readDirectory(one({ eocd: { cdSize: 0xffffffff } }).bytes, L))).toBe('E_CONTAINER_ZIP64');
    const gap = (n: number) => {
      const g = new Uint8Array(n);
      putU32(g, 0, 0x06064b50);
      return one({ gapBeforeEocd: g }).bytes;
    };
    expect(codeOf(() => readDirectory(gap(76), L))).toBe('E_CONTAINER_ZIP64'); // 76 bytes before the EOCD
    expect(names(gap(77))).toEqual(['a.txt']); // 77 bytes before: outside the window
    expect(names(gap(80))).toEqual(['a.txt']);
  });
  it('zip64 entry fields (each of csize / usize / local offset = 0xFFFFFFFF) are rejected', () => {
    for (const patch of [
      { compressedSize: 0xffffffff },
      { uncompressedSize: 0xffffffff },
      { localHeaderOffset: 0xffffffff }
    ]) {
      const z = buildZip([{ name: 'a', data: 'x', central: patch }]).bytes;
      expect(codeOf(() => readDirectory(z, L))).toBe('E_CONTAINER_ZIP64');
    }
  });
  it('a local-header offset past the end → FORMAT on extract; a zero-byte deflate payload → INFLATE', async () => {
    const z = buildZip([{ name: 'a', data: 'x', central: { localHeaderOffset: 100000 } }]).bytes;
    const e = readDirectory(z, L).entries[0];
    await expect(extractEntry(z, e, 100)).rejects.toMatchObject({ code: 'E_CONTAINER_FORMAT' });
    const empty = buildZip([{ name: 'e', data: '', deflate: true, payload: new Uint8Array(0) }]).bytes;
    const ee = readDirectory(empty, L).entries[0];
    await expect(extractEntry(empty, ee, 100)).rejects.toMatchObject({ code: 'E_CONTAINER_INFLATE' });
  });
});

describe('names', () => {
  it('canonical-name duplicates: first wins, one warning; case and slash flavours fold together', () => {
    const d = readDirectory(
      buildZip([
        { name: 'a.txt', data: '1' },
        { name: 'A.TXT', data: '2' },
        { name: 'dir\\b.txt', data: '3' },
        { name: 'dir//B.txt', data: '4' }
      ]).bytes,
      L
    );
    expect(d.entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.txt']);
    expect(d.warnings.map((w) => w.code)).toEqual(['container-duplicate-entry', 'container-duplicate-entry']);
  });
  it('hostile names are dropped with a warning each; colons inside a name are fine', () => {
    const d = readDirectory(
      buildZip([
        { name: '../x', data: '1' },
        { name: 'C:evil', data: '1' },
        { name: 'a\\..\\b', data: '1' },
        { name: './y', data: '1' },
        { name: '/abs', data: '1' },
        { name: 'dir/file:name', data: '1' },
        { name: 'x/./y', data: '1' }
      ]).bytes,
      L
    );
    expect(d.entries.map((e) => e.name)).toEqual(['dir/file:name']);
    expect(d.warnings.map((w) => w.code)).toEqual(Array(6).fill('container-entry-hostile-name'));
  });
  it('a name of exactly maxEntryNameBytes is kept, one more is E_CONTAINER_LIMIT_NAME', () => {
    const lim = { ...L, maxEntryNameBytes: 8 };
    expect(readDirectory(buildZip([{ name: 'abcdefgh', data: '' }]).bytes, lim).entries.length).toBe(1);
    expect(codeOf(() => readDirectory(buildZip([{ name: 'abcdefghi', data: '' }]).bytes, lim))).toBe(
      'E_CONTAINER_LIMIT_NAME'
    );
  });
});

/** Hand-assembled two-entry archive: CD extra (3) + CD comment (5) on the first entry, local extra (4). */
function withExtras(): Uint8Array {
  const out: number[] = [];
  const u16 = (n: number) => out.push(n & 255, (n >>> 8) & 255);
  const u32 = (n: number) => out.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
  const raw = (b: ArrayLike<number>) => out.push(...Array.from(b));
  const local: number[] = [];
  const cd: number[] = [];
  const mk = (name: string, data: string, lExtra: number, cExtra: number, cComment: number) => {
    const off = out.length;
    const nm = enc.encode(name);
    const d = enc.encode(data);
    const crc = crc32Final(crc32(d));
    u32(0x04034b50);
    u16(20);
    u16(0);
    u16(0);
    u16(0);
    u16(0);
    u32(crc);
    u32(d.length);
    u32(d.length);
    u16(nm.length);
    u16(lExtra);
    raw(nm);
    raw(new Array(lExtra).fill(0x7a));
    raw(d);
    const c: number[] = [];
    const cu16 = (n: number) => c.push(n & 255, (n >>> 8) & 255);
    const cu32 = (n: number) => c.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);
    cu32(0x02014b50);
    cu16(20);
    cu16(20);
    cu16(0);
    cu16(0);
    cu16(0);
    cu16(0);
    cu32(crc);
    cu32(d.length);
    cu32(d.length);
    cu16(nm.length);
    cu16(cExtra);
    cu16(cComment);
    cu16(0);
    cu16(0);
    cu32(0);
    cu32(off);
    c.push(...nm, ...new Array(cExtra).fill(0x7b), ...new Array(cComment).fill(0x7c));
    cd.push(...c);
  };
  mk('first', 'one', 4, 3, 5);
  mk('second', 'two', 0, 0, 0);
  const cdOff = out.length;
  raw(cd);
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(2);
  u16(2);
  u32(cd.length);
  u32(cdOff);
  u16(0);
  void local;
  return Uint8Array.from(out);
}

describe('variable-length header parts', () => {
  it('central extra (3) + comment (5) and a local extra (4) are all skipped exactly', async () => {
    const z = withExtras();
    const d = readDirectory(z, L);
    expect(d.entries.map((e) => e.name)).toEqual(['first', 'second']);
    expect(dec(await extractEntry(z, d.entries[0], 100))).toBe('one');
    expect(dec(await extractEntry(z, d.entries[1], 100))).toBe('two');
  });
});
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('streaming', () => {
  it('a stored entry streams in 256 KiB chunks', async () => {
    const data = new Uint8Array(262144 + 1);
    const z = buildZip([{ name: 'big', data }]).bytes;
    const e = readDirectory(z, L).entries[0];
    const sizes: number[] = [];
    for await (const c of streamEntry(z, e, 1 << 20)) sizes.push(c.byteLength);
    expect(sizes).toEqual([262144, 1]);
  });
  it('an empty chunk from the inflater is never yielded', async () => {
    const z = buildZip([{ name: 'h', data: 'hello', deflate: true }]).bytes;
    const e = readDirectory(z, L).entries[0];
    vi.stubGlobal(
      'DecompressionStream',
      class {
        readable: ReadableStream<Uint8Array>;
        writable: WritableStream<Uint8Array>;
        constructor() {
          const ts = new TransformStream<Uint8Array, Uint8Array>({
            transform(_chunk, ctrl) {
              ctrl.enqueue(new Uint8Array(0));
              ctrl.enqueue(enc.encode('hello'));
            }
          });
          this.readable = ts.readable;
          this.writable = ts.writable;
        }
      }
    );
    const sizes: number[] = [];
    for await (const c of streamEntry(z, e, 100)) sizes.push(c.byteLength);
    expect(sizes).toEqual([5]);
  });
});

describe('readPngSize — IHDR claims', () => {
  const png = (w: number, h: number, len = 13, sig0 = 0x89): Uint8Array => {
    const b = new Uint8Array(24);
    b.set([sig0, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    new DataView(b.buffer).setUint32(8, len);
    b.set([0x49, 0x48, 0x44, 0x52], 12);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return b;
  };
  it('reads width then height (not swapped)', () => {
    expect(readPngSize(png(7, 9))).toEqual({ width: 7, height: 9 });
  });
  it('bounds: 1 and 2^31−1 accepted; 0 and 2^31 rejected, per axis', () => {
    expect(readPngSize(png(1, 2147483647))).toEqual({ width: 1, height: 2147483647 });
    expect(readPngSize(png(2147483647, 1))).toEqual({ width: 2147483647, height: 1 });
    for (const [w, h] of [
      [0, 5],
      [5, 0],
      [2147483648, 5],
      [5, 2147483648],
      [4294967295, 4294967295]
    ]) {
      expect(readPngSize(png(w, h))).toBeNull();
    }
  });
  it('rejects a short buffer (23 bytes), a wrong signature byte, a wrong IHDR length, and a wrong chunk name', () => {
    expect(readPngSize(png(1, 1).subarray(0, 23))).toBeNull();
    expect(readPngSize(png(1, 1, 13, 0x88))).toBeNull();
    expect(readPngSize(png(1, 1, 12))).toBeNull();
    const badName = png(1, 1);
    badName[15] = 0x53;
    expect(readPngSize(badName)).toBeNull();
    const badTail = png(1, 1);
    badTail[7] = 0x0b;
    expect(readPngSize(badTail)).toBeNull();
  });
  it('reads through a subarray view with a non-zero byteOffset', () => {
    const inner = png(3, 4);
    const holder = new Uint8Array(40);
    holder.set(inner, 10);
    expect(readPngSize(holder.subarray(10, 34))).toEqual({ width: 3, height: 4 });
  });
});
