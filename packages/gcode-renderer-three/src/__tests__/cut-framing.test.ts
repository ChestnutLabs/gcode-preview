// @vitest-environment happy-dom
/**
 * #568: a CNC/laser file (Cut moves, no Extrude) frames its cut extent, not the bed. The renderer is
 * unchanged — it reads `ir.bounds`, which now counts `Cut` (toolpath-core, DD-012 D7). Same stub-GL
 * harness as scene.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type GLRendererLike } from '../index.js';

// The #568 laser burn: G0 X50 Y50 / M4 / G1 X60 Y50 / G1 X60 Y60 / M5 / G0 X0 Y0.
function laserBurn(): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  const segs: [number, number, number, number, number][] = [
    [0, 0, 50, 50, MoveKind.Travel],
    [50, 50, 60, 50, MoveKind.Cut],
    [60, 50, 60, 60, MoveKind.Cut],
    [60, 60, 0, 0, MoveKind.Travel]
  ];
  segs.forEach(([x0, y0, x1, y1, kind], i) =>
    b.addSegment({ x0, y0, z0: 0, x1, y1, z1: 0, e: 0, kind, layer: 0, srcByte: i * 10 })
  );
  return b.finalize();
}

function makeRenderer(frameContent: 'object' | 'all'): { renderer: ToolpathRenderer; run: () => void } {
  const canvas = document.createElement('canvas');
  const stub: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    setPixelRatio: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  const ticks: (() => void)[] = [];
  const renderer = new ToolpathRenderer({
    canvas,
    buildVolume: { x: 220, y: 220, z: 250 },
    quality: 'lines',
    frameContent,
    createRenderer: () => stub,
    scheduleFrame: (cb) => ticks.push(cb)
  });
  const run = (): void => {
    while (ticks.length > 0) ticks.shift()?.();
  };
  return { renderer, run };
}

describe('Cut-only framing (#568)', () => {
  for (const mode of ['all', 'object'] as const) {
    it(`frameContent '${mode}' centres on the burn (55, 55, 0), not the bed (110, 110)`, () => {
      const { renderer, run } = makeRenderer(mode);
      renderer.setIR(laserBurn());
      run();
      renderer.frame();
      const t = renderer.getCameraState().target;
      // Scene axes are (x, z, -y) of printer space.
      expect(t.x).toBeCloseTo(55, 6);
      expect(t.y).toBeCloseTo(0, 6);
      expect(t.z).toBeCloseTo(-55, 6);
      renderer.dispose();
    });
  }
});
