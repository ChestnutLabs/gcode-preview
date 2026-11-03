/**
 * Packet 2 sweep (G2): EXECUTE every security guard in the `.bgcode` decoder with a crafted input that
 * hits it exactly, and pin the boundary (at the cap → passes, one byte over → throws). Every assertion
 * uses LITERAL codes, messages and limits — never the module's own constants — so a mutant that loosens a
 * compare, swaps a code or deletes a throw goes red. Mutation results: F:/ab-scratch/g2/p2-bgcode/.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deflateSync } from 'node:zlib';
import { ContainerError } from '@chestnutlabs/gcode-containers';
import { heatshrinkDecode, meatpackDecode, openBgcode, openBgcodeContainer } from '../index.js';
import { assembleBgcode, type AssembleBlock } from './assemble.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const A = (n: number): Uint8Array => new Uint8Array(n).fill(0x41); // n × 'A'
const zlibOf = (b: Uint8Array): Uint8Array => new Uint8Array(deflateSync(b));

// Literal block ids (spec §5.2) — deliberately not the module's constants.
const GCODE = 1;
const PRINTER_META = 3;
const THUMB = 5;
const NONE = 0;
const DEFLATE = 1;
const HS11 = 2;

/** A GCode block. `stored`+`declared` override the payload (for size lies / pre-built streams). */
function gblock(
  compression: number,
  data: Uint8Array,
  extra: { encoding?: number; stored?: Uint8Array; declared?: number } = {}
): AssembleBlock {
  return {
    type: GCODE,
    compression,
    encoding: extra.encoding ?? 0,
    data,
    preCompressed:
      extra.stored !== undefined ? { stored: extra.stored, uncompressedSize: extra.declared ?? data.length } : undefined
  };
}

/** Await `p` and return the ContainerError it rejects with (fails the test on success or another type). */
async function rejection(p: Promise<unknown>): Promise<ContainerError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ContainerError);
    return e as ContainerError;
  }
  throw new Error('expected a ContainerError, but the call resolved');
}

function syncRejection(fn: () => unknown): ContainerError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ContainerError);
    return e as ContainerError;
  }
  throw new Error('expected a ContainerError, but the call returned');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DEFLATE output cap (bgcode inflate :151 — both clauses)', () => {
  const stream100 = zlibOf(A(100));

  it('inflating to exactly the declared size and exactly the limit passes', async () => {
    const f = await assembleBgcode([gblock(DEFLATE, A(100), { stored: stream100, declared: 100 })]);
    const r = await openBgcode(f, { maxOutputBytes: 100 });
    expect(r.gcode.length).toBe(100);
    expect(dec(r.gcode)).toBe('A'.repeat(100));
  });

  it('inflating past the DECLARED size throws E_BGCODE_BOMB (declared 99, real 100)', async () => {
    const f = await assembleBgcode([gblock(DEFLATE, A(100), { stored: stream100, declared: 99 })]);
    const e = await rejection(openBgcode(f));
    expect(e.code).toBe('E_BGCODE_BOMB');
    expect(e.message).toBe('deflate output exceeds the declared/limit size (100)');
  });

  it('inflating past the LIMIT throws E_BGCODE_BOMB inside inflate (limit 99, declared 100)', async () => {
    const f = await assembleBgcode([gblock(DEFLATE, A(100), { stored: stream100, declared: 100 })]);
    const e = await rejection(openBgcode(f, { maxOutputBytes: 99 }));
    expect(e.code).toBe('E_BGCODE_BOMB');
    // The inflate cap fires first — not the later aggregate G-code cap.
    expect(e.message).toBe('deflate output exceeds the declared/limit size (100)');
  });

  it('inflating SHORT of the declared size throws E_BGCODE_SIZE (deflate :188)', async () => {
    const f = await assembleBgcode([gblock(DEFLATE, A(100), { stored: stream100, declared: 101 })]);
    const e = await rejection(openBgcode(f));
    expect(e.code).toBe('E_BGCODE_SIZE');
    expect(e.message).toBe('deflate size disagreement (100 vs 101)');
  });

  it('a truncated zlib stream throws E_BGCODE_INFLATE', async () => {
    const cut = stream100.subarray(0, stream100.length - 2);
    const f = await assembleBgcode([gblock(DEFLATE, A(100), { stored: cut, declared: 100 })]);
    const e = await rejection(openBgcode(f));
    expect(e.code).toBe('E_BGCODE_INFLATE');
    expect(e.message.startsWith('deflate failed: ')).toBe(true);
  });

  it('trailing junk after the zlib stream throws E_BGCODE_INFLATE', async () => {
    const junk = Uint8Array.from([...stream100, 1, 2, 3]);
    const f = await assembleBgcode([gblock(DEFLATE, A(100), { stored: junk, declared: 100 })]);
    const e = await rejection(openBgcode(f));
    expect(e.code).toBe('E_BGCODE_INFLATE');
    expect(e.message.startsWith('deflate failed: ')).toBe(true);
  });

  it('a writer-side failure after a clean read end is still surfaced as E_BGCODE_INFLATE (:158)', async () => {
    // A platform stream whose readable ends normally with the full declared output while the writable
    // rejects (seen on some engines for trailing-data errors). The writer error must not be dropped.
    class FakeDecompressionStream {
      writable = {
        getWriter: () => ({
          write: () => Promise.reject(new Error('writer exploded')),
          close: () => Promise.resolve()
        })
      };
      readable = {
        getReader: () => {
          let sent = false;
          return {
            read: () =>
              Promise.resolve(sent ? { done: true, value: undefined } : ((sent = true), { done: false, value: A(4) }))
          };
        }
      };
    }
    vi.stubGlobal('DecompressionStream', FakeDecompressionStream);
    const f = await assembleBgcode([gblock(DEFLATE, A(4), { stored: Uint8Array.of(0), declared: 4 })]);
    const e = await rejection(openBgcode(f));
    expect(e.code).toBe('E_BGCODE_INFLATE');
    expect(e.message).toBe('deflate failed: writer exploded');
  });
});

describe('decompress / decode dispatch guards', () => {
  it('heatshrink output short of the declared size throws E_BGCODE_SIZE (:196)', async () => {
    // One literal token 'A' (tag 1 + 0x41), MSB-first: 1 0100 0001 → 0xA0 0x80.
    const f = await assembleBgcode([gblock(HS11, enc('A'), { stored: Uint8Array.of(0xa0, 0x80), declared: 2 })]);
    const e = await rejection(openBgcode(f));
    expect(e.code).toBe('E_BGCODE_SIZE');
    expect(e.message).toBe('heatshrink size disagreement (1 vs 2)');
  });

  it('an unknown compression id throws E_BGCODE_UNSUPPORTED_COMPRESSION', async () => {
    const f = await assembleBgcode([gblock(4, enc('G1'), { stored: enc('G1'), declared: 2 })]);
    const e = await rejection(openBgcode(f));
    expect(e.code).toBe('E_BGCODE_UNSUPPORTED_COMPRESSION');
    expect(e.message).toBe('unknown compression id 4');
  });

  it('an unknown gcode encoding id throws E_BGCODE_UNSUPPORTED_ENCODING', async () => {
    const f = await assembleBgcode([gblock(NONE, enc('G1'), { encoding: 3 })]);
    const e = await rejection(openBgcode(f));
    expect(e.code).toBe('E_BGCODE_UNSUPPORTED_ENCODING');
    expect(e.message).toBe('unknown gcode encoding id 3');
  });
});

describe('file header + block walker guards', () => {
  const g = (): Promise<Uint8Array> => assembleBgcode([gblock(NONE, enc('G1 X1\n'))], { checksum: 'none' });

  it('checksum type 2 throws E_BGCODE_CHECKSUM; types 0 and 1 are accepted', async () => {
    const f = await g();
    expect((await openBgcode(f)).checksum).toBe('none');
    const crc = await assembleBgcode([gblock(NONE, enc('G1 X1\n'))], { checksum: 'crc32' });
    expect((await openBgcode(crc)).checksum).toBe('crc32');
    const bad = f.slice();
    bad[8] = 2;
    const e = await rejection(openBgcode(bad));
    expect(e.code).toBe('E_BGCODE_CHECKSUM');
    expect(e.message).toBe('unknown checksum type 2');
  });

  it('fewer than 8 bytes of block header → "truncated block header"', async () => {
    const f = await g();
    const e = await rejection(openBgcode(f.subarray(0, 10 + 7)));
    expect(e.code).toBe('E_BGCODE_TRUNCATED');
    expect(e.message).toBe('truncated block header');
  });

  it('a compressed block cut inside its compressed-size field → "(compressed size)"', async () => {
    const f = await assembleBgcode([gblock(DEFLATE, enc('G1 X1\n'))], { checksum: 'none' });
    const e = await rejection(openBgcode(f.subarray(0, 10 + 8 + 3)));
    expect(e.code).toBe('E_BGCODE_TRUNCATED');
    expect(e.message).toBe('truncated block header (compressed size)');
  });

  it('a block cut inside its 2-byte parameters → "truncated block parameters"', async () => {
    const f = await g();
    const e = await rejection(openBgcode(f.subarray(0, 10 + 8 + 1)));
    expect(e.code).toBe('E_BGCODE_TRUNCATED');
    expect(e.message).toBe('truncated block parameters');
  });

  it('a thumbnail cut inside its 6-byte parameters → "truncated block parameters"', async () => {
    const f = await assembleBgcode(
      [{ type: THUMB, compression: NONE, thumbnail: { format: 0, width: 1, height: 1 }, data: A(4) }],
      { checksum: 'none' }
    );
    const e = await rejection(openBgcode(f.subarray(0, 10 + 8 + 5)));
    expect(e.code).toBe('E_BGCODE_TRUNCATED');
    expect(e.message).toBe('truncated block parameters');
  });

  it('data one byte short → "truncated block data"; exactly to EOF parses', async () => {
    const f = await g();
    expect(dec((await openBgcode(f)).gcode)).toBe('G1 X1\n');
    const e = await rejection(openBgcode(f.subarray(0, f.length - 1)));
    expect(e.code).toBe('E_BGCODE_TRUNCATED');
    expect(e.message).toBe('truncated block data');
  });

  it('a CRC cut short → "truncated block checksum"; a CRC ending exactly at EOF parses', async () => {
    const f = await assembleBgcode([gblock(NONE, enc('G1 X1\n'))], { checksum: 'crc32' });
    expect(dec((await openBgcode(f)).gcode)).toBe('G1 X1\n');
    const e = await rejection(openBgcode(f.subarray(0, f.length - 2)));
    expect(e.code).toBe('E_BGCODE_TRUNCATED');
    expect(e.message).toBe('truncated block checksum');
  });

  it('a flipped data byte throws E_BGCODE_CRC with the block offset', async () => {
    const f = (await assembleBgcode([gblock(NONE, enc('G1 X1\n'))], { checksum: 'crc32' })).slice();
    f[10 + 8 + 2] ^= 0x01; // first data byte
    const e = await rejection(openBgcode(f));
    expect(e.code).toBe('E_BGCODE_CRC');
    expect(e.message).toBe('block CRC32 mismatch at offset 10');
  });
});

describe('aggregate decoded G-code cap (bgcode :287)', () => {
  // Two uncompressed, unencoded blocks: nothing upstream caps them, so this is the only bound.
  const two = (): Promise<Uint8Array> => assembleBgcode([gblock(NONE, A(60)), gblock(NONE, A(40))]);

  it('a total of exactly maxOutputBytes passes', async () => {
    const r = await openBgcode(await two(), { maxOutputBytes: 100 });
    expect(r.gcode.length).toBe(100);
  });

  it('one byte over maxOutputBytes throws E_BGCODE_BOMB', async () => {
    const e = await rejection(openBgcode(await two(), { maxOutputBytes: 99 }));
    expect(e.code).toBe('E_BGCODE_BOMB');
    expect(e.message).toBe('decoded G-code exceeds the output limit (100)');
  });
});

describe('MeatPack guards', () => {
  const HEADER = [0xff, 0xff, 0xfb];

  it('output cap: exactly at the limit passes, one over throws E_BGCODE_BOMB (:60)', () => {
    const raw = enc('abc'); // stream starts disabled → literal pass-through
    expect(dec(meatpackDecode(raw, 3))).toBe('abc');
    const e = syncRejection(() => meatpackDecode(raw, 2));
    expect(e.code).toBe('E_BGCODE_BOMB');
    expect(e.message).toBe('MeatPack output exceeds the limit (2)');
  });

  it('a packed stream that expands 2× fills the buffer exactly without overflow', () => {
    // 40 packed "00" bytes → 80 chars; a 2× expansion is the worst case the buffer is sized for.
    const packed = Uint8Array.from([...HEADER, ...new Array<number>(40).fill(0x00)]);
    expect(dec(meatpackDecode(packed, 1 << 20))).toBe('0'.repeat(80));
    expect(dec(meatpackDecode(packed, 80))).toBe('0'.repeat(80));
    expect(syncRejection(() => meatpackDecode(packed, 79)).code).toBe('E_BGCODE_BOMB');
  });

  it('the cap holds end-to-end through openBgcode (MeatPack-encoded block)', async () => {
    const block = gblock(NONE, Uint8Array.from([...HEADER, 0x1d, 0xeb, 0xa2, 0xc5]), { encoding: 1 }); // "G1 X2.5\n"
    const f = await assembleBgcode([block]);
    expect(dec((await openBgcode(f, { maxOutputBytes: 8 })).gcode)).toBe('G1 X2.5\n');
    const e = await rejection(openBgcode(f, { maxOutputBytes: 7 }));
    expect(e.code).toBe('E_BGCODE_BOMB');
    expect(e.message).toBe('MeatPack output exceeds the limit (7)');
  });

  it('a third 0xFF (FF FF FF) is an invalid state (:77)', () => {
    const e = syncRejection(() => meatpackDecode(Uint8Array.of(0xff, 0xff, 0xff), 1024));
    expect(e.code).toBe('E_BGCODE_MEATPACK');
    expect(e.message).toBe('invalid MeatPack state at byte 2');
  });

  it('0xFF where a right full-width literal is due is an invalid state', () => {
    const e = syncRejection(() => meatpackDecode(Uint8Array.from([...HEADER, 0xfd, 0xff]), 1024));
    expect(e.code).toBe('E_BGCODE_MEATPACK');
    expect(e.message).toBe('invalid MeatPack state at byte 4');
  });

  it('0xFF where a left full-width literal is due is an invalid state', () => {
    const e = syncRejection(() => meatpackDecode(Uint8Array.from([...HEADER, 0xdf, 0xff]), 1024));
    expect(e.code).toBe('E_BGCODE_MEATPACK');
    expect(e.message).toBe('invalid MeatPack state at byte 4');
  });

  it('an unknown command byte after FF FF throws E_BGCODE_MEATPACK (:132)', () => {
    const e = syncRejection(() => meatpackDecode(Uint8Array.of(0xff, 0xff, 0x00), 1024));
    expect(e.code).toBe('E_BGCODE_MEATPACK');
    expect(e.message).toBe('invalid MeatPack command 0 at byte 2');
  });
});

describe('heatshrink output cap (:31)', () => {
  // 'A','B' literals: 1 0100 0001 1 0100 0010 → 0xA0 0xD0 0x80.
  const AB = Uint8Array.of(0xa0, 0xd0, 0x80);

  it('exactly at the limit passes, one over throws E_BGCODE_BOMB', () => {
    expect(dec(heatshrinkDecode(AB, 11, 4, 2))).toBe('AB');
    const e = syncRejection(() => heatshrinkDecode(AB, 11, 4, 1));
    expect(e.code).toBe('E_BGCODE_BOMB');
    expect(e.message).toBe('heatshrink output exceeds the limit (1)');
  });

  it('a back-reference run is capped mid-copy', () => {
    // 'A' then backref offset 1, count 16 (index 0, count 15): 1 01000001 0 00000000000 1111.
    const bits = '1' + '01000001' + '0' + '00000000000' + '1111';
    const bytes = new Uint8Array(Math.ceil(bits.length / 8));
    for (let i = 0; i < bits.length; i++) if (bits[i] === '1') bytes[i >> 3] |= 0x80 >> (i & 7);
    expect(dec(heatshrinkDecode(bytes, 11, 4, 17))).toBe('A'.repeat(17));
    const e = syncRejection(() => heatshrinkDecode(bytes, 11, 4, 16));
    expect(e.code).toBe('E_BGCODE_BOMB');
    expect(e.message).toBe('heatshrink output exceeds the limit (16)');
  });
});

describe('metadata + thumbnail blocks (behaviour that holds regardless of how they are budgeted)', () => {
  const g = gblock(NONE, enc('G1 X1\n'));

  it('a real-size DEFLATE thumbnail decodes byte-exact with its format and size', async () => {
    const png = new Uint8Array(2048).map((_, i) => (i * 31) & 0xff);
    const f = await assembleBgcode([
      g,
      { type: THUMB, compression: DEFLATE, thumbnail: { format: 0, width: 16, height: 12 }, data: png },
      { type: THUMB, compression: NONE, thumbnail: { format: 9, width: 2, height: 2 }, data: A(8) }
    ]);
    const r = await openBgcode(f, { metadata: true });
    expect(r.thumbnails.length).toBe(2);
    expect(r.thumbnails[0].format).toBe('png');
    expect(r.thumbnails[0].width).toBe(16);
    expect(r.thumbnails[0].height).toBe(12);
    expect(Array.from(r.thumbnails[0].bytes)).toEqual(Array.from(png));
    expect(r.thumbnails[1].format).toBe('unknown');
  });

  it('DEFLATE INI metadata is parsed into settings (comments and blank keys skipped)', async () => {
    const ini = enc('; comment = x\nprinter_model = MK4\n= orphan\nnozzle_diameter = 0.4\n');
    const f = await assembleBgcode([g, { type: PRINTER_META, compression: DEFLATE, encoding: 0, data: ini }]);
    const r = await openBgcode(f, { metadata: true });
    expect(r.settings).toEqual({ printer_model: 'MK4', nozzle_diameter: '0.4' });
    expect((await openBgcode(f)).settings).toEqual({}); // metadata: false leaves them undecoded
  });

  it('a metadata block that inflates short of its declared size throws E_BGCODE_SIZE', async () => {
    const ini = enc('printer_model = MK4\n');
    const f = await assembleBgcode([
      g,
      {
        type: PRINTER_META,
        compression: DEFLATE,
        encoding: 0,
        data: ini,
        preCompressed: { stored: zlibOf(ini), uncompressedSize: ini.length + 1 }
      }
    ]);
    const e = await rejection(openBgcode(f, { metadata: true }));
    expect(e.code).toBe('E_BGCODE_SIZE');
    expect(e.message).toBe(`deflate size disagreement (${ini.length} vs ${ini.length + 1})`);
  });

  it('a thumbnail that inflates past its declared size throws E_BGCODE_BOMB', async () => {
    const f = await assembleBgcode([
      g,
      {
        type: THUMB,
        compression: DEFLATE,
        thumbnail: { format: 0, width: 1, height: 1 },
        data: A(64),
        preCompressed: { stored: zlibOf(A(64)), uncompressedSize: 63 }
      }
    ]);
    const e = await rejection(openBgcode(f, { metadata: true }));
    expect(e.code).toBe('E_BGCODE_BOMB');
    expect(e.message).toBe('deflate output exceeds the declared/limit size (64)');
  });
});

describe('adapter guards (bed_shape bounds :47, single plate :105)', () => {
  const open = async (bedShape: string) => {
    const ini = enc(`bed_shape = ${bedShape}\nmax_print_height = 210\n`);
    const f = await assembleBgcode([
      gblock(NONE, enc('G1 X1\n')),
      { type: PRINTER_META, compression: NONE, encoding: 0, data: ini }
    ]);
    return openBgcodeContainer(f);
  };
  const pts = (n: number): string => Array.from({ length: n }, (_, i) => `${i}x${(i * 7) % 13}`).join(',');

  it('2 points → no machine; 3 points → a polygon bed', async () => {
    expect((await open(pts(2))).metadata.machine).toBeUndefined();
    const m = (await open(pts(3))).metadata.machine;
    expect(m?.bed.kind).toBe('polygon');
    expect(m?.heightMm).toBe(210);
  });

  it('64 points → a polygon bed; 65 points → no machine', async () => {
    const m = (await open(pts(64))).metadata.machine;
    expect(m?.bed.kind).toBe('polygon');
    expect(m?.bed.kind === 'polygon' ? m.bed.points.length : -1).toBe(64);
    expect((await open(pts(65))).metadata.machine).toBeUndefined();
  });

  it('4 axis-aligned corners → a rect bed; a malformed point → no machine', async () => {
    const m = (await open('0x0,250x0,250x210,0x210')).metadata.machine;
    expect(m?.bed).toEqual({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 250, y: 210 } });
    expect((await open('0x0,250x0,oops')).metadata.machine).toBeUndefined();
  });

  it('openPlate(0) streams the decoded G-code; any other index throws', async () => {
    const c = await open(pts(3));
    const { value } = await c.openPlate(0).getReader().read();
    expect(dec(value ?? new Uint8Array())).toBe('G1 X1\n');
    expect(() => c.openPlate(1)).toThrow('.bgcode has a single plate; requested 1');
  });
});
