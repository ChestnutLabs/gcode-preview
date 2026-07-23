/*
 * renderStill headless harness (#132). Renders a fixture through the packaged
 * renderStill into an OffscreenCanvas, blits to a visible canvas, and computes a
 * coarse pixel signature (grid means + lit-pixel count) for a deterministic check.
 */
import { renderStill } from '@chestnutlabs/gcode-preview-core';

const out = document.getElementById('out');
const log = document.getElementById('log');
const print = (s) => {
  log.textContent = s;
};

const W = 640;
const H = 480;
const GRID = 8;

function signature(imageData) {
  const { data, width, height } = imageData;
  const cellW = width / GRID;
  const cellH = height / GRID;
  const sums = new Array(GRID * GRID).fill(0);
  const counts = new Array(GRID * GRID).fill(0);
  let lit = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = data[i] + data[i + 1] + data[i + 2];
      const cell = Math.min(GRID - 1, Math.floor(y / cellH)) * GRID + Math.min(GRID - 1, Math.floor(x / cellW));
      sums[cell] += lum;
      counts[cell]++;
      if (lum > 90) lit++;
    }
  }
  const grid = sums.map((s, i) => Math.round(s / Math.max(1, counts[i])));
  return { lit, grid };
}

async function run(fixture = 'gcodes/screw.gcode', quality = 'tubes') {
  print(`rendering ${fixture} (${quality})…`);
  const bytes = new Uint8Array(await (await fetch(`./${fixture}`)).arrayBuffer());
  const canvas = new OffscreenCanvas(W, H);
  const t0 = performance.now();
  const result = await renderStill(bytes, { canvas, width: W, height: H, quality });
  window.__stillResult = result;
  const ms = Math.round(performance.now() - t0);

  // Blit the offscreen result to the visible canvas for eyeballing.
  const bmp = canvas.transferToImageBitmap();
  const ctx = out.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const sig = signature(ctx.getImageData(0, 0, W, H));

  const report = {
    fixture,
    quality: result.quality,
    parsed: result.parsed,
    segments: result.segmentCount,
    layers: result.layerCount,
    ms,
    lit: sig.lit
  };
  print(JSON.stringify(report, null, 2) + '\n\ngrid:\n' + sig.grid.join(','));
  return { ...report, grid: sig.grid };
}

window.stillRun = run;
run().catch((e) => print('ERROR: ' + (e && e.stack ? e.stack : e)));
