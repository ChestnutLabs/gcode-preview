// @vitest-environment happy-dom
/**
 * Retraction markers (DD-009 D1, #148): opt-in, capability-honest, and clipped by
 * the layer/scrub window like the toolpath. Uses a stub GL + a builder IR carrying
 * retraction events.
 */
import { describe, expect, it } from 'vitest';
import { Points } from 'three';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type GLRendererLike } from '../index.js';

function makeIR(withRetractions: boolean): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  // Two layers × 3 segments.
  let src = 0;
  for (let l = 0; l < 2; l++) {
    for (let s = 0; s < 3; s++) {
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
  if (withRetractions) {
    // one in layer 0 (segIndex 2), one in layer 1 (segIndex 5)
    b.addRetraction({ x: 102, y: 100, z: 0.2, kind: 'retract', srcByte: 25, segIndex: 2 });
    b.addRetraction({ x: 102, y: 100, z: 0.4, kind: 'unretract', srcByte: 55, segIndex: 5 });
  }
  const ir = b.finalize();
  if (withRetractions) ir.header.capabilities.retractions = 'known';
  return ir;
}

function makeRenderer() {
  const canvas = document.createElement('canvas');
  const stub: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  const ticks: (() => void)[] = [];
  const renderer = new ToolpathRenderer({
    canvas,
    chunksPerTick: 8,
    quality: 'lines',
    createRenderer: () => stub,
    scheduleFrame: (cb) => ticks.push(cb)
  });
  return {
    renderer,
    runTicks: () => {
      while (ticks.length > 0) ticks.shift()?.();
    }
  };
}

function findPoints(renderer: ToolpathRenderer): Points | undefined {
  // Reach into the scene graph via a render; the markers live under the toolpath group.
  const group = (renderer as unknown as { toolpathGroup: { children: unknown[] } }).toolpathGroup;
  return group.children.find((c) => c instanceof Points) as Points | undefined;
}

describe('retraction markers (#148)', () => {
  it('is off by default and hidden even after enabling when the IR has none', () => {
    const { renderer, runTicks } = makeRenderer();
    renderer.setIR(makeIR(false));
    runTicks();
    expect(renderer.hasRetractions).toBe(false);
    renderer.setShowRetractions(true);
    // No points object built when there are no events.
    expect(findPoints(renderer)).toBeUndefined();
    renderer.dispose();
  });

  it('shows markers only when enabled AND the IR carries events', () => {
    const { renderer, runTicks } = makeRenderer();
    renderer.setIR(makeIR(true));
    runTicks();
    expect(renderer.hasRetractions).toBe(true);
    const pts = findPoints(renderer);
    expect(pts).toBeDefined();
    expect(pts?.visible).toBe(false); // default off
    renderer.setShowRetractions(true);
    expect(findPoints(renderer)?.visible).toBe(true);
    renderer.setShowRetractions(false);
    expect(findPoints(renderer)?.visible).toBe(false);
    renderer.dispose();
  });

  it('clips markers to the scrub window', () => {
    const { renderer, runTicks } = makeRenderer();
    renderer.setIR(makeIR(true));
    runTicks();
    renderer.setShowRetractions(true);
    // Scrub before the 2nd retraction (segIndex 5): only the first (segIndex 2) visible.
    renderer.setScrubPosition(3);
    const pts = findPoints(renderer);
    expect(pts?.geometry.drawRange.count).toBe(1);
    // Scrub past both.
    renderer.setScrubPosition(null);
    expect(findPoints(renderer)?.geometry.drawRange.count).toBe(2);
    renderer.dispose();
  });
});
