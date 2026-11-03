/**
 * Packet 2 sweep (G1): execute every bound and integrity guard in zip.ts with a crafted input that
 * is a one-field mutation of an otherwise valid archive. Each limit is checked at the exact
 * boundary (at the limit passes, one past throws). Codes and message fragments are literal.
 */
import { describe, expect, it } from 'vitest';
import {
  ContainerError,
  DEFAULT_CONTAINER_LIMITS,
  canonicalName,
  extractEntry,
  locatePayload,
  readDirectory,
  streamEntry,
  type ZipEntry
} from '../index';
import { buildZip, putU16, putU32, refCrc32, type BuildEntry } from './zip-builder';

const L = DEFAULT_CONTAINER_LIMITS;
const enc = new TextEncoder();

function syncErr(fn: () => unknown): ContainerError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ContainerError);
    return e as ContainerError;
  }
  throw new Error('expected a ContainerError, nothing was thrown');
}

async function asyncErr(fn: () => Promise<unknown>): Promise<ContainerError> {
  try {
    await fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ContainerError);
    return e as ContainerError;
  }
  throw new Error('expected a ContainerError, nothing was thrown');
}

async function drain(bytes: Uint8Array, entry: ZipEntry, cap: number): Promise<number> {
  let n = 0;
  for await (const c of streamEntry(bytes, entry, cap)) n += c.byteLength;
  return n;
}

const one = (e: Partial<BuildEntry> = {}, opts = {}) => buildZip([{ name: 'a.txt', data: 'hello world', ...e }], opts);
const entryOf = (bytes: Uint8Array): ZipEntry => readDirectory(bytes, L).entries[0];

/** A hand-made entry for calling locatePayload/streamEntry directly on raw bytes. */
const rawEntry = (over: Partial<ZipEntry> = {}): ZipEntry => ({
  name: 'e',
  rawName: '',
  method: 0,
  compressedSize: 0,
  uncompressedSize: 0,
  crc32: 0,
  localHeaderOffset: 0,
  flags: 0,
  ...over
});

describe('canonicalName', () => {
  it.each([
    ['a\0b', null],
    ['', null],
    ['/abs/x', null],
    ['\\abs\\x', null],
    ['C:x', null],
    ['c:/win/x', null],
    ['../x', null],
    ['a/../b', null],
    ['./x', null],
    ['a/./b', null],
    ['a//b', 'a/b'],
    ['Metadata\\Plate_1.GCODE', 'metadata/plate_1.gcode'],
    ['a/b/', 'a/b']
  ])('%j → %j', (raw, expected) => {
    expect(canonicalName(raw)).toBe(expected);
  });
});

describe('readDirectory guards', () => {
  it('accepts the valid base archive', () => {
    const dir = readDirectory(one().bytes, L);
    expect(dir.entries.map((e) => e.name)).toEqual(['a.txt']);
    expect(dir.warnings).toEqual([]);
  });

  it('no EOCD → E_CONTAINER_FORMAT', () => {
    const e = syncErr(() => readDirectory(enc.encode('not a zip at all, just some text bytes'), L));
    expect(e.code).toBe('E_CONTAINER_FORMAT');
    expect(e.message).toContain('no end-of-central-directory');
  });

  it.each([
    ['totalEntries 0xFFFF', 10, 0xffff, 16],
    ['cdSize 0xFFFFFFFF', 12, 0xffffffff, 32],
    ['cdOffset 0xFFFFFFFF', 16, 0xffffffff, 32]
  ])('EOCD zip64 sentinel %s → E_CONTAINER_ZIP64', (_label, off, value, width) => {
    const b = one();
    if (width === 16) putU16(b.bytes, b.eocdOffset + off, value);
    else putU32(b.bytes, b.eocdOffset + off, value);
    const e = syncErr(() => readDirectory(b.bytes, L));
    expect(e.code).toBe('E_CONTAINER_ZIP64');
    expect(e.message).toBe('zip64 archives are not supported (v1 scope)');
  });

  it('zip64 EOCD signature inside the 76-byte window → E_CONTAINER_ZIP64; just outside → ignored', () => {
    // Window is [eocd-76, eocd). Signature at eocd-76 is the first byte inside it.
    const inside = new Uint8Array(76);
    putU32(inside, 0, 0x06064b50);
    const e = syncErr(() => readDirectory(one({}, { gapBeforeEocd: inside }).bytes, L));
    expect(e.code).toBe('E_CONTAINER_ZIP64');
    // At eocd-77 the signature is one byte outside the window.
    const outside = new Uint8Array(77);
    putU32(outside, 0, 0x06064b50);
    expect(readDirectory(one({}, { gapBeforeEocd: outside }).bytes, L).entries.length).toBe(1);
    // A signature whose last byte sits right before the EOCD is still inside.
    const last = new Uint8Array(4);
    putU32(last, 0, 0x06064b50);
    expect(syncErr(() => readDirectory(one({}, { gapBeforeEocd: last }).bytes, L)).code).toBe('E_CONTAINER_ZIP64');
  });

  it('maxEntries: at the limit passes, one over → E_CONTAINER_LIMIT_ENTRIES', () => {
    const b = buildZip([
      { name: 'a', data: 'x' },
      { name: 'b', data: 'y' }
    ]).bytes;
    expect(readDirectory(b, { ...L, maxEntries: 2 }).entries.length).toBe(2);
    const e = syncErr(() => readDirectory(b, { ...L, maxEntries: 1 }));
    expect(e.code).toBe('E_CONTAINER_LIMIT_ENTRIES');
    expect(e.message).toBe('archive has 2 entries (> 1)');
  });

  it('central directory past the archive: ending exactly at EOF passes, one byte past → E_CONTAINER_FORMAT', () => {
    const b = one();
    // cdSize is only bounds-checked, never used for parsing, so it can be stretched to EOF.
    putU32(b.bytes, b.eocdOffset + 12, b.bytes.length - b.cdOffset);
    expect(readDirectory(b.bytes, L).entries.length).toBe(1);
    putU32(b.bytes, b.eocdOffset + 12, b.bytes.length - b.cdOffset + 1);
    const e = syncErr(() => readDirectory(b.bytes, L));
    expect(e.code).toBe('E_CONTAINER_FORMAT');
    expect(e.message).toBe('central directory extends past the archive');
  });

  it('cdOffset past EOF → E_CONTAINER_FORMAT', () => {
    const b = one();
    putU32(b.bytes, b.eocdOffset + 16, b.bytes.length + 100);
    expect(syncErr(() => readDirectory(b.bytes, L)).message).toBe('central directory extends past the archive');
  });

  it('malformed CD: bad record signature → E_CONTAINER_FORMAT', () => {
    const b = one();
    putU32(b.bytes, b.cdOffset, 0x12345678);
    const e = syncErr(() => readDirectory(b.bytes, L));
    expect(e.code).toBe('E_CONTAINER_FORMAT');
    expect(e.message).toBe('malformed central directory at entry 0');
  });

  it('malformed CD: a record signature with fewer than 46 bytes left → E_CONTAINER_FORMAT', () => {
    const tail = new Uint8Array(4);
    putU32(tail, 0, 0x02014b50);
    const b = one({}, { cdTail: tail, eocd: { totalEntries: 2 } });
    const e = syncErr(() => readDirectory(b.bytes, L));
    expect(e.code).toBe('E_CONTAINER_FORMAT');
    expect(e.message).toBe('malformed central directory at entry 1');
  });

  it('a CD record that ends exactly at EOF is still parsed (bound is >, not >=)', () => {
    // 46 bytes: one CD record whose last 22 bytes double as the EOCD.
    const b = new Uint8Array(46);
    putU32(b, 0, 0x02014b50);
    putU32(b, 24, 0x06054b50); // EOCD signature = the record's uncompressedSize field
    putU16(b, 34, 1); // EOCD totalEntries
    putU32(b, 36, 46); // EOCD cdSize
    putU32(b, 40, 0); // EOCD cdOffset
    const dir = readDirectory(b, L);
    expect(dir.entries).toEqual([]);
    expect(dir.warnings.map((w) => w.code)).toEqual(['container-entry-hostile-name']);
  });

  it('maxEntryNameBytes: at the limit passes, one over → E_CONTAINER_LIMIT_NAME', () => {
    const b = buildZip([{ name: 'abcdefghij', data: 'x' }]).bytes; // 10 bytes
    expect(readDirectory(b, { ...L, maxEntryNameBytes: 10 }).entries[0].name).toBe('abcdefghij');
    const e = syncErr(() => readDirectory(b, { ...L, maxEntryNameBytes: 9 }));
    expect(e.code).toBe('E_CONTAINER_LIMIT_NAME');
    expect(e.message).toBe('entry name of 10 B (> 9)');
  });

  it.each([
    ['compressedSize', { compressedSize: 0xffffffff }],
    ['uncompressedSize', { uncompressedSize: 0xffffffff }],
    ['localHeaderOffset', { localHeaderOffset: 0xffffffff }]
  ])('CD zip64 sentinel in %s → E_CONTAINER_ZIP64', (_label, central) => {
    const e = syncErr(() => readDirectory(one({ central }).bytes, L));
    expect(e.code).toBe('E_CONTAINER_ZIP64');
    expect(e.message).toBe('zip64 entry fields are not supported (v1 scope)');
  });

  it('directory entries are skipped; empty and NUL names are rejected with a warning', () => {
    const b = buildZip([
      { name: 'dir/', data: '' },
      { name: '', data: 'x' },
      { name: 'a\0b', data: 'y' },
      { name: 'ok.txt', data: 'z' }
    ]).bytes;
    const dir = readDirectory(b, L);
    expect(dir.entries.map((e) => e.name)).toEqual(['ok.txt']);
    expect(dir.warnings).toEqual([
      { code: 'container-entry-hostile-name', message: 'entry name rejected: ""' },
      { code: 'container-entry-hostile-name', message: 'entry name rejected: "a\\u0000b"' }
    ]);
  });

  it('non-payload duplicate canonical names: first wins, warned', () => {
    const b = buildZip([
      { name: 'Notes.txt', data: 'first' },
      { name: 'notes.TXT', data: 'second' }
    ]).bytes;
    const dir = readDirectory(b, L);
    expect(dir.entries.map((e) => e.rawName)).toEqual(['Notes.txt']);
    expect(dir.warnings).toEqual([
      { code: 'container-duplicate-entry', message: "duplicate canonical name 'notes.txt' (first wins)" }
    ]);
  });
});

describe('locatePayload guards', () => {
  it('returns the data offset for a valid entry', () => {
    const b = one();
    expect(locatePayload(b.bytes, entryOf(b.bytes))).toBe(b.locals[0].dataStart);
  });

  it('bad local signature → E_CONTAINER_FORMAT', () => {
    const b = one();
    putU32(b.bytes, 0, 0xdeadbeef);
    const e = syncErr(() => locatePayload(b.bytes, entryOf(b.bytes)));
    expect(e.code).toBe('E_CONTAINER_FORMAT');
    expect(e.message).toBe("bad local header for 'a.txt'");
  });

  it('local header bound: ending exactly at EOF passes, one byte short → E_CONTAINER_FORMAT', () => {
    const header = new Uint8Array(30);
    putU32(header, 0, 0x04034b50);
    expect(locatePayload(header, rawEntry())).toBe(30);
    const e = syncErr(() => locatePayload(header.subarray(0, 29), rawEntry()));
    expect(e.code).toBe('E_CONTAINER_FORMAT');
    expect(e.message).toBe("bad local header for 'e'");
    expect(syncErr(() => locatePayload(header, rawEntry({ localHeaderOffset: 1 }))).message).toBe(
      "bad local header for 'e'"
    );
  });

  it.each([
    ['local flag only', { local: { flags: 0x1 } }],
    ['central flag only', { central: { flags: 0x1 } }]
  ])('encrypted (%s) → E_CONTAINER_ENCRYPTED', (_label, over) => {
    const b = one(over).bytes;
    const e = syncErr(() => locatePayload(b, entryOf(b)));
    expect(e.code).toBe('E_CONTAINER_ENCRYPTED');
    expect(e.message).toBe("entry 'a.txt' is encrypted — no decryption path exists");
  });

  it.each([
    ['method', { local: { method: 8 } }],
    ['name', { local: { name: 'b.txt' } }]
  ])('central/local %s disagreement → E_CONTAINER_HEADER_MISMATCH', (_label, over) => {
    const b = one(over).bytes;
    const e = syncErr(() => locatePayload(b, entryOf(b)));
    expect(e.code).toBe('E_CONTAINER_HEADER_MISMATCH');
    expect(e.message).toBe("central/local header disagreement for 'a.txt' — treating the entry as hostile");
  });

  it.each([
    ['crc', { local: { crc: 1 } }],
    ['compressedSize', { local: { compressedSize: 1 } }],
    ['uncompressedSize', { local: { uncompressedSize: 1 } }]
  ])('central/local %s disagreement → E_CONTAINER_HEADER_MISMATCH', (_label, over) => {
    const b = one(over).bytes;
    const e = syncErr(() => locatePayload(b, entryOf(b)));
    expect(e.code).toBe('E_CONTAINER_HEADER_MISMATCH');
    expect(e.message).toBe("central/local size/CRC disagreement for 'a.txt' — treating the entry as hostile");
  });

  it('data-descriptor flag 0x8: zeroed local sizes/CRC are accepted, payload extracts intact', async () => {
    const b = one({ local: { flags: 0x8, crc: 0, compressedSize: 0, uncompressedSize: 0 } }).bytes;
    const entry = entryOf(b);
    expect(new TextDecoder().decode(await extractEntry(b, entry, 1024))).toBe('hello world');
  });

  it('payload bound: ending exactly at EOF passes, one byte past → E_CONTAINER_FORMAT', () => {
    const b = new Uint8Array(35);
    putU32(b, 0, 0x04034b50);
    putU16(b, 6, 0x8); // data descriptor: local sizes are not compared
    expect(locatePayload(b, rawEntry({ compressedSize: 5 }))).toBe(30);
    const e = syncErr(() => locatePayload(b, rawEntry({ compressedSize: 6 })));
    expect(e.code).toBe('E_CONTAINER_FORMAT');
    expect(e.message).toBe("entry 'e' payload extends past the archive");
  });
});

describe('streamEntry guards', () => {
  it('claimed size: at the cap passes, one over → E_CONTAINER_LIMIT_EXPANDED (before any output)', async () => {
    const b = one({ data: 'x'.repeat(100) }).bytes;
    const entry = entryOf(b);
    expect(await drain(b, entry, 100)).toBe(100);
    const e = await asyncErr(() => drain(b, entry, 99));
    expect(e.code).toBe('E_CONTAINER_LIMIT_EXPANDED');
    expect(e.message).toBe("entry 'a.txt' claims 100 B (> cap 99)");
  });

  it('stored entry with compressed ≠ uncompressed → E_CONTAINER_HEADER_MISMATCH', async () => {
    const both = { uncompressedSize: 12 };
    const b = one({ local: both, central: both }).bytes; // 11 stored bytes, claims 12
    const e = await asyncErr(() => drain(b, entryOf(b), 1024));
    expect(e.code).toBe('E_CONTAINER_HEADER_MISMATCH');
    expect(e.message).toBe("stored entry 'a.txt' size disagreement");
  });

  it('unsupported method 12 → E_CONTAINER_METHOD', async () => {
    const both = { method: 12 };
    const b = one({ local: both, central: both }).bytes;
    const e = await asyncErr(() => drain(b, entryOf(b), 1024));
    expect(e.code).toBe('E_CONTAINER_METHOD');
    expect(e.message).toBe("entry 'a.txt' uses unsupported method 12");
  });

  it('deflate output past the cap with a lying header: at the cap passes, one over → E_CONTAINER_LIMIT_EXPANDED', async () => {
    const lie = { uncompressedSize: 10 }; // real output is 200 bytes
    const b = one({ data: 'A'.repeat(200), deflate: true, local: lie, central: lie }).bytes;
    const entry = entryOf(b);
    expect(await drain(b, entry, 200)).toBe(200);
    const e = await asyncErr(() => drain(b, entry, 199));
    expect(e.code).toBe('E_CONTAINER_LIMIT_EXPANDED');
    expect(e.message).toBe("entry 'a.txt' expanded past 199 B — headers lied; extraction stopped");
  });

  it('corrupt deflate data → E_CONTAINER_INFLATE', async () => {
    const payload = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const b = one({ deflate: true, payload }).bytes;
    const e = await asyncErr(() => drain(b, entryOf(b), 1024));
    expect(e.code).toBe('E_CONTAINER_INFLATE');
    expect(e.message).toContain("inflate failed for 'a.txt'");
  });
});

describe('extractEntry integrity checks', () => {
  it.each([
    ['stored', false],
    ['deflate', true]
  ])('valid %s entry → exact bytes', async (_label, deflate) => {
    const b = one({ data: 'hello world', deflate }).bytes;
    expect(new TextDecoder().decode(await extractEntry(b, entryOf(b), 1024))).toBe('hello world');
  });

  it.each([
    ['stored', false],
    ['deflate', true]
  ])('%s entry whose headers agree on a wrong CRC → E_CONTAINER_CRC', async (_label, deflate) => {
    const bad = { crc: (refCrc32(enc.encode('hello world')) ^ 1) >>> 0 };
    const b = one({ deflate, local: bad, central: bad }).bytes;
    const e = await asyncErr(() => extractEntry(b, entryOf(b), 1024));
    expect(e.code).toBe('E_CONTAINER_CRC');
    expect(e.message).toBe("CRC mismatch for 'a.txt'");
  });

  it.each([
    ['smaller', 10],
    ['larger', 12]
  ])('deflate entry with the real CRC but a %s claimed size → E_CONTAINER_HEADER_MISMATCH', async (_l, claim) => {
    const lie = { uncompressedSize: claim }; // real size is 11
    const b = one({ deflate: true, local: lie, central: lie }).bytes;
    const e = await asyncErr(() => extractEntry(b, entryOf(b), 1024));
    expect(e.code).toBe('E_CONTAINER_HEADER_MISMATCH');
    expect(e.message).toBe("expanded size of 'a.txt' differs from headers");
  });

  it('multi-chunk deflate entry (> 256 KiB) extracts and verifies', async () => {
    const data = new Uint8Array(600 * 1024);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31 + (i >>> 9)) & 0xff;
    const b = buildZip([{ name: 'big.bin', data, deflate: true }]).bytes;
    const out = await extractEntry(b, entryOf(b), data.length);
    expect(out.length).toBe(data.length);
    expect(refCrc32(out)).toBe(refCrc32(data));
  });
});
