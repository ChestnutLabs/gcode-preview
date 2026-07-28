/**
 * heatshrink decoder — phase 3 (DD-011, #188). Validated against vectors built by an INDEPENDENT
 * MSB-first bit-packer (`packBits`) from the wire format described in the spec: a tag bit (1=literal
 * 8 bits; 0=backref of `windowBits` index + `lookaheadBits` count, both value−1). The packer is a
 * separate code path from the decoder's bit reader, so `decode(pack(tokens)) === expected` validates
 * the decoder against the spec, not against itself. Real PrusaSlicer heatshrink blocks → phase 4.
 */
import { describe, expect, it } from 'vitest';
import { heatshrinkDecode, openBgcode, BgcodeBlockType, BgcodeCompression, BgcodeEncoding } from '../index.js';
import { assembleBgcode } from './assemble.js';

const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

/** Pack [value, bitCount] fields MSB-first into bytes (independent of the decoder's reader). */
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
/** A back-reference token: copy `count` bytes from `offset` back, in a `windowBits` window. */
const BACKREF = (offset: number, count: number, windowBits: number): Array<[number, number]> => [
  [0, 1],
  [offset - 1, windowBits],
  [count - 1, 4]
];

describe('heatshrinkDecode — spec vectors (independent bit-packer)', () => {
  it('literals decode to their bytes', () => {
    expect(dec(heatshrinkDecode(packBits([...LIT('A'), ...LIT('B')]), 11, 4, 1024))).toBe('AB');
  });

  it('a back-reference copies from the window (window 11)', () => {
    // "A", then copy 3 bytes from 1 back → "AAAA".
    const v = packBits([...LIT('A'), ...BACKREF(1, 3, 11)]);
    expect(dec(heatshrinkDecode(v, 11, 4, 1024))).toBe('AAAA');
  });

  it('a back-reference with a 12-bit window index', () => {
    const v = packBits([...LIT('A'), ...BACKREF(1, 3, 12)]);
    expect(dec(heatshrinkDecode(v, 12, 4, 1024))).toBe('AAAA');
  });

  it('a self-referential run (copy length exceeds the offset) expands correctly', () => {
    // "A", then copy 5 from 1 back → "AAAAAA".
    const v = packBits([...LIT('A'), ...BACKREF(1, 5, 11)]);
    expect(dec(heatshrinkDecode(v, 11, 4, 1024))).toBe('AAAAAA');
  });

  it('a multi-byte back-reference at offset 2 interleaves correctly', () => {
    // "AB", then copy 4 from 2 back → "ABAB" → total "ABABAB".
    const v = packBits([...LIT('A'), ...LIT('B'), ...BACKREF(2, 4, 11)]);
    expect(dec(heatshrinkDecode(v, 11, 4, 1024))).toBe('ABABAB');
  });

  it('decodes a realistic repeated G-code fragment', () => {
    // "G1 X" then a back-reference to repeat "G1 X" → "G1 XG1 X".
    const v = packBits([...LIT('G'), ...LIT('1'), ...LIT(' '), ...LIT('X'), ...BACKREF(4, 4, 11)]);
    expect(dec(heatshrinkDecode(v, 11, 4, 1024))).toBe('G1 XG1 X');
  });

  it('enforces the output cap (decompression-bomb defense)', () => {
    // count 16 is the 4-bit-lookahead maximum; 'A' + a 16-byte copy = 17 bytes > the 4-byte cap.
    const v = packBits([...LIT('A'), ...BACKREF(1, 16, 11)]);
    expect(() => heatshrinkDecode(v, 11, 4, 4)).toThrow(/limit/);
  });
});

describe('openBgcode — heatshrink-compressed block (phase 3 integration)', () => {
  it('decodes a Heatshrink12 GCode block end-to-end', async () => {
    const stored = packBits([...LIT('A'), ...BACKREF(1, 3, 12)]); // → "AAAA"
    const buf = await assembleBgcode([
      {
        type: BgcodeBlockType.GCode,
        compression: BgcodeCompression.Heatshrink12,
        encoding: BgcodeEncoding.None,
        data: new Uint8Array(),
        preCompressed: { stored, uncompressedSize: 4 }
      }
    ]);
    const { gcode, blocks } = await openBgcode(buf);
    expect(dec(gcode)).toBe('AAAA');
    expect(blocks[0].compression).toBe(BgcodeCompression.Heatshrink12);
  });
});
