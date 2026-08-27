// @vitest-environment happy-dom
/**
 * DD-029 Phase A — the renderer-emitted `stage` events (building-geometry / preparing-gpu / ready).
 * `parsing`/`classifying` are core's to emit; here we assert the renderer's three stages, the real
 * building-geometry fraction, and that `ready` coincides with `buildComplete` (never before it).
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type GLRendererLike, type RendererEvent } from '../index.js';

function makeIR(layers: number, perLayer: number): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  let src = 0;
  for (let l = 0; l < layers; l++) {
    for (let s = 0; s < perLayer; s++) {
      b.addSegment({
        x0: 100 + s,
        y0: 100,
        z0: 0.2 * (l + 1),
        x1: 101 + s,
        y1: 100,
        z1: 0.2 * (l + 1),
        e: 1,
        kind: MoveKind.Extrude,
        layer: l,
        srcByte: src++ * 10
      });
    }
  }
  return b.finalize();
}

function makeRenderer(chunksPerTick = 1) {
  const canvas = document.createElement('canvas');
  const stub: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  const ticks: (() => void)[] = [];
  const events: RendererEvent[] = [];
  const renderer = new ToolpathRenderer({
    canvas,
    chunksPerTick,
    quality: 'lines',
    createRenderer: () => stub,
    scheduleFrame: (cb) => ticks.push(cb)
  });
  renderer.onEvent((e) => events.push(e));
  return {
    renderer,
    events,
    runTicks: () => {
      while (ticks.length > 0) ticks.shift()?.();
    }
  };
}

describe('DD-029 staged progress (renderer stages)', () => {
  it('emits building-geometry (with real fraction) → preparing-gpu → ready, in order', () => {
    // A small target forces multiple chunks so building-geometry reports a real intermediate fraction.
    const { renderer, events, runTicks } = makeRenderer(1);
    renderer.setLayerRange(0, Infinity);
    renderer.setIR(makeIR(4, 3));
    runTicks();

    const stages = events.filter((e) => e.type === 'stage').map((e) => (e as { stage: string }).stage);
    // building-geometry appears (one per tick), then the two completion stages, in order.
    expect(stages).toContain('building-geometry');
    expect(stages).toContain('preparing-gpu');
    expect(stages[stages.length - 1]).toBe('ready');
    expect(stages.indexOf('building-geometry')).toBeLessThan(stages.indexOf('preparing-gpu'));
    expect(stages.indexOf('preparing-gpu')).toBeLessThan(stages.indexOf('ready'));

    // building-geometry carries a monotonic fraction rising to 1 with matching counts.
    const bg = events.filter(
      (e): e is Extract<RendererEvent, { type: 'stage' }> => e.type === 'stage' && e.stage === 'building-geometry'
    );
    expect(bg.length).toBeGreaterThan(0);
    const fractions = bg.map((e) => e.progress ?? -1);
    for (let i = 1; i < fractions.length; i++) expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
    expect(fractions[fractions.length - 1]).toBe(1);
    const last = bg[bg.length - 1];
    expect(last.detail).toEqual({ built: last.detail!.total, total: last.detail!.total });
  });

  it('ready coincides with buildComplete — never before it', () => {
    const { renderer, events, runTicks } = makeRenderer(2);
    renderer.setIR(makeIR(3, 4));
    runTicks();

    const types = events.map((e) => e.type);
    const readyIdx = events.findIndex((e) => e.type === 'stage' && (e as { stage: string }).stage === 'ready');
    const completeIdx = types.indexOf('buildComplete');
    expect(readyIdx).toBeGreaterThan(-1);
    expect(completeIdx).toBeGreaterThan(-1);
    // ready comes after buildComplete (coincident terminal, never earlier).
    expect(readyIdx).toBeGreaterThan(completeIdx);
    // Exactly one terminal buildComplete + one ready per build.
    expect(types.filter((t) => t === 'buildComplete')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'stage' && (e as { stage: string }).stage === 'ready')).toHaveLength(1);
  });

  it('does not disturb the existing buildProgress/buildComplete events', () => {
    const { renderer, events, runTicks } = makeRenderer(1);
    renderer.setIR(makeIR(2, 5));
    runTicks();
    expect(events.some((e) => e.type === 'buildProgress')).toBe(true);
    expect(events.some((e) => e.type === 'buildComplete')).toBe(true);
  });
});
