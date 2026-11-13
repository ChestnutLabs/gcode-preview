// @vitest-environment happy-dom
/**
 * #518: segments a renderer skips for an Infinity/NaN coordinate reach the consumer through core's
 * `disclosure` text, in 2D and 3D. The literal strings are the contract.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder } from '@chestnutlabs/toolpath-core';
import { createPreviewController, LayerView2DRenderer, type PreviewEvent, type PreviewRendererEvent } from '../index';
import { SuiteStubWorker, makeNonFiniteTestIR, makeSuiteStubGL } from '../testing';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

type BuildComplete = Extract<PreviewEvent, { type: 'buildComplete' }>;
const builds = (events: PreviewEvent[]): BuildComplete[] =>
  events.filter((e): e is BuildComplete => e.type === 'buildComplete');

function controller2D(ir?: () => ReturnType<typeof makeNonFiniteTestIR>) {
  const canvas = document.createElement('canvas');
  const c = createPreviewController({
    createWorker: () => new SuiteStubWorker(undefined, ir),
    renderer: { mode: '2d' }
  });
  c.bindCanvas(canvas);
  return c;
}

function controller3D(ir?: () => ReturnType<typeof makeNonFiniteTestIR>) {
  const canvas = document.createElement('canvas');
  const c = createPreviewController({
    createWorker: () => new SuiteStubWorker(undefined, ir),
    renderer: { quality: 'lines', createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (cb) => cb() }
  });
  c.bindCanvas(canvas);
  return c;
}

describe('2D: buildComplete + non-finite disclosure (#518)', () => {
  it('one buildComplete per parse, with values true for 2D, and the literal disclosure', async () => {
    const c = controller2D(makeNonFiniteTestIR);
    const events: PreviewEvent[] = [];
    c.onEvent((e) => events.push(e));
    expect(c.getState().activeQuality).toBeNull();

    await c.parse(new Uint8Array(1_000));
    await settle();
    expect(builds(events).length).toBe(1);
    expect(JSON.stringify(builds(events)[0])).toBe(
      JSON.stringify({
        type: 'buildComplete',
        segments: 10,
        decimationApplied: 1,
        travelHidden: false,
        quality: 'lines',
        skippedNonFinite: 3
      })
    );
    expect(c.getState().disclosure).toBe('3 segments with a non-finite coordinate were not drawn.');
    expect(c.getState().activeQuality).toBe('lines');

    await c.parse(new Uint8Array(1_000));
    await settle();
    expect(builds(events).length).toBe(2);
    c.dispose();
  });

  it('build-complete follows parse-complete, and its handler reads the new file state', async () => {
    const c = controller2D(makeNonFiniteTestIR);
    const order: string[] = [];
    const seen: string[] = [];
    c.onEvent((e) => {
      if (e.type !== 'parse-complete' && e.type !== 'buildComplete') return;
      order.push(e.type);
      if (e.type === 'buildComplete') {
        const st = c.getState();
        seen.push(`layers ${st.layerCount} segments ${st.segmentCount} summary ${st.summary?.segments}`);
      }
    });
    await c.parse(new Uint8Array(1_000));
    await settle();
    expect(JSON.stringify(order)).toBe(JSON.stringify(['parse-complete', 'buildComplete']));
    expect(JSON.stringify(seen)).toBe(JSON.stringify(['layers 2 segments 13 summary 13']));
    c.dispose();
  });

  it('scrubbing, progress, travel and color changes are not builds', async () => {
    const c = controller2D(makeNonFiniteTestIR);
    const events: PreviewEvent[] = [];
    c.onEvent((e) => events.push(e));
    await c.parse(new Uint8Array(1_000));
    await settle();
    expect(builds(events).length).toBe(1);
    c.controls.setLayerRange(0, 0);
    c.controls.setLayerRange(0, 1);
    c.clearProgress();
    c.controls.setKindVisible('travel', false);
    c.controls.setColorMode({ mode: 'single', color: [1, 1, 1] });
    await settle();
    expect(builds(events).length).toBe(1);
    c.dispose();
  });

  it('a well-formed IR: one buildComplete, nothing skipped, an empty disclosure', async () => {
    const c = controller2D();
    const events: PreviewEvent[] = [];
    c.onEvent((e) => events.push(e));
    await c.parse(new Uint8Array(1_000));
    await settle();
    expect(builds(events).length).toBe(1);
    expect(builds(events)[0].segments).toBe(12);
    expect(builds(events)[0].skippedNonFinite).toBe(0);
    expect(c.getState().disclosure).toBe('');
    c.dispose();
  });

  it('the adapter counts the whole toolpath: travel included, wipe and z ignored', async () => {
    const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    const seg = { y0: 0, z0: 0.2, x1: 1, y1: 0, z1: 0.2, e: 1, layer: 0 };
    // The first segment fixes the builder's floating origin, so it must be finite.
    b.addSegment({ ...seg, x0: 0, kind: MoveKind.Extrude, srcByte: 0 }); // drawn
    b.addSegment({ ...seg, x0: Infinity, kind: MoveKind.Extrude, srcByte: 5 }); // skipped
    b.addSegment({ ...seg, x0: 0, y1: NaN, kind: MoveKind.Travel, srcByte: 10 }); // skipped
    b.addSegment({ ...seg, x0: NaN, kind: MoveKind.Wipe, srcByte: 20 }); // never drawn in 2D: not counted
    b.addSegment({ ...seg, x0: 0, z1: Infinity, kind: MoveKind.Extrude, srcByte: 30 }); // drawn (z ignored)
    b.addSegment({ ...seg, x0: 0, kind: MoveKind.Extrude, layer: 1, srcByte: 40 }); // another layer, drawn
    const r = new LayerView2DRenderer(document.createElement('canvas'));
    const events: PreviewRendererEvent[] = [];
    r.onEvent((e) => events.push(e));
    r.setIR(b.finalize());
    expect(events.filter((e) => e.type === 'buildComplete').length).toBe(0); // deferred one microtask
    await Promise.resolve();
    const done = events.filter((e) => e.type === 'buildComplete');
    expect(done.length).toBe(1);
    expect(JSON.stringify(done[0])).toBe(
      JSON.stringify({
        type: 'buildComplete',
        segments: 3,
        decimationApplied: 1,
        travelHidden: false,
        quality: 'lines',
        skippedNonFinite: 2
      })
    );
    r.dispose();
  });

  it('a superseded or disposed setIR never reports a build', async () => {
    const r = new LayerView2DRenderer(document.createElement('canvas'));
    const segs: number[] = [];
    r.onEvent((e) => {
      if (e.type === 'buildComplete') segs.push(e.segments);
    });
    r.setIR(makeNonFiniteTestIR()); // 10 drawable, superseded in the same tick
    const clean = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
    clean.addSegment({
      x0: 0,
      y0: 0,
      z0: 0.2,
      x1: 1,
      y1: 0,
      z1: 0.2,
      e: 1,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: 0
    });
    r.setIR(clean.finalize()); // 1 drawable: the current build
    await Promise.resolve();
    expect(JSON.stringify(segs)).toBe('[1]');

    r.setIR(makeNonFiniteTestIR());
    r.dispose(); // before the microtask: no report
    await Promise.resolve();
    expect(JSON.stringify(segs)).toBe('[1]');
  });
});

describe('3D: non-finite disclosure (#518)', () => {
  it('the real three.js build reports x/y/z skips, and core names the count', async () => {
    const c = controller3D(makeNonFiniteTestIR);
    const events: PreviewEvent[] = [];
    c.onEvent((e) => events.push(e));
    await c.parse(new Uint8Array(1_000));
    await settle();
    expect(builds(events).length).toBe(1);
    expect(builds(events)[0].segments).toBe(9);
    expect(builds(events)[0].skippedNonFinite).toBe(4);
    expect(c.getState().disclosure).toBe('4 segments with a non-finite coordinate were not drawn.');
    c.dispose();
  });

  it('singular, combined with decimation, and a renderer that omits the field', async () => {
    const c = controller3D();
    await c.parse(new Uint8Array(1_000));
    await settle();
    const r = c.raw.renderer() as unknown as { emit(e: unknown): void };
    const emit = (extra: object): void =>
      r.emit({
        type: 'buildComplete',
        segments: 9,
        decimationApplied: 1,
        travelHidden: false,
        quality: 'lines',
        ...extra
      });

    emit({ skippedNonFinite: 1 });
    expect(c.getState().disclosure).toBe('1 segment with a non-finite coordinate was not drawn.');

    emit({ skippedNonFinite: 2, decimationApplied: 3, travelHidden: true });
    expect(c.getState().disclosure).toBe(
      'Showing every 3rd drawn segment (layer boundaries kept); travel hidden. 9 segments drawn. ' +
        '2 segments with a non-finite coordinate were not drawn.'
    );

    emit({ decimationApplied: 2 });
    expect(c.getState().disclosure).toBe(
      'Showing every 2nd drawn segment (layer boundaries kept); travel hidden. 9 segments drawn.'
    );

    // Grouped like the decimation sentence (toLocaleString). Any host grouping separator is accepted; on a
    // host whose locale groups four digits (CI: en-US, "1,234") the ungrouped "1234" fails the second check.
    emit({ skippedNonFinite: 1234 });
    const text = c.getState().disclosure;
    expect(/^1[,.\u00a0\u202f']?234 segments with a non-finite coordinate were not drawn\.$/.test(text)).toBe(true);
    expect(text).toBe(`${(1234).toLocaleString()} segments with a non-finite coordinate were not drawn.`);

    emit({});
    expect(c.getState().disclosure).toBe('');
    c.dispose();
  });
});
