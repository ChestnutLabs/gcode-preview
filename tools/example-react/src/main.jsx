/**
 * DD-007 phase 6 example app (issue #113): the packaged REACT component drives the whole
 * pipeline — corpus select, layer/scrub props, simulated DD-006 progress — with the D2
 * default (batteries) worker path under real Vite. No raw session/renderer imports.
 */
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GcodePreview } from '@chestnutlabs/gcode-preview-react';

const CORPUS = ['easel.gcode', 'calicat.gcode', '3DBenchy.gcode', 'vase.gcode', 'screw.gcode'];

function App() {
  const [fixture, setFixture] = useState(CORPUS[0]);
  const [source, setSource] = useState(null);
  const [layerCount, setLayerCount] = useState(0);
  const [segmentCount, setSegmentCount] = useState(0);
  const [lastLayer, setLastLayer] = useState(0);
  const [scrub, setScrub] = useState(null);
  const [progressObs, setProgressObs] = useState(null);
  const [log, setLog] = useState('Pick a fixture and press Load.');
  const simTimer = useRef(null);
  const preview = useRef(null);

  const append = (s) => setLog((prev) => `${s}\n${prev}`.split('\n').slice(0, 14).join('\n'));

  async function load() {
    stopSim();
    const res = await fetch(`./${fixture}`);
    setSource(new Uint8Array(await res.arrayBuffer())); // prop change → component re-parses
  }

  function stopSim() {
    if (simTimer.current !== null) clearInterval(simTimer.current);
    simTimer.current = null;
    setProgressObs(null);
  }

  function playSim() {
    if (simTimer.current !== null) {
      stopSim();
      return;
    }
    let fraction = 0;
    simTimer.current = setInterval(() => {
      fraction = Math.min(1, fraction + 0.01);
      setProgressObs({
        v: 1,
        timestampMs: Date.now(),
        state: fraction >= 1 ? 'complete' : 'printing',
        position: { percent: fraction, percentBasis: 'bytes' }
      });
      if (fraction >= 1) stopSim();
    }, 100);
  }

  return (
    <div style={{ display: 'contents' }}>
      <aside>
        <h2>React component example</h2>
        <label>
          Fixture{' '}
          <select value={fixture} onChange={(e) => setFixture(e.target.value)}>
            {CORPUS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <button onClick={load}>Load</button>
        <label>
          Last layer: {lastLayer} / {Math.max(0, layerCount - 1)}
          <input
            type="range"
            min={0}
            max={Math.max(0, layerCount - 1)}
            value={lastLayer}
            onChange={(e) => setLastLayer(Number(e.target.value))}
          />
        </label>
        <label>
          Scrub: {scrub === null ? 'all' : `${scrub} / ${segmentCount}`}
          <input
            type="range"
            min={0}
            max={segmentCount}
            value={scrub ?? segmentCount}
            onChange={(e) => {
              const v = Number(e.target.value);
              setScrub(v >= segmentCount ? null : v);
            }}
          />
        </label>
        <button onClick={playSim}>{simTimer.current === null ? 'Play simulated progress' : 'Stop'}</button>
        <pre id="log">{log}</pre>
      </aside>
      <main>
        <GcodePreview
          ref={preview}
          source={source}
          layerRange={layerCount > 0 ? [0, lastLayer] : null}
          scrub={scrub}
          progress={progressObs}
          quality="auto"
          onReady={(s) => {
            setLayerCount(s.layers);
            setSegmentCount(s.segments);
            setLastLayer(Math.max(0, s.layers - 1));
            setScrub(null);
            append(`ready: ${s.segments.toLocaleString()} segments, ${s.layers} layers`);
          }}
          onParseError={(e) => append(`parse-error: ${e.code} ${e.message}`)}
          onBuildComplete={(e) => append(`build-complete: ${e.quality}`)}
          onQualityFallback={(e) => append(`quality-fallback: ${e.from} -> ${e.to}`)}
          onProgressPresentationChanged={(e) =>
            append(`progress shown as: ${e.mode}${e.reason ? ` (${e.reason})` : ''}`)
          }
          onDisclosure={(t) => t && append(`disclosure: ${t}`)}
          onError={(e) => append(`error: ${e.code}`)}
        />
      </main>
    </div>
  );
}

const root = createRoot(document.getElementById('app'));
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
window.reactExample = { root };
