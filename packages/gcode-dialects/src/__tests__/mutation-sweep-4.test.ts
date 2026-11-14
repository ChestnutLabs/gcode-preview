/**
 * Mutation sweep 4 (G1, 2026-11, pass 2), test-only coverage: the clauses of EXISTING dialect code that
 * sweeps 1 and 3 (#506, #536) and the regex lanes (#472, #476) left unguarded. One test per clause a
 * source mutant showed was unguarded. Expected values are literals.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, type DialectMetadata } from '@chestnutlabs/toolpath-core';
import { applyMarkerRanges, segAtOrAfterByte } from '../annotate';
import { prusaSlicer } from '../prusaslicer';
import { cura } from '../cura';
import { ideaMaker } from '../ideamaker';
import { simplify3d } from '../simplify3d';
import { klipper, marlin, repRap } from '../firmware';
import {
  CURA,
  E,
  G,
  IDEAMAKER,
  PRUSA,
  S3D,
  T,
  annotate,
  applied,
  customAdapter,
  irOf,
  line,
  machine,
  must,
  png
} from './sweep-4-helpers';

describe('sink and settings guards (sweep)', () => {
  it('gap placeholders carry their own 1-based ids', () => {
    expect(applied((s) => s.defineObject(3, 'c')).ir.objects).toEqual([
      { id: '1' },
      { id: '2' },
      { id: '3', name: 'c' }
    ]);
  });

  it('a reversed range does not use the op budget', () => {
    const r = applied((s) => {
      for (let i = 0; i < 1_000_000; i++) s.setFeature(3, 1, 1);
      s.setFeature(0, 0, 4);
    });
    expect(r.ir.segments.feature[0]).toBe(4);
    expect(r.warn('dialect-annotation-truncated')).toEqual([]);
  });

  it('a five-point axis-aligned outline is a polygon, not a rect', () => {
    const r = must(annotate([prusaSlicer()], [PRUSA, ...G, '; bed_shape = 0x0,250x0,250x210,0x210,0x0']));
    expect(r.metadata?.machine?.bed.kind).toBe('polygon');
  });

  it('settings keys are matched case-insensitively', () => {
    const r = must(annotate([prusaSlicer()], [PRUSA, ...G, '; BED_SHAPE = 0x0,250x0,250x210,0x210']));
    expect(r.metadata?.machine?.bed).toEqual({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 250, y: 210 } });
  });
});

describe('sink.apply writes (sweep)', () => {
  it('a move-kind bit is ORed onto the motion kind, and 0 bits are rejected', () => {
    const r = applied((s) => {
      s.addMoveKind(0, 1, MoveKind.Wipe);
      s.addMoveKind(2, 3, 0);
    });
    expect(Array.from(r.ir.segments.kind)).toEqual([17, 17, 1, 1]);
    expect(r.warn('dialect-kind-not-allowlisted').length).toBe(1);
  });

  it('objectBounds: every axis from starts or from ends, in absolute coordinates, extrusions only', () => {
    for (const seg of [
      [101, 102, 103, 104, 105, 106],
      [104, 105, 106, 101, 102, 103]
    ]) {
      const [a, b, c, d, e, f] = seg;
      const ir = irOf([
        [100, 100, 100, 100, 100, 100, T],
        [a, b, c, d, e, f, E],
        [0, 0, 0, 500, 500, 500, T]
      ]);
      const r = applied((s) => s.setObject(0, 2, 1), ir);
      expect(r.ir.objectBounds).toEqual({ min: { x: 101, y: 102, z: 103 }, max: { x: 104, y: 105, z: 106 } });
    }
  });

  it('tools: an existing entry is enriched in place, in id order, and keeps fields that are not given', () => {
    const ir = irOf(line(2));
    ir.tools.push({ id: 1, material: 'PETG' });
    const r = applied((s) => {
      s.setToolInfo(2, { material: 'TPU' });
      s.setToolInfo(1, { colorHex: '#000000' });
      s.setToolInfo(0, { material: 'PLA' });
    }, ir);
    expect(r.ir.tools).toEqual([
      { id: 0, material: 'PLA' },
      { id: 1, material: 'PETG', color: { r: 0, g: 0, b: 0, a: 1 } },
      { id: 2, material: 'TPU' }
    ]);
  });

  it('metadata from a second adapter adds to the first; the first estimate and usage stay', () => {
    const md: DialectMetadata = { dialects: [] };
    const src = { adapterId: 'a', evidence: 'e' };
    applied(
      (s) => {
        s.setFilament({ slot: 0 });
        s.addThumbnail(png(1));
        s.setRaw('a', '1');
        s.setPrintEstimate({ seconds: 10, source: src });
        s.setFilamentUsage({ lengthMm: 1, source: src });
        s.setFilamentUsage({ volumeCm3: 2, source: src });
      },
      irOf(line(2)),
      md
    );
    applied(
      (s) => {
        s.setFilament({ slot: 1 });
        s.addThumbnail(png(2));
        s.setRaw('b', '2');
        s.setPrintEstimate({ seconds: 99, source: src });
      },
      irOf(line(2)),
      md
    );
    expect(md.filaments).toEqual([{ slot: 0 }, { slot: 1 }]);
    expect(md.thumbnails?.map((t) => t.bytes[0])).toEqual([1, 2]);
    expect(md.raw).toEqual({ a: '1', b: '2' });
    expect(md.printEstimate?.seconds).toBe(10);
    expect(md.filamentUsage).toEqual({ lengthMm: 1, volumeCm3: 2, weightG: undefined, source: src });
  });
});

describe('annotation helpers (sweep)', () => {
  it('segAtOrAfterByte past the last command is the segment count', () => {
    expect(segAtOrAfterByte(irOf(line(4)), 1e9)).toBe(4);
  });

  it('applyMarkerRanges counts only ranges that cover a segment', () => {
    const writes: number[][] = [];
    const n = applyMarkerRanges(
      irOf(line(4)),
      [
        { srcByte: 0, value: 1 },
        { srcByte: 0, value: 2 },
        { srcByte: 25, value: 3 }
      ],
      (a, b, v) => writes.push([a, b, v])
    );
    expect(n).toBe(2);
    expect(writes).toEqual([
      [0, 2, 2],
      [3, 3, 3]
    ]);
  });

  it('an empty wipe bracket (no motion inside) claims no wipe moves', () => {
    const mid = must(annotate([prusaSlicer()], [PRUSA, ...G, ';WIPE_START', ';WIPE_END']));
    expect(mid.ir.header.capabilities.wipeMoves).not.toBe('known');
    const eof = must(annotate([prusaSlicer()], [PRUSA, ...G, ';WIPE_START']));
    expect(eof.ir.header.capabilities.wipeMoves).not.toBe('known');
  });
});

describe('object-marker names (sweep)', () => {
  const names = (marker: string) =>
    must(annotate([prusaSlicer()], [PRUSA, marker, ...G, '; stop printing object'])).ir.objects.map((o) => o.name);
  it('a lone quote is a name; two quoted parts keep their quotes; no name defines no object', () => {
    expect(names('; printing object " id:3 copy 0')).toEqual(['"']);
    expect(names('; printing object "a" and "b" id:3 copy 0')).toEqual(['"a" and "b"']);
    expect(names('; printing object id:3 copy 0')).toEqual([]);
  });

  it('the first name seen for an id wins', () => {
    const r = must(
      annotate(
        [prusaSlicer()],
        [PRUSA, '; printing object A id:3', 'G1 X0 Y0', 'G1 X10 Y0 E1', '; printing object B id:3', 'G1 X10 Y10 E2']
      )
    );
    expect(r.ir.objects).toEqual([{ id: '1', name: 'A' }]);
  });
});

describe('registry (sweep)', () => {
  it('an explicit selection runs only the named adapters', () => {
    expect(annotate([prusaSlicer(), cura()], [PRUSA, ...G], ['cura'])).toBeNull();
    expect(must(annotate([prusaSlicer(), cura()], [PRUSA, ...G], ['prusaslicer'])).ir.header.dialects).toEqual([
      { id: 'prusaslicer', confidence: 'known' }
    ]);
  });

  it('a machine conflict between two adapters reaches the IR warnings', () => {
    const set = (id: string, size: number, kind: 'slicer' | 'firmware') => ({
      ...customAdapter((_ir, sink) => sink.setMachine(machine(size)), id),
      kind,
      detect: () => ({ dialectId: id, kind, confidence: 'known' as const, evidence: 'test' })
    });
    const r = must(annotate([set('a', 200, 'slicer'), set('b', 300, 'firmware')], G));
    expect(r.messages('dialect-conflict')).toEqual(["adapter 'b' overwrote machine geometry"]);
  });
});

describe('firmware object markers (sweep)', () => {
  it('Klipper: DEFINE order sets the values; a nameless START opens nothing; END closes', () => {
    const r = must(
      annotate(
        [klipper()],
        [
          'EXCLUDE_OBJECT_DEFINE NAME=b',
          'EXCLUDE_OBJECT_DEFINE NAME=a',
          'EXCLUDE_OBJECT_START NAME=a',
          'G1 X0 Y0',
          'G1 X10 Y0 E1',
          'EXCLUDE_OBJECT_END NAME=a',
          'G1 X10 Y10 E2',
          'EXCLUDE_OBJECT_START',
          'G1 X0 Y10 E3'
        ]
      )
    );
    expect(Array.from(r.ir.segments.object)).toEqual([2, 2, 0, 0]);
    expect(r.ir.objects).toEqual([
      { id: '1', name: 'b' },
      { id: '2', name: 'a' }
    ]);
  });

  it('Klipper with no object markers claims no objects', () => {
    const r = must(annotate([klipper()], ['SET_VELOCITY_LIMIT VELOCITY=100', ...G]));
    expect(r.ir.header.capabilities.objects).not.toBe('known');
  });

  it('Marlin: S0 is an object, an M486 without S changes nothing', () => {
    const r = must(
      annotate([marlin()], [';FLAVOR:Marlin', 'M486 S0', 'G1 X0 Y0', 'G1 X10 Y0 E1', 'M486 T3', 'G1 X10 Y10 E2'])
    );
    expect(Array.from(r.ir.segments.object)).toEqual([1, 1, 1]);
  });

  it('tail-only flavour detection is inferred for Marlin and RepRap, known for Klipper', () => {
    const tail = (flavor: string) => ({ headText: 'G1 X0', tailText: `; gcode_flavor = ${flavor}` });
    expect(marlin().detect(tail('marlin'))?.confidence).toBe('inferred');
    expect(repRap().detect(tail('reprap'))?.confidence).toBe('inferred');
    expect(klipper().detect(tail('klipper'))?.confidence).toBe('known');
  });
});

describe('Cura, Simplify3D and ideaMaker (sweep)', () => {
  it('Cura: an unknown TYPE is Custom (10); a known one maps; the printer name is kept', () => {
    const r = must(
      annotate(
        [cura()],
        [
          CURA,
          ';TARGET_MACHINE.NAME: Ender 3',
          ';TYPE:SPARKLES',
          'G1 X0 Y0',
          'G1 X10 Y0 E1',
          ';TYPE:FILL',
          'G1 X10 Y10 E2'
        ]
      )
    );
    expect(Array.from(r.ir.segments.feature)).toEqual([10, 10, 3]);
    expect(r.ir.header.capabilities.featureRoles).toBe('known');
    expect(r.metadata?.raw).toEqual({ printer_model: 'Ender 3' });
    expect(must(annotate([cura()], [CURA, '; target_machine = Ender 5', ...G])).metadata?.raw).toEqual({
      printer_model: 'Ender 5'
    });
  });

  it('Cura with no TYPE comments claims no feature roles', () => {
    expect(must(annotate([cura()], [CURA, ...G])).ir.header.capabilities.featureRoles).not.toBe('known');
  });

  it('Simplify3D: feature names are case-insensitive, unknown ones are Custom', () => {
    const r = must(
      annotate(
        [simplify3d()],
        [S3D, '; feature Outer Perimeter', 'G1 X0 Y0', 'G1 X10 Y0 E1', '; feature glitter', 'G1 X10 Y10 E2']
      )
    );
    expect(Array.from(r.ir.segments.feature)).toEqual([2, 2, 10]);
    expect(must(annotate([simplify3d()], [S3D, ...G])).ir.header.capabilities.featureRoles).not.toBe('known');
  });

  it('ideaMaker: a name is used once; NON-OBJECT names nothing; a negative id closes the object', () => {
    const r = must(
      annotate(
        [ideaMaker()],
        [
          IDEAMAKER,
          ';PRINTING: cube',
          ';PRINTING_ID: 4',
          'G1 X0 Y0',
          'G1 X10 Y0 E1',
          ';PRINTING_ID: 5',
          'G1 X10 Y10 E2',
          ';PRINTING: NON-OBJECT',
          ';PRINTING_ID: 6',
          'G1 X0 Y10 E3',
          ';PRINTING_ID: -1',
          'G1 X0 Y0 E4'
        ]
      )
    );
    expect(Array.from(r.ir.segments.object)).toEqual([1, 1, 2, 3, 0]);
    expect(r.ir.objects).toEqual([{ id: '1', name: 'cube' }]);
    expect(must(annotate([ideaMaker()], [IDEAMAKER, ...G])).ir.header.capabilities.featureRoles).not.toBe('known');
  });
});
