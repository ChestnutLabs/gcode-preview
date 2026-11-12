/**
 * `.gcode.3mf` metadata sweep (G3): `project_settings.config` is untrusted file data. A value that is
 * present but unusable is DROPPED with a `container-metadata-invalid` warning, never thrown and never
 * passed on: a non-finite bed point means no machine; a printable_height that is not a positive number
 * means no height. Also the plate-number derivation (canonical name, numeric order) and the raw
 * whitelist. Expected values are literal, never the module's own constants.
 */
import { describe, expect, it } from 'vitest';
import { filamentColoursFromSettings, openGcode3mf } from '../index';
import { buildZip, type BuildEntry } from './zip-builder';

const PLATE: BuildEntry = { name: 'Metadata/plate_1.gcode', data: 'G1 X1 Y1\n', deflate: true };
const SETTINGS_NAME = 'Metadata/project_settings.config';
const INVALID = 'container-metadata-invalid';
const AREA_MSG = 'printable_area is not 3 to 64 finite "XxY" points; no machine geometry';
const RECT = ['0x0', '200x0', '200x180', '0x180'];

const projectText = (text: string): Uint8Array =>
  buildZip([PLATE, { name: SETTINGS_NAME, data: text, deflate: true }]).bytes;
const project = (settings: unknown): Uint8Array => projectText(JSON.stringify(settings));

/** A 24-byte PNG prefix: signature + IHDR chunk header + width + height. */
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

describe('printable_area: non-finite points drop the machine', () => {
  const big = '9'.repeat(400); // parses to Infinity
  it.each([
    ['infinite x (array)', [`${big}x0`, '200x0', '200x180']],
    ['infinite y (array)', ['0x0', `200x${big}`, '200x180']],
    ['negative-infinite x (string)', `-${big}x0,200x0,200x180`],
    ['infinite y in the last point (string)', `0x0,200x0,200x${big}`]
  ])('%s → no machine, one warning', async (_label, area) => {
    const opened = await openGcode3mf(project({ printable_area: area, printable_height: '250' }));
    expect(opened.metadata.machine).toBeUndefined();
    expect(opened.metadata.warnings).toEqual([{ code: INVALID, message: AREA_MSG }]);
  });

  it('a 308-digit coordinate is still finite and kept', async () => {
    const x = `1${'0'.repeat(307)}`; // 1e307
    const opened = await openGcode3mf(project({ printable_area: [`0x0`, `${x}x0`, `${x}x5`] }));
    expect(opened.metadata.warnings).toEqual([]);
    expect(opened.metadata.machine?.bed).toEqual({
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 1e307, y: 0 },
        { x: 1e307, y: 5 }
      ]
    });
  });
});

describe('printable_height: only a positive finite number is kept', () => {
  it.each([
    ['a numeric string', '250', 250],
    ['a decimal string', '12.5', 12.5],
    ['a JSON number', 300, 300],
    ['a tiny positive number', 0.001, 0.001]
  ])('%s → heightMm %s, no warning', async (_label, height, expected) => {
    const opened = await openGcode3mf(project({ printable_area: RECT, printable_height: height }));
    expect(opened.metadata.warnings).toEqual([]);
    expect(opened.metadata.machine?.heightMm).toBe(expected);
  });

  it.each([
    ['zero string', '0', '"0"'],
    ['zero number', 0, '"0"'],
    ['negative string', '-5', '"-5"'],
    ['negative number', -1, '"-1"'],
    ['empty string', '', '""'],
    ['blank string', '   ', '"   "'],
    ['non-numeric string', '250mm', '"250mm"'],
    ['Infinity string', 'Infinity', '"Infinity"'],
    ['NaN string', 'NaN', '"NaN"'],
    ['a boolean', true, '"true"'],
    ['an array', ['250'], '"250"'],
    ['null', null, '"null"']
  ])('%s → machine kept, no height, warning', async (_label, height, shown) => {
    const opened = await openGcode3mf(project({ printable_area: RECT, printable_height: height }));
    expect(opened.metadata.machine?.bed).toEqual({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 200, y: 180 } });
    expect(opened.metadata.machine?.heightMm).toBeUndefined();
    expect(opened.metadata.warnings).toEqual([
      { code: INVALID, message: `printable_height ${shown} is not a positive number; ignored` }
    ]);
  });

  it('a JSON overflow number (1e999 parses to Infinity) → no height, warning', async () => {
    const text = `{"printable_area":${JSON.stringify(RECT)},"printable_height":1e999}`;
    const opened = await openGcode3mf(projectText(text));
    expect(opened.metadata.machine?.heightMm).toBeUndefined();
    expect(opened.metadata.warnings).toEqual([
      { code: INVALID, message: 'printable_height "Infinity" is not a positive number; ignored' }
    ]);
    expect(opened.metadata.raw['printable_height']).toBe('Infinity');
  });

  it('the shown value is cut to 80 characters', async () => {
    const opened = await openGcode3mf(project({ printable_area: RECT, printable_height: 'x'.repeat(200) }));
    expect(opened.metadata.warnings).toEqual([
      { code: INVALID, message: `printable_height "${'x'.repeat(79)} is not a positive number; ignored` }
    ]);
  });

  it('absent → no height and no warning', async () => {
    const opened = await openGcode3mf(project({ printable_area: RECT }));
    expect(opened.metadata.machine?.heightMm).toBeUndefined();
    expect(opened.metadata.warnings).toEqual([]);
  });

  it('a bad height without a bed is not read (no machine, no warning)', async () => {
    const opened = await openGcode3mf(project({ printable_height: '-1' }));
    expect(opened.metadata.machine).toBeUndefined();
    expect(opened.metadata.warnings).toEqual([]);
  });
});

describe('machine geometry shape', () => {
  it('a full machine: rect bed from out-of-order corners, origin, confidence, source', async () => {
    const opened = await openGcode3mf(
      project({
        printable_area: ['-10x200', '-10x-5', '250x200', '250x-5'],
        printable_height: '300',
        printer_model: 'X1C'
      })
    );
    expect(opened.metadata.machine).toEqual({
      bed: { kind: 'rect', min: { x: -10, y: -5 }, max: { x: 250, y: 200 } },
      origin: { x: 0, y: 0 },
      heightMm: 300,
      printerName: 'X1C',
      confidence: 'known',
      source: { adapterId: 'gcode-3mf', evidence: 'Metadata/project_settings.config printable_area' }
    });
  });

  it.each([
    ['one x off the extremes', ['0x0', '10x0', '5x10', '0x10']],
    ['one y off the extremes', ['0x0', '10x0', '10x10', '0x5']],
    ['five points on the rect corners', ['0x0', '10x0', '10x10', '0x10', '0x0']],
    ['three points', ['0x0', '10x0', '10x10']]
  ])('%s → polygon with the points as given', async (_label, area) => {
    const opened = await openGcode3mf(project({ printable_area: area }));
    const bed = opened.metadata.machine?.bed;
    expect(bed?.kind).toBe('polygon');
    expect(bed?.kind === 'polygon' ? bed.points.map((p) => `${p.x}x${p.y}`) : []).toEqual(area);
  });

  it('decimal and negative coordinates are read exactly', async () => {
    const opened = await openGcode3mf(project({ printable_area: ['-0.5x0.25', '10x-1.75', '10x10'] }));
    expect(opened.metadata.machine?.bed).toEqual({
      kind: 'polygon',
      points: [
        { x: -0.5, y: 0.25 },
        { x: 10, y: -1.75 },
        { x: 10, y: 10 }
      ]
    });
  });

  it('whitespace around a point is accepted', async () => {
    const opened = await openGcode3mf(project({ printable_area: ' 0x0 , 10x0,10x10 ,0x10' }));
    expect(opened.metadata.machine?.bed).toEqual({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 10, y: 10 } });
  });

  it.each([
    ['printer_model wins', { printer_model: 'A', printer_settings_id: 'B' }, 'A'],
    ['non-string printer_model → printer_settings_id', { printer_model: 5, printer_settings_id: 'B' }, 'B'],
    ['only printer_settings_id', { printer_settings_id: 'B' }, 'B'],
    ['neither is a string', { printer_model: ['A'], printer_settings_id: 7 }, undefined]
  ])('printerName: %s', async (_label, names, expected) => {
    const opened = await openGcode3mf(project({ printable_area: RECT, ...names }));
    expect(opened.metadata.machine?.printerName).toBe(expected);
  });
});

describe('settings that are not a JSON object', () => {
  it.each([
    ['null', 'null'],
    ['an array', '[{"printable_area":"0x0,1x0,1x1"}]'],
    ['a number', '42'],
    ['a string', '"printable_area"']
  ])('%s → no metadata, one warning, plate still opens', async (_label, text) => {
    const opened = await openGcode3mf(projectText(text));
    expect(opened.metadata.machine).toBeUndefined();
    expect(opened.metadata.filaments).toBeUndefined();
    expect(opened.metadata.raw).toEqual({});
    expect(opened.metadata.warnings).toEqual([
      { code: INVALID, message: 'project_settings.config unreadable: not a JSON object' }
    ]);
    expect(opened.plates.map((p) => p.name)).toEqual(['Metadata/plate_1.gcode']);
  });

  it('malformed JSON → the parser message in the warning', async () => {
    const opened = await openGcode3mf(projectText('{"printable_area":'));
    expect(opened.metadata.warnings).toHaveLength(1);
    expect(opened.metadata.warnings[0].code).toBe(INVALID);
    expect(opened.metadata.warnings[0].message.startsWith('project_settings.config unreadable: ')).toBe(true);
  });
});

describe('raw whitelist', () => {
  it('copies exactly the 8 whitelisted keys; numbers and arrays become strings', async () => {
    const opened = await openGcode3mf(
      project({
        printer_model: 'X1C',
        printer_settings_id: 'Bambu X1C 0.4',
        print_settings_id: '0.20mm',
        printable_height: 250,
        nozzle_diameter: ['0.4', '0.6'],
        filament_type: ['PLA', 'PETG'],
        filament_colour: ['#FF0000', '#00FF00'],
        version: '01.09.00.00',
        printable_area: RECT,
        secret_token: 'leak'
      })
    );
    expect(opened.metadata.raw).toEqual({
      printer_model: 'X1C',
      printer_settings_id: 'Bambu X1C 0.4',
      print_settings_id: '0.20mm',
      printable_height: '250',
      nozzle_diameter: '0.4,0.6',
      filament_type: 'PLA,PETG',
      filament_colour: '#FF0000,#00FF00',
      version: '01.09.00.00'
    });
  });

  it('bounds: strings cut at 4096 chars, arrays at 64 items then 4096 chars; objects and booleans skipped', async () => {
    const opened = await openGcode3mf(
      project({
        printer_model: 'm'.repeat(5000),
        filament_type: Array.from({ length: 70 }, (_, i) => `T${i}`),
        nozzle_diameter: Array.from({ length: 64 }, () => 'n'.repeat(100)),
        version: { major: 1 },
        print_settings_id: true
      })
    );
    expect(opened.metadata.raw['printer_model']).toBe('m'.repeat(4096));
    expect(opened.metadata.raw['filament_type']).toBe(Array.from({ length: 64 }, (_, i) => `T${i}`).join(','));
    expect(opened.metadata.raw['nozzle_diameter']).toHaveLength(4096);
    expect('version' in opened.metadata.raw).toBe(false);
    expect('print_settings_id' in opened.metadata.raw).toBe(false);
  });
});

describe('filaments', () => {
  it('filamentColoursFromSettings (public, read by the model renderer) keeps at most 64 slots', () => {
    const colours = Array.from({ length: 70 }, (_, i) => `#${String(i).padStart(6, '0')}`);
    const out = filamentColoursFromSettings({ filament_colour: colours });
    expect(out).toHaveLength(64);
    expect(out[63]).toBe('#000063');
  });

  it('slots are capped at 64; a colour slot past the palette is undefined', async () => {
    const opened = await openGcode3mf(
      project({
        filament_type: Array.from({ length: 70 }, () => 'PLA'),
        filament_colour: ['#111111', 3, '#333333']
      })
    );
    const f = opened.metadata.filaments ?? [];
    expect(f).toHaveLength(64);
    expect(f[0]).toEqual({ slot: 0, type: 'PLA', color: '#111111' });
    expect(f[1]).toEqual({ slot: 1, type: 'PLA', color: undefined });
    expect(f[2]).toEqual({ slot: 2, type: 'PLA', color: '#333333' });
    expect(f[63]).toEqual({ slot: 63, type: 'PLA', color: undefined });
  });
});

describe('plate numbers come from the canonical entry name', () => {
  const build = (names: string[], extra: BuildEntry[] = []): Uint8Array =>
    buildZip([...names.map((name) => ({ name, data: `; ${name}\n`, deflate: true })), ...extra]).bytes;

  it('plates sort numerically (2 before 10), not by name', async () => {
    const opened = await openGcode3mf(
      build(['Metadata/plate_10.gcode', 'Metadata/plate_2.gcode', 'Metadata/plate_1.gcode'])
    );
    expect(opened.plates).toEqual([
      { index: 0, name: 'Metadata/plate_1.gcode', estimatedBytes: 25 },
      { index: 1, name: 'Metadata/plate_2.gcode', estimatedBytes: 25 },
      { index: 2, name: 'Metadata/plate_10.gcode', estimatedBytes: 26 }
    ]);
  });

  it('backslash and doubled-slash names keep their number for order and thumbnails', async () => {
    const opened = await openGcode3mf(
      build(
        ['Metadata\\plate_3.gcode', 'METADATA//plate_2.gcode', 'Metadata/plate_1.gcode'],
        [
          { name: 'Metadata/plate_2.png', data: png(7, 5) },
          { name: 'Metadata/plate_3.png', data: png(9, 4) },
          { name: 'Metadata/plate_0.png', data: png(1, 1) }
        ]
      )
    );
    expect(opened.plates.map((p) => p.name)).toEqual([
      'Metadata/plate_1.gcode',
      'METADATA//plate_2.gcode',
      'Metadata\\plate_3.gcode'
    ]);
    expect((await opened.thumbnailsFor(0)).thumbnails).toEqual([]);
    const two = await opened.thumbnailsFor(1);
    expect(two.thumbnails.map((t) => [t.width, t.height])).toEqual([[7, 5]]);
    const three = await opened.thumbnailsFor(2);
    expect(three.thumbnails.map((t) => [t.width, t.height])).toEqual([[9, 4]]);
  });
});
