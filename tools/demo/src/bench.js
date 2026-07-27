/*
 * §8 low-resource benchmark harness (E8 / DD-014): the same worker parse feeding LayerView2D, with
 * measurement hooks on `window` for a headless driver. Measures the two §8 budgets on a real browser:
 * layer-change redraw time (< 16 ms interaction budget) and JS-heap growth (bounded to the active
 * layer — the 2D renderer draws straight from the SoA and builds no per-layer geometry).
 *
 * Drive it with a headless browser (see the puppeteer recipe in the E8 §8 report). For precise memory
 * numbers launch Chrome with `--enable-precise-memory-info --js-flags=--expose-gc`.
 */
import { GcodeParseSession } from '@chestnutlabs/gcode-parser';
import { LayerView2D } from '@chestnutlabs/gcode-renderer-2d';

const canvas = document.getElementById('c');
const view = new LayerView2D(canvas, {
  colorMode: {
    mode: 'feedrate',
    ramp: [
      [0.13, 0.35, 0.92],
      [0.96, 0.85, 0.22],
      [0.9, 0.22, 0.16]
    ],
    fallback: [0.55, 0.6, 0.62]
  },
  adjacentLayers: 1,
  ghostOpacity: 0.28,
  lineWidth: 1
});

window.__ready = false;

(async () => {
  const buf = await (await fetch('./gcodes/calicat.gcode')).arrayBuffer();
  const t0 = performance.now();
  const session = new GcodeParseSession();
  const result = await session.parse(new Uint8Array(buf), { yieldIntervalMs: 25 });
  const parseMs = performance.now() - t0;
  const ir = result.ir;
  view.setToolpath(ir);
  window.__meta = { layers: ir.layers.length, segments: ir.segments.count, parseMs: +parseMs.toFixed(1) };

  const gc = () => {
    if (window.gc) {
      window.gc();
      window.gc();
    }
  };
  const heapMB = () => (performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(2) : null);

  /** Sweep every layer once, recording per-layer redraw (setLayer + render) time. */
  window.__bench = (adjacent) => {
    view.setAdjacentLayers(adjacent);
    const n = ir.layers.length;
    view.setLayer(Math.floor(n / 2));
    view.render(); // warm
    const times = [];
    for (let L = 0; L < n; L++) {
      const a = performance.now();
      view.setLayer(L);
      view.render();
      times.push(performance.now() - a);
    }
    times.sort((x, y) => x - y);
    const q = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))];
    return {
      adjacent,
      layers: n,
      redrawMs: {
        min: +times[0].toFixed(3),
        median: +q(0.5).toFixed(3),
        p95: +q(0.95).toFixed(3),
        max: +times[n - 1].toFixed(3)
      }
    };
  };

  /** Render the whole model 5×; heap must not grow (no per-layer geometry accumulation). */
  window.__memProbe = () => {
    gc();
    const before = heapMB();
    for (let s = 0; s < 5; s++)
      for (let L = 0; L < ir.layers.length; L++) {
        view.setLayer(L);
        view.render();
      }
    gc();
    const after = heapMB();
    return {
      heapBeforeMB: before,
      heapAfterMB: after,
      growthMB: before != null && after != null ? +(after - before).toFixed(2) : null
    };
  };

  window.__setLayer = (L) => {
    view.setLayer(L);
    view.render();
  };
  window.__ready = true;
})();
