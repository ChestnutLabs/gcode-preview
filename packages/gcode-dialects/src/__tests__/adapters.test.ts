/**
 * PrusaSlicer + Orca/Bambu adapter tests (DD-005 phase 3, issue #75).
 * IRs come from real parses of the committed dialect fixtures so marker→segment
 * resolution runs against genuine sourceIndex data.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeatureRole } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../../../gcode-parser/src/parse';
import { createDialectRunner } from '../registry';
import { prusaSlicer } from '../prusaslicer';
import { orcaBambu } from '../orca-bambu';
import { decodeBase64, parseAreaPoints } from '../annotate';

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../test-data/fixtures/dialects'
);
const load = (name: string): string => fs.readFileSync(path.join(fixtureDir, name), 'utf8');

/** Run text through parse + a dialect run exactly like the worker does. */
function annotatedParse(text: string) {
  const runner = createDialectRunner([prusaSlicer(), orcaBambu()]);
  const run = runner.createRun({
    selection: 'auto',
    headText: text.slice(0, 64 * 1024),
    tailText: text.slice(-16 * 1024)
  });
  expect(run).not.toBeNull();
  const result = parseGcodeToIR(text, {
    onComment: run!.onComment,
    onCommand: run!.onCommand
  });
  const out = run!.finalize(result.ir);
  return { ir: result.ir, metadata: out.metadata };
}

describe('PrusaSlicer adapter (#75)', () => {
  it('annotates ;TYPE: ranges, bed_shape (inferred + provenance), thumbnail', () => {
    const { ir, metadata } = annotatedParse(load('prusa-style-sample.gcode'));
    expect(ir.header.capabilities.featureRoles).toBe('known');
    expect(ir.header.dialects[0]).toEqual({ id: 'prusaslicer', confidence: 'known' });

    const roles = new Set(Array.from(ir.segments.feature));
    expect(roles.has(FeatureRole.Skirt)).toBe(true);
    expect(roles.has(FeatureRole.ExternalPerimeter)).toBe(true);
    expect(roles.has(FeatureRole.Perimeter)).toBe(true);
    expect(roles.has(FeatureRole.Infill)).toBe(true);
    expect(roles.has(FeatureRole.SolidInfill)).toBe(true);
    // The pre-marker travel/prime segments stay Unknown (0) — no invented roles.
    expect(ir.segments.feature[0]).toBe(0);
    // Marker order maps onto segment order: skirt segments precede external-perimeter ones.
    const arr = Array.from(ir.segments.feature);
    expect(arr.indexOf(FeatureRole.Skirt)).toBeLessThan(arr.indexOf(FeatureRole.ExternalPerimeter));

    const m = metadata?.machine;
    expect(m?.bed).toEqual({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 250, y: 210 } });
    expect(m?.heightMm).toBe(220);
    expect(m?.printerName).toBe('MK4');
    expect(m?.confidence).toBe('inferred');
    expect(m?.source).toMatchObject({ adapterId: 'prusaslicer' });
    expect(metadata?.thumbnails?.length).toBe(1);
    expect(metadata?.thumbnails?.[0].width).toBe(16);
    expect(Array.from(metadata!.thumbnails![0].bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe('Orca/Bambu adapter (#75)', () => {
  it('annotates FEATURE ranges, object start/stop, printable_area', () => {
    const { ir, metadata } = annotatedParse(load('orca-bambu-style-sample.gcode'));
    expect(ir.header.capabilities.featureRoles).toBe('known');
    expect(ir.header.capabilities.objects).toBe('known');
    expect(ir.header.dialects[0]).toEqual({ id: 'orca-bambu', confidence: 'known' });

    const roles = new Set(Array.from(ir.segments.feature));
    expect(roles.has(FeatureRole.ExternalPerimeter)).toBe(true);
    expect(roles.has(FeatureRole.Perimeter)).toBe(true);
    expect(roles.has(FeatureRole.Infill)).toBe(true);
    expect(roles.has(FeatureRole.SolidInfill)).toBe(true);

    // Two objects, 1-based channel values, names captured.
    const objects = new Set(Array.from(ir.segments.object));
    expect(objects.has(1)).toBe(true);
    expect(objects.has(2)).toBe(true);
    expect(ir.objects[0]).toEqual({ id: '1', name: 'cube_left' });
    expect(ir.objects[1]).toEqual({ id: '2', name: 'cube_right' });
    // Segments between stop and the next start belong to no object.
    expect(ir.segments.object[0]).toBe(0); // initial travel before the first object

    const m = metadata?.machine;
    expect(m?.bed).toEqual({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 180, y: 180 } });
    expect(m?.heightMm).toBe(180);
    expect(m?.printerName).toBe('Bambu Lab A1 mini');
    expect(m?.confidence).toBe('inferred');
  });

  it('detects via container metadata when the payload header is bare', () => {
    const runner = createDialectRunner([orcaBambu()]);
    const run = runner.createRun({
      selection: 'auto',
      headText: 'G0 X0 Y0',
      tailText: '',
      containerMeta: { printer_model: 'Bambu Lab X1C' }
    });
    expect(run?.detections[0]).toMatchObject({ dialectId: 'orca-bambu', confidence: 'inferred' });
  });
});

describe('annotate helpers (#75)', () => {
  it('base64 decode round-trips and rejects invalid input', () => {
    expect(Array.from(decodeBase64('iVBORw==') ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(decodeBase64('not-@-base64!')).toBeNull();
  });

  it('area parser handles bounds and rejects junk', () => {
    expect(parseAreaPoints('0x0,10x0,10x10,0x10')?.length).toBe(4);
    expect(parseAreaPoints('garbage')).toBeNull();
    expect(parseAreaPoints('1x1,2x2')).toBeNull(); // < 3 points
  });
});
