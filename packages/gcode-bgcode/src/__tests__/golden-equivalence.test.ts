/**
 * The `.bgcode` **golden-equivalence killer test** (DD-011 §D6, #188): slice one model both ways and
 * assert the **decoded-`.bgcode` IR equals the plain-`.gcode` IR**. This is decode correctness pinned
 * against the already-trusted plain-G-code path — every geometry channel, byte for byte.
 *
 * Fixtures are a **primitive cube** exported from PrusaSlicer 2.9.6 in both formats (a generic
 * redistributable shape). The `.bgcode` exercises the real Prusa codec stack: heatshrink-12
 * compression + MeatPack (comments, no-spaces) encoding, DEFLATE metadata, thumbnails, per-block CRC32.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolpathSegments } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../../../gcode-parser/src/parse';
import { openBgcode } from '../index.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '../../../../test-data/fixtures/bgcode');

function fnv1a(a: ArrayBufferView): string {
  const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// Geometry channels only. `srcByte` is intentionally excluded: MeatPack no-spaces makes the decoded
// text shorter than the plain `.gcode` (`G1X10` vs `G1 X10`), so source offsets legitimately differ —
// the parser produces identical geometry regardless, which is exactly what equivalence means here.
const CHANNELS = ['x0', 'y0', 'z0', 'x1', 'y1', 'z1', 'e', 'kind', 'tool', 'layer'] as const;

describe('golden-equivalence: decoded .bgcode IR == plain .gcode IR (#188)', () => {
  it('a PrusaSlicer cube decodes to a geometry-identical IR', async () => {
    const plain = readFileSync(join(fixtureDir, 'prim-cube.gcode'), 'utf8');
    const bgcodeBytes = new Uint8Array(readFileSync(join(fixtureDir, 'prim-cube.bgcode')));

    const { gcode, blocks, checksum } = await openBgcode(bgcodeBytes);
    // The real file really exercises the whole codec stack, so this test is meaningful.
    expect(checksum).toBe('crc32');
    expect(blocks.some((b) => b.compression === 3 /* Heatshrink12 */ && b.encoding === 2 /* MeatPack+comments */)).toBe(
      true
    );

    const decoded = new TextDecoder().decode(gcode);
    const irPlain = parseGcodeToIR(plain).ir;
    const irBgcode = parseGcodeToIR(decoded).ir;

    // Same shape...
    expect(irBgcode.segments.count).toBe(irPlain.segments.count);
    expect(irBgcode.segments.count).toBeGreaterThan(1000); // a real cube, not an empty parse
    expect(irBgcode.layers.length).toBe(irPlain.layers.length);
    expect(irBgcode.tools.length).toBe(irPlain.tools.length);

    // ...and every geometry channel byte-identical: the decode reproduces the trusted path exactly.
    for (const ch of CHANNELS) {
      const a = irPlain.segments[ch as keyof ToolpathSegments] as ArrayBufferView;
      const b = irBgcode.segments[ch as keyof ToolpathSegments] as ArrayBufferView;
      expect(fnv1a(b), `channel ${ch} differs`).toBe(fnv1a(a));
    }
  });
});
