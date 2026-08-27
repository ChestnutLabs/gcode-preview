// @vitest-environment happy-dom
/**
 * DD-029 Phase B — `progressivePreview:'hold'` is a true single clean reveal: the growing scene is NOT
 * rendered per build tick (the ~187-render waste RR-008 §8.1 measured); the completed scene is rendered
 * exactly once, at completion. `'lines'` still renders per tick; `'auto'` currently resolves to `'lines'`.
 * No mode drops segments — the built geometry is identical.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type GLRendererLike, type ProgressivePreview } from '../index.js';

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

/** Build one IR at the given preview mode; return render-call count during the build + chunk count. */
function buildAndCount(mode: ProgressivePreview): { renderCalls: number; chunks: number; completed: boolean } {
  const canvas = document.createElement('canvas');
  let renderCalls = 0;
  let completed = false;
  const stub: GLRendererLike = {
    render: () => renderCalls++,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  const ticks: (() => void)[] = [];
  const renderer = new ToolpathRenderer({
    canvas,
    chunksPerTick: 1, // one chunk per tick → many ticks, so per-tick rendering is visible in the count
    quality: 'lines',
    progressivePreview: mode,
    createRenderer: () => stub,
    scheduleFrame: (cb) => ticks.push(cb)
  });
  renderer.onEvent((e) => {
    if (e.type === 'buildComplete') completed = true;
  });
  // >250k-segment target boundary → a genuine multi-chunk build, so chunksPerTick spreads across ticks
  // and per-tick rendering is visible in the count.
  renderer.setIR(makeIR(550, 1000));
  // Count renders only during the build ticks (exclude any setIR framing render).
  renderCalls = 0;
  while (ticks.length > 0) ticks.shift()?.();
  const chunks = renderer.chunkMeshes.length;
  renderer.dispose();
  return { renderCalls, chunks, completed };
}

describe('DD-029 single clean reveal (progressivePreview:hold)', () => {
  it('hold renders exactly once (the reveal), while lines renders per tick', () => {
    const lines = buildAndCount('lines');
    const hold = buildAndCount('hold');

    // Both complete and build the SAME geometry (no segment-dropping, identical chunk count).
    expect(lines.completed).toBe(true);
    expect(hold.completed).toBe(true);
    expect(hold.chunks).toBe(lines.chunks);
    expect(hold.chunks).toBeGreaterThan(1); // genuinely multi-chunk

    // hold: a single reveal render at completion; lines: one per build tick (many).
    expect(hold.renderCalls).toBe(1);
    expect(lines.renderCalls).toBeGreaterThan(hold.renderCalls);
    expect(lines.renderCalls).toBeGreaterThanOrEqual(hold.chunks); // ~one render per chunk tick
  });

  it('auto currently resolves to lines (per-tick renders) until the estimate lands', () => {
    const auto = buildAndCount('auto');
    const lines = buildAndCount('lines');
    expect(auto.completed).toBe(true);
    expect(auto.renderCalls).toBe(lines.renderCalls);
    expect(auto.renderCalls).toBeGreaterThan(1);
  });
});
