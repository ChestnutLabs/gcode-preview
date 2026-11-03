/**
 * #450: the metadata + thumbnail blocks share one internal 32 MiB budget (separate from the G-code
 * `maxOutputBytes`), and `maxOutputBytes` is validated as a non-negative integer. Boundaries are pinned
 * at budget / budget+1 with LITERAL sizes, codes and messages — never the module's constants — so a
 * mutant that loosens a compare, drops the running total or swaps the decompress limit goes red.
 */
import { describe, expect, it } from 'vitest';
import { ContainerError } from '@chestnutlabs/gcode-containers';
import { openBgcode } from '../index.js';
import { assembleBgcode, type AssembleBlock } from './assemble.js';

const BUDGET = 33554432; // 32 MiB, literal
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

// Literal block ids (spec §5.2) — deliberately not the module's constants.
const GCODE = 1;
const PRINTER_META = 3;
const THUMB = 5;
const NONE = 0;
const DEFLATE = 1;
const HS11 = 2;

const gcode: AssembleBlock = { type: GCODE, compression: NONE, encoding: 0, data: enc('G1 X1\n') };

/** A DEFLATE thumbnail of `n` zero bytes (tiny on disk, `n` bytes decoded). */
const zeroThumb = (n: number): AssembleBlock => ({
  type: THUMB,
  compression: DEFLATE,
  thumbnail: { format: 0, width: 8, height: 8 },
  data: new Uint8Array(n)
});

/** A DEFLATE INI block of exactly `n` bytes whose last line is `k = v`. */
function iniBlock(n: number): AssembleBlock {
  const tail = enc('\nk = v');
  const data = new Uint8Array(n).fill(0x41);
  data.set(tail, n - tail.length);
  return { type: PRINTER_META, compression: DEFLATE, encoding: 0, data };
}

/** A no-CRC file with one None-compressed thumbnail of `n` bytes (built directly — the assembler is per-byte). */
function noneThumbFile(n: number): Uint8Array {
  const f = new Uint8Array(10 + 8 + 6 + n);
  const v = new DataView(f.buffer);
  f.set(enc('GCDE'), 0);
  v.setUint32(4, 1, true); // version
  v.setUint16(8, 0, true); // no checksum
  v.setUint16(10, THUMB, true);
  v.setUint16(12, NONE, true);
  v.setUint32(14, n, true);
  // params (format, width, height) stay 0; data stays zero
  return f;
}

/** heatshrink (w11, l4) stream: literal 'A' then `refs` back-references of 16 bytes each → 1 + 16·refs bytes. */
function heatshrinkRun(refs: number): Uint8Array {
  const bits: number[] = [1, 0, 1, 0, 0, 0, 0, 0, 1]; // tag 1 + 0x41
  for (let r = 0; r < refs; r++) bits.push(0, ...new Array(11).fill(0), 1, 1, 1, 1); // index 1, count 16
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => (out[i >> 3] |= b << (7 - (i & 7))));
  return out;
}

async function rejection(p: Promise<unknown>): Promise<ContainerError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ContainerError);
    return e as ContainerError;
  }
  throw new Error('expected a ContainerError, but the call resolved');
}

describe('#450 metadata + thumbnail budget (32 MiB, internal)', () => {
  it('a DEFLATE thumbnail of exactly the budget decodes', async () => {
    const f = await assembleBgcode([gcode, zeroThumb(BUDGET)], { checksum: 'none' });
    const r = await openBgcode(f, { metadata: true });
    expect(r.thumbnails.map((t) => t.bytes.length)).toEqual([33554432]);
    expect(new TextDecoder().decode(r.gcode)).toBe('G1 X1\n');
  });

  it('a DEFLATE thumbnail of budget+1 throws E_BGCODE_BOMB before decompressing', async () => {
    const f = await assembleBgcode([gcode, zeroThumb(BUDGET + 1)], { checksum: 'none' });
    const e = await rejection(openBgcode(f, { metadata: true }));
    expect(e.code).toBe('E_BGCODE_BOMB');
    expect(e.message).toBe('metadata/thumbnail blocks exceed the internal budget (33554433)');
  });

  it('a None-compressed thumbnail is bounded too (at budget passes, +1 throws)', async () => {
    const ok = await openBgcode(noneThumbFile(BUDGET), { metadata: true });
    expect(ok.thumbnails[0].bytes.length).toBe(33554432);
    const e = await rejection(openBgcode(noneThumbFile(BUDGET + 1), { metadata: true }));
    expect(e.code).toBe('E_BGCODE_BOMB');
    expect(e.message).toBe('metadata/thumbnail blocks exceed the internal budget (33554433)');
  });

  it('the budget is an aggregate across thumbnail + INI blocks (sum at budget passes)', async () => {
    const half = 16777216;
    const f = await assembleBgcode([gcode, zeroThumb(half), iniBlock(half)], { checksum: 'none' });
    const r = await openBgcode(f, { metadata: true });
    expect(r.thumbnails[0].bytes.length).toBe(16777216);
    expect(r.settings.k).toBe('v');
  });

  it('the aggregate at budget+1 throws, before the INI block is decoded or parsed', async () => {
    const half = 16777216;
    const f = await assembleBgcode([gcode, zeroThumb(half), iniBlock(half + 1)], { checksum: 'none' });
    const e = await rejection(openBgcode(f, { metadata: true }));
    expect(e.code).toBe('E_BGCODE_BOMB');
    expect(e.message).toBe('metadata/thumbnail blocks exceed the internal budget (33554433)');
  });

  it('a heatshrink block that over-expands is cut at the REMAINING budget, not the G-code limit', async () => {
    // Use all but 10 bytes of the budget, then a heatshrink thumbnail that declares 1 byte but expands to 33.
    const hs = heatshrinkRun(2);
    const f = await assembleBgcode(
      [
        gcode,
        zeroThumb(BUDGET - 10),
        {
          type: THUMB,
          compression: HS11,
          thumbnail: { format: 0, width: 1, height: 1 },
          data: enc('A'),
          preCompressed: { stored: hs, uncompressedSize: 1 }
        }
      ],
      { checksum: 'none' }
    );
    const e = await rejection(openBgcode(f, { metadata: true }));
    expect(e.code).toBe('E_BGCODE_BOMB');
    expect(e.message).toBe('heatshrink output exceeds the limit (10)');
  });

  it('the heatshrink run helper really expands (sanity for the test above)', async () => {
    const f = await assembleBgcode(
      [
        {
          type: THUMB,
          compression: HS11,
          thumbnail: { format: 0, width: 1, height: 1 },
          data: enc('A'),
          preCompressed: { stored: heatshrinkRun(2), uncompressedSize: 33 }
        }
      ],
      { checksum: 'none' }
    );
    const r = await openBgcode(f, { metadata: true });
    expect(r.thumbnails[0].bytes).toEqual(new Uint8Array(33).fill(0x41));
  });

  it('G-code blocks do not draw on the metadata budget', async () => {
    const big: AssembleBlock = {
      type: GCODE,
      compression: DEFLATE,
      encoding: 0,
      data: new Uint8Array(BUDGET).fill(0x41)
    };
    const f = await assembleBgcode([big, zeroThumb(BUDGET)], { checksum: 'none' });
    const r = await openBgcode(f, { metadata: true });
    expect(r.gcode.length).toBe(33554432);
    expect(r.thumbnails[0].bytes.length).toBe(33554432);
  });

  it('with metadata off, over-budget metadata blocks are walked past, not decoded', async () => {
    const f = await assembleBgcode([gcode, zeroThumb(BUDGET + 1)], { checksum: 'none' });
    const r = await openBgcode(f);
    expect(r.thumbnails).toEqual([]);
    expect(new TextDecoder().decode(r.gcode)).toBe('G1 X1\n');
  });
});

describe('#450 maxOutputBytes validation', () => {
  const bad: [string, unknown][] = [
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['-1', -1],
    ['1.5', 1.5],
    ["'100'", '100'],
    ['null', null],
    ['2^53', 9007199254740992]
  ];
  for (const [label, value] of bad) {
    it(`rejects ${label} with E_BGCODE_OPTION before decoding`, async () => {
      // An empty buffer would otherwise be E_BGCODE_TRUNCATED: validation must come first.
      const e = await rejection(openBgcode(new Uint8Array(0), { maxOutputBytes: value as number }));
      expect(e.code).toBe('E_BGCODE_OPTION');
      expect(e.message).toBe(`maxOutputBytes must be a non-negative integer (got ${String(value)})`);
    });
  }

  it('accepts 0 (no G-code allowed: an empty payload decodes, any G-code is a bomb)', async () => {
    const meta = await assembleBgcode([iniBlock(16)], { checksum: 'none' });
    expect((await openBgcode(meta, { maxOutputBytes: 0, metadata: true })).settings.k).toBe('v');
    const withG = await assembleBgcode([gcode], { checksum: 'none' });
    expect((await rejection(openBgcode(withG, { maxOutputBytes: 0 }))).code).toBe('E_BGCODE_BOMB');
  });

  it('accepts undefined (the default) and the largest safe integer', async () => {
    const f = await assembleBgcode([gcode], { checksum: 'none' });
    expect((await openBgcode(f, { maxOutputBytes: undefined })).gcode.length).toBe(6);
    expect((await openBgcode(f, { maxOutputBytes: 9007199254740991 })).gcode.length).toBe(6);
  });

  it('the cap still bites at a valid value (the #451 aggregate guard is unchanged)', async () => {
    const f = await assembleBgcode([gcode], { checksum: 'none' });
    expect((await openBgcode(f, { maxOutputBytes: 6 })).gcode.length).toBe(6);
    expect((await rejection(openBgcode(f, { maxOutputBytes: 5 }))).code).toBe('E_BGCODE_BOMB');
  });
});
