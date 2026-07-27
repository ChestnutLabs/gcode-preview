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
import { cura } from '../cura';
import { klipper, marlin, repRap } from '../firmware';
import { decodeBase64, parseAreaPoints } from '../annotate';

const fixtureDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../test-data/fixtures/dialects'
);
const load = (name: string): string => fs.readFileSync(path.join(fixtureDir, name), 'utf8');

const ALL_ADAPTERS = () => [prusaSlicer(), orcaBambu(), cura(), klipper(), marlin(), repRap()];

/** Run text through parse + a dialect run exactly like the worker does. */
function annotatedParse(text: string) {
  const runner = createDialectRunner(ALL_ADAPTERS());
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

describe('Cura + firmware adapters (#76)', () => {
  it('Cura + Marlin COMPOSE: slicer roles annotated, firmware flavor identified', () => {
    const { ir } = annotatedParse(load('cura-style-sample.gcode'));
    const ids = ir.header.dialects.map((d) => d.id).sort();
    expect(ids).toEqual(['cura', 'marlin']);
    expect(ir.header.capabilities.featureRoles).toBe('known');
    const roles = new Set(Array.from(ir.segments.feature));
    expect(roles.has(FeatureRole.Skirt)).toBe(true);
    expect(roles.has(FeatureRole.ExternalPerimeter)).toBe(true);
    expect(roles.has(FeatureRole.Perimeter)).toBe(true);
    expect(roles.has(FeatureRole.Infill)).toBe(true);
    expect(roles.has(FeatureRole.SolidInfill)).toBe(true); // SKIN
  });

  it('PrusaSlicer + Klipper COMPOSE on a Klipper-targeted file (acceptance case)', () => {
    const { ir, metadata } = annotatedParse(load('klipper-prusa-sample.gcode'));
    const ids = ir.header.dialects.map((d) => d.id).sort();
    expect(ids).toEqual(['klipper', 'prusaslicer']);
    expect(ir.header.capabilities.featureRoles).toBe('known');
    expect(metadata?.machine?.bed).toEqual({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 300, y: 300 } });
    expect(metadata?.machine?.printerName).toBe('Voron24');
  });

  it('RepRap flavor detects alone; unknown files still match nothing', () => {
    const { ir } = annotatedParse(load('reprap-style-sample.gcode'));
    expect(ir.header.dialects.map((d) => d.id)).toEqual(['reprap']);
    expect(ir.header.capabilities.featureRoles).toBe('unavailable'); // no markers → honest

    const runner = createDialectRunner(ALL_ADAPTERS());
    expect(runner.createRun({ selection: 'auto', headText: 'G0 X1\nG1 X2 E1', tailText: '' })).toBeNull();
  });
});

describe('object exclusion + multi-tool (#77)', () => {
  it('Klipper EXCLUDE_OBJECT_* commands populate the object channel with exact seg indices', () => {
    const { ir } = annotatedParse(load('klipper-prusa-sample.gcode'));
    expect(ir.header.capabilities.objects).toBe('known');
    const values = new Set(Array.from(ir.segments.object));
    expect(values.has(1)).toBe(true); // 'cube'
    expect(ir.objects[0]).toEqual({ id: '1', name: 'cube' });
    // Segments after EXCLUDE_OBJECT_END belong to no object.
    expect(ir.segments.object[ir.segments.count - 1]).toBe(0);
    // Segments inside the START..END block carry the object value.
    const inBlock = Array.from(ir.segments.object).filter((v) => v === 1).length;
    expect(inBlock).toBe(5); // the 5-segment square between START and END
  });

  it('Marlin M486 S<idx> blocks populate objects; S-1 terminates', () => {
    const { ir } = annotatedParse(load('marlin-m486-sample.gcode'));
    expect(ir.header.dialects.map((d) => d.id).sort()).toEqual(['cura', 'marlin']);
    expect(ir.header.capabilities.objects).toBe('known');
    const arr = Array.from(ir.segments.object);
    expect(new Set(arr).has(1)).toBe(true);
    expect(new Set(arr).has(2)).toBe(true);
    expect(ir.objects[0].name).toBe('object 0');
    expect(ir.objects[1].name).toBe('object 1');
    // Travel between the M486 S-1 and the next S1 belongs to no object.
    const firstTwo = arr.indexOf(2);
    expect(arr.slice(0, firstTwo)).toContain(0);
  });

  it('multi-tool AMS metadata enriches ir.tools (material + color) from filament config', () => {
    const { ir, metadata } = annotatedParse(load('multitool-ams-sample.gcode'));
    // Tool channel from core T commands: both tools present.
    expect(new Set(Array.from(ir.segments.tool)).size).toBe(2);
    const t0 = ir.tools.find((t) => t.id === 0);
    const t1 = ir.tools.find((t) => t.id === 1);
    expect(t0?.material).toBe('PLA');
    expect(t1?.material).toBe('PETG');
    expect(t0?.color?.g).toBeCloseTo(0xaa / 255, 5);
    expect(t1?.color?.b).toBeCloseTo(0xee / 255, 5);
    expect(metadata?.filaments?.length).toBe(2);
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

describe('filament used + slicer print-time metadata (#183)', () => {
  it('PrusaSlicer: length/volume/weight + normal-mode print time', () => {
    const gcode = [
      '; generated by PrusaSlicer 2.7.0 on 2024-01-01',
      'G1 X0 Y0 Z0.2 F1200',
      'G1 X10 Y0 E1',
      '; filament used [mm] = 2224.99',
      '; filament used [cm3] = 5.35',
      '; total filament used [g] = 6.64',
      '; estimated printing time (normal mode) = 37m 15s',
      '; estimated printing time (silent mode) = 38m 0s'
    ].join('\n');
    const { metadata } = annotatedParse(gcode);
    expect(metadata?.filamentUsage).toMatchObject({ lengthMm: 2224.99, volumeCm3: 5.35, weightG: 6.64 });
    expect(metadata?.filamentUsage?.source.adapterId).toBe('prusaslicer');
    expect(metadata?.printEstimate).toMatchObject({ seconds: 37 * 60 + 15, mode: 'normal' });
  });

  it('Cura: ;TIME: seconds + ;Filament used: metres → mm', () => {
    const gcode = [
      ';Generated with Cura_SteamEngine 5.6.0',
      'G1 X0 Y0 Z0.2 F1200',
      'G1 X10 Y0 E1',
      ';TIME:2235',
      ';Filament used: 2.22m'
    ].join('\n');
    const { metadata } = annotatedParse(gcode);
    expect(metadata?.printEstimate?.seconds).toBe(2235);
    expect(metadata?.filamentUsage?.lengthMm).toBeCloseTo(2220, 3);
    expect(metadata?.filamentUsage?.source.adapterId).toBe('cura');
  });

  it('Orca/Bambu: filament totals + colon-separated estimated time', () => {
    const gcode = [
      '; generated by OrcaSlicer 2.0.0',
      'G1 X0 Y0 Z0.2 F1200',
      'G1 X10 Y0 E1',
      '; filament used [mm] = 1645.00',
      '; total filament used [g] = 4.91',
      '; total estimated time: 27m 14s'
    ].join('\n');
    const { metadata } = annotatedParse(gcode);
    expect(metadata?.filamentUsage).toMatchObject({ lengthMm: 1645, weightG: 4.91 });
    expect(metadata?.printEstimate?.seconds).toBe(27 * 60 + 14);
  });

  it('absent when the slicer emits neither (capability-honest)', () => {
    const gcode = ['; generated by PrusaSlicer 2.7.0', 'G1 X0 Y0 Z0.2 F1200', 'G1 X10 Y0 E1'].join('\n');
    const { metadata } = annotatedParse(gcode);
    expect(metadata?.filamentUsage).toBeUndefined();
    expect(metadata?.printEstimate).toBeUndefined();
  });
});
