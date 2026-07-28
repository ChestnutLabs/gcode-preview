/**
 * MeatPack decoder — phase 2 (DD-011, #188). Validated against HAND-COMPUTED vectors: each expected
 * byte stream is assembled by applying the published nibble table by hand (an oracle independent of
 * the decoder's own table), so a wrong table/order/escape is caught — not merely a self-consistent
 * round-trip. Real PrusaSlicer `.bgcode` MeatPack blocks are added for golden-equivalence in phase 4.
 *
 * Table (low nibble = 1st char): 0-9→'0'-'9', A→'.', B→' '/'E', C→'\n', D→'G', E→'X', F→escape.
 * A packed byte is `(highNibble << 4) | lowNibble`; `FF FF FB` enables packing (stream starts disabled).
 */
import { describe, expect, it } from 'vitest';
import { meatpackDecode, openBgcode, BgcodeBlockType, BgcodeCompression, BgcodeEncoding } from '../index.js';
import { assembleBgcode } from './assemble.js';

const HEADER = [0xff, 0xff, 0xfb]; // MEATPACK_HEADER: enable packing
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const mp = (...bytes: number[]): string => dec(meatpackDecode(Uint8Array.from(bytes), 1 << 20));

describe('meatpackDecode — hand-computed vectors', () => {
  it('decodes a realistic packable line "G1 X2.5\\n"', () => {
    // (G,1)=0x1D  (space,X)=0xEB  (2,.)=0xA2  (5,\n)=0xC5
    expect(mp(...HEADER, 0x1d, 0xeb, 0xa2, 0xc5)).toBe('G1 X2.5\n');
  });

  it('right full-width escape: 2nd char not in the table ("GT")', () => {
    // (G, escape)=0xFD, then the literal 'T' (0x54) follows.
    expect(mp(...HEADER, 0xfd, 0x54)).toBe('GT');
  });

  it('left full-width escape: 1st char not in the table ("TG")', () => {
    // (escape, G)=0xDF, then the literal 'T' (0x54) follows.
    expect(mp(...HEADER, 0xdf, 0x54)).toBe('TG');
  });

  it('double full-width via a lone 0xFF data byte ("TT")', () => {
    // both chars unpackable → 0xFF then the two literals 'T','T'.
    expect(mp(...HEADER, 0xff, 0x54, 0x54)).toBe('TT');
  });

  it('a packed (\\n,\\n) byte collapses to a single newline', () => {
    // 0xCC = (\n high, \n low) → one '\n'.
    expect(mp(...HEADER, 0xcc)).toBe('\n');
  });

  it("the no-spaces command remaps 0b1011 from space to 'E'", () => {
    // FF FF F7 = enable no-spaces; then 0xBD = (space-slot high=E, G low) → "GE".
    expect(mp(...HEADER, 0xff, 0xff, 0xf7, 0xbd)).toBe('GE');
  });

  it('a mid-stream disable-packing command passes bytes through literally', () => {
    // FF FF FA = disable packing; then raw ASCII "G1\n".
    expect(mp(...HEADER, 0xff, 0xff, 0xfa, 0x47, 0x31, 0x0a)).toBe('G1\n');
  });

  it('rejects an invalid command byte', () => {
    expect(() => meatpackDecode(Uint8Array.from([0xff, 0xff, 0x00]), 1024)).toThrow(/MeatPack command/);
  });
});

describe('openBgcode — MeatPack-encoded GCode block (phase 2 integration)', () => {
  it('decodes a MeatPack block end-to-end (None compression + MeatPack encoding)', async () => {
    const packed = Uint8Array.from([...HEADER, 0x1d, 0xeb, 0xa2, 0xc5]); // "G1 X2.5\n"
    const buf = await assembleBgcode([
      {
        type: BgcodeBlockType.GCode,
        compression: BgcodeCompression.None,
        encoding: BgcodeEncoding.MeatPack,
        data: packed
      }
    ]);
    const { gcode } = await openBgcode(buf);
    expect(dec(gcode)).toBe('G1 X2.5\n');
  });

  it('decodes a DEFLATE-compressed MeatPack block (both layers)', async () => {
    const packed = Uint8Array.from([...HEADER, 0x1d, 0xeb, 0xa2, 0xc5]);
    const buf = await assembleBgcode([
      {
        type: BgcodeBlockType.GCode,
        compression: BgcodeCompression.Deflate,
        encoding: BgcodeEncoding.MeatPackComments,
        data: packed
      }
    ]);
    const { gcode } = await openBgcode(buf);
    expect(dec(gcode)).toBe('G1 X2.5\n');
  });
});
