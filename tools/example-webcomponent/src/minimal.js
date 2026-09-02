/*
 * Minimal getting-started example (DD-031 §4.7, tier 1).
 *
 * The smallest real integration of the <gcode-preview> Web Component: importing `/define`
 * auto-registers the element, then set the `source` PROPERTY (objects can't be attributes) and it
 * parses + renders. The layer slider drives the `layer-range` ATTRIBUTE — the attribute/property
 * split is the one thing that makes the Web Component differ from the framework wrappers. No design
 * system, no demo-kit, no raw renderer. Copy this file to start.
 */
import '@chestnutlabs/gcode-preview-element/define';

const view = document.getElementById('view');
const fixture = document.getElementById('fixture');
const layer = document.getElementById('layer');
const layerLabel = document.getElementById('layerLabel');
const layerNum = document.getElementById('layerNum');
const layerMax = document.getElementById('layerMax');

// Hide travel moves for a clean first view (property; the element defaults showTravel to true).
view.showTravel = false;
// Render into the shared documentation mid-grey workspace (theme is an object property).
view.theme = { background: '#6d7176' };

let layers = 0;

fixture.addEventListener('change', async () => {
  if (!fixture.value) return;
  const res = await fetch(`./gcodes/${fixture.value}`);
  view.source = new Uint8Array(await res.arrayBuffer()); // property (object) → re-parse
});

// `ready`'s detail carries the parse summary.
view.addEventListener('ready', (e) => {
  layers = e.detail.layers;
  layerLabel.hidden = layers === 0;
  layer.max = String(Math.max(0, layers - 1));
  layer.value = layer.max;
  layerNum.textContent = layer.value;
  layerMax.textContent = layer.max;
});

layer.addEventListener('input', () => {
  layerNum.textContent = layer.value;
  view.setAttribute('layer-range', `0,${layer.value}`); // primitive → attribute
});
