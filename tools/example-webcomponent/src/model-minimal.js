/*
 * Minimal source-model viewer (DD-031 §4.7, tier 1 — Prepare side).
 *
 * The smallest real integration of the <gcode-model-viewer> Web Component: importing `/model/define`
 * auto-registers the element (tag `gcode-model-viewer`, not the reserved `model-viewer`), then set the
 * `source` PROPERTY ({ kind, bytes } — an STL or 3MF; objects can't be attributes) and it parses +
 * renders. The counterpart to minimal.js, which does the same for sliced G-code with <gcode-preview>.
 * No design system, no demo-kit tokens — just the published adapter. (The fixtures are synthetic
 * MIT-clean sample models.)
 */
import '@chestnutlabs/gcode-preview-element/model/define';
import { MODEL_FIXTURES, MODEL_FIXTURE_BY_ID } from '../../demo-kit/index.js';

const view = document.getElementById('view');
const fixture = document.getElementById('fixture');
const info = document.getElementById('info');

// Render into the shared documentation mid-grey workspace (background property; also a `background` attr).
view.background = '#6d7176';

// Populate the picker from the shared model fixtures.
fixture.insertAdjacentHTML(
  'beforeend',
  MODEL_FIXTURES.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')
);

fixture.addEventListener('change', () => {
  const fx = MODEL_FIXTURE_BY_ID[fixture.value];
  if (fx) view.source = fx.source(); // property (object) → parse + render
});

// `ready`'s detail is a ModelReadyInfo carrying the parse summary.
view.addEventListener('ready', (e) => {
  const i = e.detail;
  info.textContent = `${i.objectCount} object${i.objectCount === 1 ? '' : 's'} · materials: ${i.materials}`;
});
