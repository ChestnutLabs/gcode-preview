/*
 * Minimal source-model viewer (DD-031 §4.7, tier 1 — Prepare side).
 *
 * The smallest real integration of @chestnutlabs/gcode-preview-react/model: give <ModelViewer> a
 * `source` ({ kind, bytes } — an STL or 3MF) and it parses + renders. The counterpart to minimal.jsx,
 * which does the same for sliced G-code with <GcodePreview>. No design system, no demo-kit engine
 * handles — just the published adapter. (The fixtures here are synthetic MIT-clean sample models.)
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ModelViewer } from '@chestnutlabs/gcode-preview-react/model';
import { MODEL_FIXTURES, MODEL_FIXTURE_BY_ID } from '../../demo-kit/index.js';

function App() {
  const [source, setSource] = useState(null);
  const [info, setInfo] = useState(null);

  function load(id) {
    const fx = MODEL_FIXTURE_BY_ID[id];
    if (fx) setSource(fx.source()); // { kind, bytes } → ModelViewer parses + renders
  }

  return (
    <>
      <header>
        <strong>gcode-preview-react · minimal model viewer</strong>
        <select defaultValue="" onChange={(e) => e.target.value && load(e.target.value)}>
          <option value="" disabled>
            Load a model…
          </option>
          {MODEL_FIXTURES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {info && (
          <span style={{ fontSize: '0.85rem', color: '#9fb0c0' }}>
            {info.objectCount} object{info.objectCount === 1 ? '' : 's'} · materials: {info.materials}
          </span>
        )}
      </header>
      <main>
        <ModelViewer source={source} background="#6d7176" onReady={(i) => setInfo(i)} />
      </main>
    </>
  );
}

createRoot(document.getElementById('app')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
