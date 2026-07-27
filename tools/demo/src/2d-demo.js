/*
 * Low-resource 2D layer view demo (E8 / DD-014): the same GcodeParseSession worker parse feeding
 * @chestnutlabs/gcode-renderer-2d's LayerView2D — a flat Canvas 2D view with adjacent "ghost"
 * layers and color-by-speed. No three.js, no WebGL. Proof the 2D renderer draws a real print.
 */
import { GcodeParseSession } from '@chestnutlabs/gcode-parser';
import { LayerView2D } from '@chestnutlabs/gcode-renderer-2d';

const canvas = document.getElementById('view');
const layerSlider = document.getElementById('layer');
const ghostSlider = document.getElementById('ghost');
const status = document.getElementById('status');

// Color-by-speed ramp (blue → amber → red) over the shared gcode-colors ColorMode.
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

function fit() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
  view.render();
}
window.addEventListener('resize', fit);

async function main() {
  const res = await fetch('./gcodes/calicat.gcode');
  if (!res.ok) throw new Error(`fetch calicat.gcode: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  status.textContent = 'parsing…';
  const session = new GcodeParseSession();
  const result = await session.parse(new Uint8Array(buf), { yieldIntervalMs: 25 });
  const ir = result.ir;
  view.setToolpath(ir);

  const n = ir.layers.length;
  layerSlider.max = String(Math.max(0, n - 1));
  const start = Math.floor(n * 0.4);
  layerSlider.value = String(start);
  view.setLayer(start);
  fit();

  const report = () =>
    (status.textContent = `${n} layers · ${ir.segments.count.toLocaleString()} segments · layer ${
      layerSlider.value
    }/${n - 1} · ${ghostSlider.value} ghost`);
  report();

  layerSlider.addEventListener('input', () => {
    view.setLayer(Number(layerSlider.value));
    view.render();
    report();
  });
  ghostSlider.addEventListener('input', () => {
    view.setAdjacentLayers(Number(ghostSlider.value));
    view.render();
    report();
  });
}

main().catch((err) => {
  status.textContent = `error: ${err.message}`;
  console.error(err);
});
