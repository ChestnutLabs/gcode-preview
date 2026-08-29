/*
 * Minimal getting-started example (DD-031 §4.7, tier 1).
 *
 * The smallest real integration of @chestnutlabs/gcode-preview-react: give <GcodePreview> a
 * `source` (bytes/File/ArrayBuffer) and it parses + renders. Everything else here — the fixture
 * picker and the layer slider — is ordinary React state driving declarative props. No design
 * system, no demo-kit, no raw renderer. Copy this file to start.
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GcodePreview } from '@chestnutlabs/gcode-preview-react';

const FIXTURES = ['3DBenchy.gcode', 'calicat.gcode', 'vase.gcode', 'mach3.gcode'];

function App() {
  const [source, setSource] = useState(null);
  const [layers, setLayers] = useState(0);
  const [topLayer, setTopLayer] = useState(0);

  async function load(name) {
    const res = await fetch(`./gcodes/${name}`);
    setSource(new Uint8Array(await res.arrayBuffer())); // new source prop → re-parse
  }

  return (
    <>
      <header>
        <strong>gcode-preview-react · minimal</strong>
        <select defaultValue="" onChange={(e) => e.target.value && load(e.target.value)}>
          <option value="" disabled>
            Load a fixture…
          </option>
          {FIXTURES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        {layers > 0 && (
          <label>
            Layer {topLayer} / {layers - 1}{' '}
            <input
              type="range"
              min={0}
              max={layers - 1}
              value={topLayer}
              onChange={(e) => setTopLayer(Number(e.target.value))}
            />
          </label>
        )}
      </header>
      <main>
        <GcodePreview
          source={source}
          layerRange={layers > 0 ? [0, topLayer] : null}
          onReady={(s) => {
            setLayers(s.layers);
            setTopLayer(Math.max(0, s.layers - 1));
          }}
        />
      </main>
    </>
  );
}

createRoot(document.getElementById('app')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
