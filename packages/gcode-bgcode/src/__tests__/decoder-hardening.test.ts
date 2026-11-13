/**
 * Hostile-input sweep of the two bgcode block decoders (heatshrink, MeatPack). Every expectation is a literal.
 * Direct callers of the public `heatshrinkDecode` / `meatpackDecode` exports get validated parameters (a bad
 * `limit` used to disable the cap, a big `windowBits` allocated before any limit applied); bgcode's own calls
 * (window 11/12, lookahead 4) are byte-identical (pinned against a real Prusa file below).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContainerError } from '@chestnutlabs/gcode-containers';
import { heatshrinkDecode, meatpackDecode, openBgcode } from '../index.js';

const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

/** Pack [value, bitCount] fields MSB-first (independent of the decoder's bit reader). */
function packBits(fields: Array<[number, number]>): Uint8Array {
  const bits: number[] = [];
  for (const [val, n] of fields) for (let i = n - 1; i >= 0; i--) bits.push((val >> i) & 1);
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 0x80 >> (i & 7);
  return bytes;
}
const LIT = (c: string): Array<[number, number]> => [
  [1, 1],
  [c.charCodeAt(0), 8]
];
const HUNDRED = new Uint8Array(100);
const AB = packBits([...LIT('A'), ...LIT('B')]);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof ContainerError ? e.code : `non-ContainerError:${String(e)}`;
  }
  return undefined;
}

/** Sizes of every numeric-length `new Uint8Array(n)` made while `fn` runs. */
function uint8Allocations(fn: () => void): number[] {
  const sizes: number[] = [];
  vi.stubGlobal(
    'Uint8Array',
    new Proxy(Uint8Array, {
      construct(target, args, nt) {
        if (typeof args[0] === 'number') sizes.push(args[0]);
        return Reflect.construct(target, args, nt);
      }
    })
  );
  try {
    fn();
  } finally {
    vi.unstubAllGlobals();
  }
  return sizes;
}
afterEach(() => vi.unstubAllGlobals());

describe('heatshrinkDecode — parameter validation (E_BGCODE_OPTION, before any allocation)', () => {
  it('limit: NaN / Infinity / negative / fractional / non-number all throw', () => {
    for (const bad of [NaN, Infinity, -Infinity, -1, 1.5, '5', null, undefined, 2 ** 53]) {
      expect(codeOf(() => heatshrinkDecode(AB, 11, 4, bad as number))).toBe('E_BGCODE_OPTION');
    }
  });
  it('limit: 0 and the largest safe integer are accepted (0 → BOMB on first byte, empty input fine)', () => {
    expect(codeOf(() => heatshrinkDecode(AB, 11, 4, 0))).toBe('E_BGCODE_BOMB');
    expect(heatshrinkDecode(new Uint8Array(0), 11, 4, 0).length).toBe(0);
    expect(dec(heatshrinkDecode(AB, 11, 4, Number.MAX_SAFE_INTEGER))).toBe('AB');
  });
  it('windowBits: 4 and 15 accepted; 3 and 16 rejected', () => {
    expect(dec(heatshrinkDecode(AB, 4, 3, 100))).toBe('AB');
    expect(dec(heatshrinkDecode(AB, 15, 4, 100))).toBe('AB');
    expect(codeOf(() => heatshrinkDecode(AB, 3, 3, 100))).toBe('E_BGCODE_OPTION');
    expect(codeOf(() => heatshrinkDecode(AB, 16, 4, 100))).toBe('E_BGCODE_OPTION');
  });
  it('windowBits below 4 reports the windowBits range (not the lookahead one)', () => {
    expect(() => heatshrinkDecode(AB, 3, 3, 100)).toThrow(/windowBits must be an integer in 4\.\.15 \(got 3\)/);
    expect(() => heatshrinkDecode(AB, 16, 4, 100)).toThrow(/windowBits must be an integer in 4\.\.15 \(got 16\)/);
  });
  it('windowBits: non-integers and non-numbers rejected (NaN, 1.5, 11.5, string, null, undefined)', () => {
    for (const bad of [NaN, 1.5, 11.5, Infinity, -1, 0, 30, 31, 32, '11', null, undefined]) {
      expect(codeOf(() => heatshrinkDecode(AB, bad as number, 4, 100))).toBe('E_BGCODE_OPTION');
    }
  });
  it('lookaheadBits: 3 accepted, 2 rejected; max is windowBits − 1', () => {
    expect(dec(heatshrinkDecode(AB, 11, 3, 100))).toBe('AB');
    expect(codeOf(() => heatshrinkDecode(AB, 11, 2, 100))).toBe('E_BGCODE_OPTION');
    expect(dec(heatshrinkDecode(AB, 11, 10, 100))).toBe('AB');
    expect(codeOf(() => heatshrinkDecode(AB, 11, 11, 100))).toBe('E_BGCODE_OPTION');
    expect(dec(heatshrinkDecode(AB, 4, 3, 100))).toBe('AB');
    expect(codeOf(() => heatshrinkDecode(AB, 4, 4, 100))).toBe('E_BGCODE_OPTION');
  });
  it('lookaheadBits: non-integers and non-numbers rejected', () => {
    for (const bad of [NaN, 4.5, Infinity, 0, -4, '4', null, undefined]) {
      expect(codeOf(() => heatshrinkDecode(AB, 11, bad as number, 100))).toBe('E_BGCODE_OPTION');
    }
  });
  it('windowBits 30 throws with NO large allocation (validated before the window is built)', () => {
    let code: string | undefined;
    const sizes = uint8Allocations(() => {
      code = codeOf(() => heatshrinkDecode(AB, 30, 4, 100));
    });
    expect(code).toBe('E_BGCODE_OPTION');
    expect(Math.max(0, ...sizes)).toBe(0);
  });
  it('a bad limit throws with no allocation either', () => {
    const sizes = uint8Allocations(() => {
      codeOf(() => heatshrinkDecode(AB, 11, 4, NaN));
    });
    expect(sizes).toEqual([]);
  });
});

describe('heatshrinkDecode — decoding edges', () => {
  it('allocation shape: window = 2^windowBits, output buffer = max(64, min(limit, 4 × input)), growth doubles up to the limit', () => {
    expect(uint8Allocations(() => void heatshrinkDecode(AB, 11, 4, 1 << 20))).toEqual([2048, 64]);
    expect(uint8Allocations(() => void heatshrinkDecode(AB, 8, 4, 1 << 20))).toEqual([256, 64]);
    // 100 bytes of input, limit 10 → clamped to the 64 floor, never 400
    expect(uint8Allocations(() => void codeOf(() => heatshrinkDecode(HUNDRED, 11, 4, 10)))[1]).toBe(64);
    // 100 bytes of input, big limit → 400
    expect(uint8Allocations(() => void heatshrinkDecode(HUNDRED, 11, 4, 1 << 20))[1]).toBe(400);
    // literal 'A' then 6 × (copy 16 from 1 back) = 97 bytes from 11 input bytes; limit 97: 64 → grows to 97, not 128
    const tokens: Array<[number, number]> = [...LIT('A')];
    for (let i = 0; i < 6; i++) tokens.push([0, 1], [0, 11], [15, 4]);
    const grown = packBits(tokens);
    const sizes = uint8Allocations(() => void heatshrinkDecode(grown, 11, 4, 97));
    expect(sizes).toEqual([2048, 64, 97]);
    expect(heatshrinkDecode(grown, 11, 4, 97).length).toBe(97);
    expect(uint8Allocations(() => void heatshrinkDecode(grown, 11, 4, 1000))).toEqual([2048, 64, 128]);
  });

  it('trailing padding never forms a token: window 8 (token = 13 bits) with one literal (9 bits + 7 pad)', () => {
    expect(dec(heatshrinkDecode(packBits(LIT('A')), 8, 4, 100))).toBe('A');
  });

  it('a token cut off mid-way ends the stream without emitting anything', () => {
    // literal tag + 7 of its 8 bits
    expect(heatshrinkDecode(new Uint8Array([0xff]), 11, 4, 100).length).toBe(0);
    // backref tag + 7 of 11 index bits
    expect(heatshrinkDecode(new Uint8Array([0x00]), 11, 4, 100).length).toBe(0);
    // window 5: backref tag + 5 index bits leave only 2 of the 4 count bits
    expect(heatshrinkDecode(new Uint8Array([0x00]), 5, 4, 100).length).toBe(0);
  });

  it('a back-reference before the start reads the zeroed window (one NUL), never out of bounds', () => {
    const d = packBits([
      [0, 1],
      [0, 11],
      [0, 4]
    ]);
    expect(Array.from(heatshrinkDecode(d, 11, 4, 100))).toEqual([0]);
  });

  it('a back-reference reaching exactly the window size wraps correctly; output past the limit is BOMB', () => {
    const toks: Array<[number, number]> = [];
    for (let i = 0; i < 16; i++) toks.push(...LIT(String.fromCharCode(97 + i))); // a..p in a 16-byte window
    toks.push([0, 1], [15, 4], [0, 3]); // window 4: copy 1 byte from 16 back → 'a'
    expect(dec(heatshrinkDecode(packBits(toks), 4, 3, 100))).toBe('abcdefghijklmnopa');
    expect(codeOf(() => heatshrinkDecode(packBits(toks), 4, 3, 16))).toBe('E_BGCODE_BOMB');
  });
});

describe('meatpackDecode — parameter validation and edges', () => {
  it('limit: NaN / Infinity / negative / fractional / non-number throw E_BGCODE_OPTION, before any allocation', () => {
    for (const bad of [NaN, Infinity, -1, 0.5, '9', null, undefined]) {
      let code: string | undefined;
      const sizes = uint8Allocations(() => {
        code = codeOf(() => meatpackDecode(new Uint8Array([65, 66]), bad as number));
      });
      expect(code).toBe('E_BGCODE_OPTION');
      expect(sizes).toEqual([]);
    }
  });
  it('limit 0 on empty input is fine; limit 0 on a byte is BOMB', () => {
    expect(meatpackDecode(new Uint8Array(0), 0).length).toBe(0);
    expect(codeOf(() => meatpackDecode(new Uint8Array([65]), 0))).toBe('E_BGCODE_BOMB');
  });
  it('output buffer = max(64, min(limit, 2 × input))', () => {
    expect(uint8Allocations(() => void meatpackDecode(new Uint8Array([65, 66]), 1 << 20))).toEqual([64]);
    expect(uint8Allocations(() => void meatpackDecode(HUNDRED, 1 << 20))).toEqual([200]);
    expect(uint8Allocations(() => void codeOf(() => meatpackDecode(HUNDRED, 10)))).toEqual([64]);
  });
  it('disabled state passes every byte through, including >= 0x80', () => {
    expect(Array.from(meatpackDecode(new Uint8Array([0x80, 0xfe, 0x41]), 100))).toEqual([0x80, 0xfe, 0x41]);
  });
  it('reset-all returns to disabled: the next byte is a plain literal, not two nibbles', () => {
    // FF FF FB (enable) FF FF F9 (reset all) 0x41 → 'A', not '14'
    const d = new Uint8Array([0xff, 0xff, 0xfb, 0xff, 0xff, 0xf9, 0x41]);
    expect(dec(meatpackDecode(d, 100))).toBe('A');
  });
  it('packed pair with a full-width 2nd char and with a full-width 1st char', () => {
    // enable; low nibble 1 ('1'), high nibble F (full) → '1' then the next byte literally
    expect(dec(meatpackDecode(new Uint8Array([0xff, 0xff, 0xfb, 0xf1, 0x5a]), 100))).toBe('1Z');
    // low nibble F (full), high nibble 2 ('2') → placeholder replaced by the next byte, then '2'
    expect(dec(meatpackDecode(new Uint8Array([0xff, 0xff, 0xfb, 0x2f, 0x5a]), 100))).toBe('Z2');
  });
});

describe('real Prusa file: bgcode decode is byte-identical (heatshrink 12/4 + MeatPack-comments)', () => {
  it('prim-cube.bgcode → 384,729 bytes, sha256 pinned from the pre-change build', async () => {
    const bytes = new Uint8Array(
      readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), '../../../../test-data/fixtures/bgcode/prim-cube.bgcode')
      )
    );
    const r = await openBgcode(bytes, { metadata: true });
    expect(r.gcode.length).toBe(384729);
    expect(createHash('sha256').update(r.gcode).digest('hex')).toBe(
      'b0b832f15dd184367651aefe04cc9c0189d300c9019f8b83c4a03a6ad2ca27ca'
    );
  });
});
