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

  it('the adapter counts the whole toolpath: travel included, wipe and z ignored', () => {
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
      'Showing every 3rd extrusion segment (layer boundaries kept); travel hidden. 9 segments drawn. ' +
        '2 segments with a non-finite coordinate were not drawn.'
    );

    emit({ decimationApplied: 2 });
    expect(c.getState().disclosure).toBe(
      'Showing every 2nd extrusion segment (layer boundaries kept); travel hidden. 9 segments drawn.'
    );

    emit({});
    expect(c.getState().disclosure).toBe('');
    c.dispose();
  });
});
