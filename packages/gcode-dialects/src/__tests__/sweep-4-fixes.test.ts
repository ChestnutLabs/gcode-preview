/**
 * Sweep 4 (G1, 2026-11, pass 2): the defects this pass found, one test per fixed clause. Tool colours
 * may be 8-digit; a custom adapter's object value / tool info is validated; a throw while applying an
 * adapter rolls all of its writes back; thumbnail and budget drops, Cura `;TIME:` and zero-area beds are
 * reported. File data is never thrown on: it is dropped, bounded and reported. Expected values are literals.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, type DialectMetadata, type ThumbnailData, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { parseGcodeToIR } from '../../../gcode-parser/src/parse';
import { BufferedAnnotationSink } from '../sink';
import { hasBedArea, ThumbnailCollector } from '../annotate';
import { prusaSlicer } from '../prusaslicer';
import { orcaBambu } from '../orca-bambu';
import { cura } from '../cura';
import { marlin } from '../firmware';
import type { AnnotationSink } from '../contracts';
import {
  CURA,
  G,
  ORCA,
  PRUSA,
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

describe('tool colours: #RRGGBB and #RRGGBBAA (D1)', () => {
  it('an 8-digit colour keeps its RGB and drops the alpha', () => {
    const { ir } = applied((s) => {
      s.setToolInfo(0, { colorHex: '#FF000080' });
      s.setToolInfo(1, { colorHex: '336699' });
      s.setToolInfo(2, { colorHex: '#FF00008' });
      s.setToolInfo(3, { colorHex: '#FF0000800' });
    });
    expect(ir.tools.find((t) => t.id === 0)?.color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(ir.tools.find((t) => t.id === 1)?.color).toEqual({ r: 0.2, g: 0.4, b: 0.6, a: 1 });
    expect(ir.tools.find((t) => t.id === 2)?.color).toBeUndefined();
    expect(ir.tools.find((t) => t.id === 3)?.color).toBeUndefined();
  });

  it('Orca: an 8-digit filament_colour colours its tool', () => {
    const r = must(
      annotate([orcaBambu()], [ORCA, ...G, '; filament_colour = #00FF00FF;#0000FF', '; filament_type = PLA; PETG '])
    );
    expect(r.ir.tools.map((t) => [t.id, t.material, t.color])).toEqual([
      [0, 'PLA', { r: 0, g: 1, b: 0, a: 1 }],
      [1, 'PETG', { r: 0, g: 0, b: 1, a: 1 }]
    ]);
  });
});

describe('defineObject and setToolInfo validate their input (D2, D3)', () => {
  const INVALID = "adapter 't' defined an object with an unusable value or name; dropped";

  it('object values must be integers 1..10,000 and names strings; each bad one is reported', () => {
    for (const [id, name] of [
      [2.5, 'frac'],
      [0, 'zero'],
      [10_001, 'over'],
      [1, 7]
    ] as [number, string][]) {
      const r = applied((s) => s.defineObject(id, name));
      expect(r.ir.objects).toEqual([]);
      expect(r.warn('dialect-metadata-invalid').map((w) => w.message)).toEqual([INVALID]);
    }
    const ok = applied((s) => s.defineObject(10_000, 'last'));
    expect(ok.ir.objects.length).toBe(10_000);
    expect(ok.ir.objects[9_999]).toEqual({ id: '10000', name: 'last' });
    expect(ok.warn('dialect-metadata-invalid')).toEqual([]);
  });

  it('tool info needs an integer tool >= 0 and string fields; bad input is dropped with a warning', () => {
    const bad = [
      [Number.NaN, {}],
      [-1, {}],
      [0.5, {}],
      [0, { material: 5 }],
      [0, { colorHex: 123 }]
    ] as [number, Record<string, unknown>][];
    for (const [tool, info] of bad) {
      const r = applied((s) => s.setToolInfo(tool, info as { material?: string }));
      expect(r.ir.tools).toEqual([]);
      expect(r.warn('dialect-metadata-invalid').map((w) => w.message)).toEqual([
        "adapter 't' gave unusable tool info; dropped"
      ]);
    }
  });

  it('a file-controlled object id never reaches defineObject: M486 S50000000 is object 1', () => {
    const r = must(annotate([marlin()], [';FLAVOR:Marlin', 'M486 S50000000', ...G]));
    expect(r.ir.objects).toEqual([{ id: '1', name: 'object 50000000' }]);
  });
});

describe('sink.apply is all or nothing (OSF)', () => {
  it('a throw at the last write restores every IR and metadata field', () => {
    const ir = irOf([[0, 0, 0.2, 1, 0, 0.2, T], ...line(3)]);
    ir.objects.push({ id: '1', name: 'old' });
    ir.tools.push({ id: 0, material: 'PETG' });
    ir.header.capabilities.featureRoles = 'unavailable';
    const md: DialectMetadata = { dialects: [], filaments: [{ slot: 9 }] };
    Object.defineProperty(md, 'raw', {
      configurable: true,
      get: () => undefined,
      set: () => {
        throw new Error('boom');
      }
    });
    const before = JSON.stringify({
      f: Array.from(ir.segments.feature),
      o: Array.from(ir.segments.object),
      k: Array.from(ir.segments.kind),
      b: ir.objectBounds,
      objects: ir.objects,
      tools: ir.tools,
      caps: ir.header.capabilities,
      w: ir.header.warnings,
      md
    });
    const sink = new BufferedAnnotationSink('t');
    sink.setFeature(0, 3, 3);
    sink.setObject(1, 3, 2);
    sink.defineObject(2, 'cube');
    sink.addMoveKind(0, 3, MoveKind.Wipe);
    sink.setToolInfo(0, { material: 'PLA', colorHex: '#FF0000' });
    sink.setToolInfo(4, { material: 'TPU' });
    sink.upgradeCapability('featureRoles', 'known');
    sink.upgradeCapability('objects', 'known');
    sink.warn('w', 'x');
    sink.setMachine(machine(200));
    sink.setFilament({ slot: 0 });
    sink.setFilamentUsage({ lengthMm: 5, source: { adapterId: 't', evidence: 'e' } });
    sink.setPrintEstimate({ seconds: 5, source: { adapterId: 't', evidence: 'e' } });
    sink.addThumbnail(png(1));
    sink.setRaw('k', 'v');
    const conflicts: string[] = [];
    expect(() => sink.apply(ir, md, (c) => conflicts.push(c))).toThrow('boom');
    const after = JSON.stringify({
      f: Array.from(ir.segments.feature),
      o: Array.from(ir.segments.object),
      k: Array.from(ir.segments.kind),
      b: ir.objectBounds,
      objects: ir.objects,
      tools: ir.tools,
      caps: ir.header.capabilities,
      w: ir.header.warnings,
      md
    });
    expect(after).toBe(before);
    expect(conflicts).toEqual([]);
  });

  it('registry: an adapter that throws mid-apply leaves the no-dialect IR plus an adapter-failed warning', () => {
    const text = G.join('\n');
    const plain = parseGcodeToIR(text).ir;
    const r = must(
      annotate(
        [
          customAdapter((ir, sink) => {
            sink.setFeature(0, 2, 3);
            sink.setObject(0, 2, 1);
            sink.defineObject(1, 'x');
            sink.upgradeCapability('objects', 'known');
            sink.setToolInfo(5, { material: 'PLA' });
            // ir.tools.sort runs after the channels, bounds and objects are written.
            Object.defineProperty(ir.tools, 'sort', {
              value: () => {
                throw new Error('boom');
              }
            });
          })
        ],
        G
      )
    );
    const view = (ir: ToolpathIR) =>
      JSON.stringify({
        f: Array.from(ir.segments.feature),
        o: Array.from(ir.segments.object),
        objects: ir.objects,
        tools: ir.tools,
        ob: ir.objectBounds,
        mb: ir.modelBounds,
        caps: ir.header.capabilities
      });
    expect(view(r.ir)).toBe(view(plain));
    expect(r.messages('adapter-failed')).toEqual(["adapter 'custom' failed to apply: boom"]);
    expect(r.metadata).toEqual({
      dialects: [{ dialectId: 'custom', kind: 'slicer', confidence: 'known', evidence: 'test' }]
    });
  });
});

describe('budget and thumbnail drops are reported (D4)', () => {
  const truncated = (r: ReturnType<typeof applied>) => r.warn('dialect-annotation-truncated').map((w) => w.message);

  it('each sink budget reports once when it runs out, and never before', () => {
    expect(truncated(applied((s) => [...Array(8).keys()].forEach((i) => s.addThumbnail(png(i)))))).toEqual([]);
    expect(truncated(applied((s) => [...Array(10).keys()].forEach((i) => s.addThumbnail(png(i)))))).toEqual([
      "adapter 't' exceeded the thumbnail budget (8); further entries dropped"
    ]);
    expect(truncated(applied((s) => [...Array(513).keys()].forEach((i) => s.setRaw(`k${i}`, 'v'))))).toEqual([
      "adapter 't' exceeded the raw metadata budget (512); further entries dropped"
    ]);
    expect(truncated(applied((s) => [...Array(65).keys()].forEach((i) => s.setFilament({ slot: i }))))).toEqual([
      "adapter 't' exceeded the filament budget (64); further entries dropped"
    ]);
    expect(truncated(applied((s) => [...Array(65).keys()].forEach((i) => s.setToolInfo(i, {}))))).toEqual([
      "adapter 't' exceeded the tool info budget (64); further entries dropped"
    ]);
  });

  it('the object-name budget reports past 10,000 names', () => {
    const fill = (n: number) => (s: BufferedAnnotationSink) => {
      for (let i = 1; i <= n; i++) s.defineObject(i <= 10_000 ? i : 10_000, 'n');
    };
    const at = applied(fill(10_000));
    expect(at.warn('dialect-annotation-truncated')).toEqual([]);
    const sink = new BufferedAnnotationSink('t');
    fill(10_000)(sink);
    sink.defineObject(5, 'again');
    const ir = irOf(line(2));
    sink.apply(ir, { dialects: [] }, () => undefined);
    expect(ir.header.warnings.filter((w) => w.code === 'dialect-annotation-truncated').map((w) => w.message)).toEqual([
      "adapter 't' exceeded the object name budget (10000); further entries dropped"
    ]);
  });

  function thumbs(lines: string[], close = false) {
    const got: ThumbnailData[] = [];
    const warnings: string[] = [];
    const sink = {
      addThumbnail: (t: ThumbnailData) => got.push(t),
      warn: (code: string, message: string) => warnings.push(`${code}: ${message}`)
    } as unknown as AnnotationSink;
    const c = new ThumbnailCollector(64);
    for (const l of lines) c.feed(l, sink);
    if (close) c.close(sink);
    return { got, warnings };
  }

  it('each kind of dropped thumbnail block gives its own literal warning', () => {
    expect(thumbs(['thumbnail begin 1x1 4', 'QUJD', 'thumbnail end'])).toEqual({
      got: [{ width: 1, height: 1, mime: 'image/png', bytes: new Uint8Array([65, 66, 67]) }],
      warnings: []
    });
    expect(thumbs(['thumbnail begin 1x1 65', 'QUJD', 'thumbnail end']).warnings).toEqual([
      'dialect-metadata-invalid: thumbnail of 65 bytes is over the size cap; dropped'
    ]);
    expect(thumbs(['thumbnail begin 1x1 64', 'Q'.repeat(94), 'thumbnail end']).warnings).toEqual([
      'dialect-metadata-invalid: thumbnail data is longer than its declared size; dropped'
    ]);
    const mismatch = 'dialect-metadata-invalid: thumbnail data is mismatched, empty or not base64; dropped';
    expect(thumbs(['thumbnail begin 1x1 4', 'QUJD', 'thumbnail_JPG end'])).toEqual({ got: [], warnings: [mismatch] });
    expect(thumbs(['thumbnail begin 1x1 4', 'Q!JD', 'thumbnail end'])).toEqual({ got: [], warnings: [mismatch] });
    expect(thumbs(['thumbnail begin 1x1 4', 'QéJD', 'thumbnail end'])).toEqual({ got: [], warnings: [mismatch] });
    expect(thumbs(['thumbnail begin 1x1 4', 'thumbnail end'])).toEqual({ got: [], warnings: [mismatch] });
    const never = 'dialect-metadata-invalid: thumbnail block never ended; dropped';
    expect(
      thumbs(['thumbnail begin 1x1 4', 'QUJD', 'thumbnail begin 1x1 4', 'QUJD', 'thumbnail end']).warnings
    ).toEqual([never]);
    expect(thumbs(['thumbnail begin 1x1 4', 'QUJD'], true).warnings).toEqual([never]);
    expect(thumbs(['thumbnail end'], true).warnings).toEqual([]);
  });

  it('PrusaSlicer and Orca report a thumbnail left open at end of file', () => {
    for (const head of [PRUSA, ORCA]) {
      const r = must(
        annotate(head === PRUSA ? [prusaSlicer()] : [orcaBambu()], [head, ...G, '; thumbnail begin 1x1 4', '; QUJD'])
      );
      expect(r.messages('dialect-metadata-invalid')).toEqual(['thumbnail block never ended; dropped']);
    }
  });
});

describe('Cura ;TIME: (D5)', () => {
  const time = (v: string) => must(annotate([cura()], [CURA, `;TIME:${v}`, ...G]));
  it('an unreadable or negative value is reported; 0 is silent; a real value is kept', () => {
    for (const v of ['abc', '-5', '', '1e999']) {
      const r = time(v);
      expect(r.metadata?.printEstimate).toBeUndefined();
      expect(r.messages('dialect-metadata-invalid')).toEqual([`TIME value '${v}' unreadable; dropped`]);
    }
    expect(time('0').codes).not.toContain('dialect-metadata-invalid');
    expect(time('0').metadata?.printEstimate).toBeUndefined();
    expect(time('42').metadata?.printEstimate?.seconds).toBe(42);
  });
});

describe('beds that enclose no area (D6)', () => {
  it('hasBedArea: zero, collinear and overflowing outlines have none', () => {
    const p = (...xy: number[]) =>
      xy.reduce<{ x: number; y: number }[]>(
        (a, v, i) => (i % 2 ? ((a[a.length - 1].y = v), a) : [...a, { x: v, y: 0 }]),
        []
      );
    expect(hasBedArea(p(0, 0, 250, 0, 250, 210, 0, 210))).toBe(true);
    expect(hasBedArea(p(0, 0, 0, 0, 0, 0, 0, 0))).toBe(false);
    expect(hasBedArea(p(0, 0, 10, 0, 20, 0))).toBe(false);
    expect(hasBedArea(p(0, 0, 1e200, 0, 1e200, 1e200))).toBe(false);
    expect(hasBedArea(p(0, 0, 10, 0, 0, 10))).toBe(true); // the closing edge counts
  });

  it('PrusaSlicer / Orca drop a zero-area bed with a warning, not a machine', () => {
    const pr = must(annotate([prusaSlicer()], [PRUSA, ...G, '; bed_shape = 0x0,0x0,0x0,0x0']));
    expect(pr.metadata?.machine).toBeUndefined();
    expect(pr.messages('dialect-metadata-invalid')).toEqual(['bed_shape encloses no area; dropped']);
    expect(pr.codes).not.toContain('dialect-bed-unparsed');
    const or = must(annotate([orcaBambu()], [ORCA, ...G, '; printable_area = 0x0,10x0,20x0']));
    expect(or.metadata?.machine).toBeUndefined();
    expect(or.messages('dialect-metadata-invalid')).toEqual(['printable_area encloses no area; dropped']);
  });

  it('hasBedArea counts the closing edge (the open polyline here sums to zero)', () => {
    expect(
      hasBedArea([
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 1, y: 2 }
      ])
    ).toBe(true);
  });
});
