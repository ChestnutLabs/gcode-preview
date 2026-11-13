// @vitest-environment happy-dom
/**
 * Travel-only files (#580): a pen plotter has no Extrude and no Cut move, so `ir.bounds` is empty. Framing
 * falls back to `ir.boundsWithTravel` so the camera targets the drawing, not the bed.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type GLRendererLike } from '../index.js';

const VOLUME = { x: 200, y: 100, z: 50 };

function travelOnly(): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  const base = { z0: 0, z1: 0, e: 0, tool: 0, layer: 0, kind: MoveKind.Travel };
  b.addSegment({ ...base, x0: 10, y0: 10, x1: 30, y1: 10, srcByte: 0 });
  b.addSegment({ ...base, x0: 30, y0: 10, x1: 30, y1: 25, srcByte: 10 });
  return b.finalize();
}

function make() {
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
    buildVolume: VOLUME,
    createRenderer: () => stub,
    scheduleFrame: (cb) => ticks.push(cb)
  });
  return {
    renderer,
    run: () => {
      while (ticks.length > 0) ticks.shift()?.();
    }
  };
}

describe('travel-only framing (#580)', () => {
  it('premise: productive bounds are empty, travel bounds are the drawing', () => {
    const ir = travelOnly();
    expect(ir.bounds.min.x).toBe(Infinity);
    expect(ir.boundsWithTravel).toEqual({ min: { x: 10, y: 10, z: 0 }, max: { x: 30, y: 25, z: 0 } });
  });

  for (const mode of ['all', 'object'] as const) {
    it(`frameContent '${mode}' targets the drawing centre, not the bed centre`, () => {
      const { renderer, run } = make();
      renderer.setIR(travelOnly());
      run();
      renderer.setFrameContent(mode);
      const t = renderer.getCameraState().target;
      expect([t.x, t.y, t.z]).toEqual([20, 0, -17.5]); // scene coords (x, z, -y); bed centre would be (100, 0, -50)
      renderer.dispose();
    });
  }

  // Only the exact empty sentinel (min +Infinity, max -Infinity on all six fields) falls back to travel bounds; a
  // box that is empty on five fields and finite on one is malformed, and keeps the bed framing (#501).
  const SENTINEL = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity }
  };
  for (const end of ['min', 'max'] as const) {
    for (const axis of ['x', 'y', 'z'] as const) {
      it(`bounds empty except ${end}.${axis} = 5 keeps the bed framing`, () => {
        const { renderer, run } = make();
        const bounds = { min: { ...SENTINEL.min }, max: { ...SENTINEL.max } };
        bounds[end][axis] = 5;
        renderer.setIR({ ...travelOnly(), bounds });
        run();
        const t = renderer.getCameraState().target;
        expect(t.x).toBeCloseTo(100, 6);
        expect(t.y).toBeCloseTo(0, 6);
        expect(t.z).toBeCloseTo(-50, 6); // the bed centre, not the drawing's (20, 0, -17.5)
        renderer.dispose();
      });
    }
  }

  it("the frameContent 'object' disclosure names productive moves, not only extrusion", () => {
    const { renderer, run } = make();
    const msgs: string[] = [];
    renderer.onEvent((e) => {
      if (e.type === 'error' && e.code === 'E_FRAME_CONTENT_UNAVAILABLE') msgs.push(e.message);
    });
    renderer.setIR(travelOnly());
    run();
    renderer.setFrameContent('object');
    expect(msgs).toEqual([
      "frameContent 'object' cannot isolate the model (nonModelClassification: unavailable); framing all productive moves (extrusion or cut)"
    ]);
    renderer.dispose();
  });
});
