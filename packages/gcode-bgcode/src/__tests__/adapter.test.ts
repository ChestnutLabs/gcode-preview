/**
 * Metadata/thumbnail decoding + the container adapter (DD-011 phase 4c, #188), against the committed
 * real Prusa cube fixture.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBgcode, openBgcodeContainer, sniffBgcode } from '../index.js';

const cube = new Uint8Array(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../../test-data/fixtures/bgcode/prim-cube.bgcode'))
);

describe('openBgcode metadata + thumbnails (#188 phase 4c)', () => {
  it('surfaces INI settings and thumbnails only when metadata:true', async () => {
    const bare = await openBgcode(cube);
    expect(Object.keys(bare.settings)).toHaveLength(0);
    expect(bare.thumbnails).toHaveLength(0);

    const full = await openBgcode(cube, { metadata: true });
    expect(full.settings['bed_shape']).toBe('0x0,360x0,360x360,0x360');
    expect(full.settings['printer_model']).toBe('XL2IS');
    expect(full.settings['Producer']).toContain('PrusaSlicer');
    // The cube carries 4 thumbnails (QOI + PNG) with non-empty image bytes.
    expect(full.thumbnails.length).toBe(4);
    expect(full.thumbnails.every((t) => t.bytes.length > 0 && t.width > 0)).toBe(true);
    expect(full.thumbnails.map((t) => t.format)).toContain('png');
  });
});

describe('openBgcodeContainer — DD-005 §4.4 adapter shape (#188 phase 4c)', () => {
  it('sniffs, exposes one plate, and streams the decoded G-code with machine metadata', async () => {
    expect(sniffBgcode(cube.subarray(0, 8))).toBe(true);

    const opened = await openBgcodeContainer(cube);
    expect(opened.id).toBe('bgcode');
    expect(opened.plates).toHaveLength(1);
    expect(opened.plates[0].index).toBe(0);
    expect(opened.metadata.machine?.bed).toEqual({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 360, y: 360 } });
    expect(opened.metadata.machine?.heightMm).toBe(360);
    expect(opened.metadata.machine?.printerName).toBe('XL2IS');
    expect(opened.metadata.raw['printer_model']).toBe('XL2IS');
    expect(opened.thumbnails.length).toBe(4);

    // openPlate(0) yields the full decoded G-code as a one-shot stream.
    const reader = opened.openPlate(0).getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value!.length).toBeGreaterThan(100_000);
    expect(new TextDecoder().decode(first.value!.subarray(0, 40))).toContain('M73');
    expect((await reader.read()).done).toBe(true);

    expect(() => opened.openPlate(1)).toThrow(/single plate/);
  });
});
