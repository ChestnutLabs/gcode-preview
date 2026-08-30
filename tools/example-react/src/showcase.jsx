/*
 * Full showcase example (DD-031 §4.7, tier 2).
 *
 * Demonstrates BOTH halves of the SDK in one app, like a slicer's two modes:
 *  - Preview  → sliced G-code / toolpath via <GcodePreview> (@chestnutlabs/gcode-preview-react)
 *  - Prepare  → source model (STL / 3MF) via <ModelViewer> (@chestnutlabs/gcode-preview-react/model)
 *
 * Both are the real published adapters (no raw renderer) and mirror the Feature Lab's capability-aware,
 * honest UX in React idiom: toolpath color modes gate on the file's capabilities with a plain-language
 * reason; the model side surfaces the material-colour capability tier and object/instance counts.
 * Diagnostics/picking come through the ref handle. Styling is the shared workspace-internal demo-kit.
 */
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GcodePreview } from '@chestnutlabs/gcode-preview-react';
import { ModelViewer } from '@chestnutlabs/gcode-preview-react/model';
import { FeatureRole } from '@chestnutlabs/toolpath-core';
import {
  FIXTURE_GROUPS,
  FIXTURE_BY_ID,
  MODEL_FIXTURES,
  MODEL_FIXTURE_BY_ID,
  COLOR_MODES,
  COLOR_MODE_BY_ID,
  colorModeReason,
  confidenceTier,
  rgbCss,
  count as formatCount,
  duration as formatDuration
} from '../../demo-kit/index.js';
import '../../demo-kit/tokens.css';

const ADHESION_ROLES = [FeatureRole.Skirt, FeatureRole.Brim];
const CAM_VIEWS = [
  ['iso', 'Iso'],
  ['top', 'Top'],
  ['front', 'Front']
];

function App() {
  const ref = useRef(null); // toolpath handle
  const modelRef = useRef(null); // model handle
  const [chrome, setChrome] = useState('dark');
  const [mode, setMode] = useState('preview'); // 'preview' (toolpath) | 'prepare' (model)
  const [view, setView] = useState('iso');

  // Preview (toolpath) state
  const [fixtureId, setFixtureId] = useState('skirt-brim');
  const [source, setSource] = useState(null);
  const [caps, setCaps] = useState({});
  const [layers, setLayers] = useState(0);
  const [segments, setSegments] = useState(0);
  const [topLayer, setTopLayer] = useState(0);
  const [disclosure, setDisclosure] = useState('');
  const [hasRetractions, setHasRetractions] = useState(false);
  const [time, setTime] = useState({ ms: null, src: null });
  const [stats, setStats] = useState(null);
  const [picked, setPicked] = useState(null);
  const [colorModeId, setColorModeId] = useState('feature');
  const [hideAdhesion, setHideAdhesion] = useState(false);
  const [showTravel, setShowTravel] = useState(false);
  const [showRetractions, setShowRetractions] = useState(false);

  // Prepare (model) state
  const [modelFixtureId, setModelFixtureId] = useState('colored-3mf');
  const [modelSource, setModelSource] = useState(null);
  const [modelInfo, setModelInfo] = useState(null);

  document.documentElement.dataset.chrome = chrome;

  const modeItem = COLOR_MODE_BY_ID[colorModeId];
  const modeReason = colorModeReason(colorModeId, caps);
  const colorMode = modeReason === '' ? modeItem.build() : undefined;
  const legend = modeItem.legend ?? null;
  const featureRolesKnown = caps.featureRoles === 'known' || caps.featureRoles === 'inferred';

  async function load(id) {
    const fx = FIXTURE_BY_ID[id];
    if (!fx) return;
    setFixtureId(id);
    const res = await fetch(`./${fx.path}`);
    setSource(new Uint8Array(await res.arrayBuffer()));
    setStats(null);
    setPicked(null);
  }

  function loadModel(id) {
    const fx = MODEL_FIXTURE_BY_ID[id];
    if (!fx) return;
    setModelFixtureId(id);
    setModelSource(fx.source()); // { kind, bytes } — no fetch, synthetic MIT-clean fixture
    setModelInfo(null);
  }

  function onReady(s) {
    if (typeof window !== 'undefined') window.gcodePreview = ref.current;
    setCaps(s.capabilities);
    setLayers(s.layers);
    setSegments(s.segments);
    setTopLayer(Math.max(0, s.layers - 1));
    const st = ref.current?.state;
    if (st) {
      setHasRetractions(st.hasRetractions);
      setTime({ ms: st.totalTimeMs, src: st.timeEstimateSource });
      if (!st.availableColorModes.includes(colorModeId) && colorModeReason(colorModeId, s.capabilities) !== '') {
        setColorModeId('single');
      }
    }
  }

  function refreshStats() {
    setStats(ref.current?.controls.getRenderStats() ?? null);
  }

  function onCanvasClick(e) {
    if (mode !== 'preview') return;
    const c = e.currentTarget.querySelector('canvas');
    if (!c || layers === 0) return;
    const r = c.getBoundingClientRect();
    const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
    setPicked(ref.current?.controls.pickSegment(ndcX, ndcY) ?? null);
  }

  const fx = FIXTURE_BY_ID[fixtureId];
  const modelFx = MODEL_FIXTURE_BY_ID[modelFixtureId];
  const prepare = mode === 'prepare';

  return (
    <>
      <header className="sc-header">
        <div className="sc-brand">
          <span className="gp-title">G-code Preview · React</span>
          <span className="gp-eyebrow">Showcase</span>
        </div>
        {/* Preview (toolpath) vs Prepare (source model) — the two halves of the SDK. */}
        <div className="gp-segment" role="group" aria-label="Workflow">
          <button className={!prepare ? 'gp-on' : ''} onClick={() => setMode('preview')}>
            Preview
          </button>
          <button className={prepare ? 'gp-on' : ''} onClick={() => setMode('prepare')}>
            Prepare
          </button>
        </div>
        {!prepare ? (
          <select className="gp-input" style={{ width: 200 }} value={fixtureId} onChange={(e) => load(e.target.value)}>
            {FIXTURE_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        ) : (
          <select
            className="gp-input"
            style={{ width: 200 }}
            value={modelFixtureId}
            onChange={(e) => loadModel(e.target.value)}
          >
            {MODEL_FIXTURES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        )}
        <button className="gp-btn gp-primary" onClick={() => (prepare ? loadModel(modelFixtureId) : load(fixtureId))}>
          Load
        </button>
        <div className="sc-spacer" />
        <div className="gp-segment" role="group" aria-label="Chrome theme">
          {['dark', 'light'].map((c) => (
            <button key={c} className={chrome === c ? 'gp-on' : ''} onClick={() => setChrome(c)}>
              {c === 'dark' ? 'Dark' : 'Light'}
            </button>
          ))}
        </div>
      </header>

      <div className="sc-main">
        <div className="sc-viewport" onClick={onCanvasClick}>
          {!prepare ? (
            <GcodePreview
              ref={ref}
              source={source}
              colorMode={colorMode}
              layerRange={layers > 0 ? [0, topLayer] : null}
              hiddenFeatureRoles={hideAdhesion ? ADHESION_ROLES : undefined}
              showTravel={showTravel}
              showRetractions={showRetractions}
              view={view}
              frameContent="object"
              quality="auto"
              onReady={onReady}
              onBuildComplete={refreshStats}
              onDisclosure={(t) => setDisclosure(t ?? '')}
              onParseError={(e) => setDisclosure(`Parse error: ${e.code} — ${e.message}`)}
            />
          ) : (
            <ModelViewer
              ref={modelRef}
              source={modelSource}
              view={view}
              background="transparent"
              onReady={(info) => setModelInfo(info)}
              onError={(e) => setDisclosure(`Model error: ${e.code} — ${e.message}`)}
            />
          )}

          {!prepare && legend && (
            <div className="sc-legend-card">
              <span className="gp-eyebrow">{modeItem.label}</span>
              <div className="gp-legend">
                {legend.map(([label, rgb]) => (
                  <span className="gp-legend-item" key={label}>
                    <span className="gp-swatch" style={{ background: rgbCss(rgb) }} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="sc-cam">
            {CAM_VIEWS.map(([v, label]) => (
              <button
                key={v}
                className={`gp-icon-btn ${view === v ? 'gp-on' : ''}`}
                title={`${label} view`}
                onClick={() => setView(v)}
              >
                {label[0]}
              </button>
            ))}
          </div>
          {!prepare && segments > 0 && (
            <div className="sc-count">
              {formatCount(segments)} segments · {layers} layers
              {time.ms !== null && ` · ${formatDuration(time.ms)}`}
            </div>
          )}
          {prepare && modelInfo && (
            <div className="sc-count">
              {formatCount(modelInfo.objectCount)} object{modelInfo.objectCount === 1 ? '' : 's'}
              {modelInfo.instancedCount > modelInfo.objectCount &&
                ` · ${formatCount(modelInfo.instancedCount)} placements`}
            </div>
          )}
        </div>

        <aside className="sc-rail">
          <div className="gp-scroll">
            {!prepare ? (
              <>
                <section className="gp-panel">
                  <h3>Appearance</h3>
                  <div className="gp-field">
                    <label htmlFor="mode">Color by</label>
                    <select
                      id="mode"
                      className="gp-input"
                      value={colorModeId}
                      onChange={(e) => setColorModeId(e.target.value)}
                    >
                      {COLOR_MODES.map((m) => {
                        const reason = colorModeReason(m.id, caps);
                        return (
                          <option key={m.id} value={m.id} disabled={reason !== ''}>
                            {m.label}
                            {reason !== '' ? ' — unavailable' : ''}
                          </option>
                        );
                      })}
                    </select>
                    {modeReason !== '' && <span className="gp-reason">{modeReason}</span>}
                  </div>
                </section>

                <section className="gp-panel">
                  <h3>Filter</h3>
                  {layers > 0 && (
                    <div className="gp-field">
                      <label>
                        Top layer{' '}
                        <span className="gp-value">
                          {topLayer} / {Math.max(0, layers - 1)}
                        </span>
                      </label>
                      <input
                        className="gp-range"
                        type="range"
                        min={0}
                        max={Math.max(0, layers - 1)}
                        value={topLayer}
                        onChange={(e) => setTopLayer(Number(e.target.value))}
                      />
                    </div>
                  )}
                  <label className={`gp-toggle ${featureRolesKnown ? '' : 'gp-disabled'}`}>
                    <span>
                      Hide skirt &amp; brim
                      {!featureRolesKnown && <span className="gp-reason"> — file has no feature roles</span>}
                    </span>
                    <input
                      type="checkbox"
                      checked={hideAdhesion}
                      disabled={!featureRolesKnown}
                      onChange={(e) => setHideAdhesion(e.target.checked)}
                    />
                  </label>
                  <label className="gp-toggle">
                    <span>Show travel moves</span>
                    <input type="checkbox" checked={showTravel} onChange={(e) => setShowTravel(e.target.checked)} />
                  </label>
                  <label className={`gp-toggle ${hasRetractions ? '' : 'gp-disabled'}`}>
                    <span>
                      Show retractions
                      {!hasRetractions && <span className="gp-reason"> — none in this file</span>}
                    </span>
                    <input
                      type="checkbox"
                      checked={showRetractions}
                      disabled={!hasRetractions}
                      onChange={(e) => setShowRetractions(e.target.checked)}
                    />
                  </label>
                </section>

                <section className="gp-panel">
                  <h3>Diagnostics</h3>
                  <button className="gp-btn" onClick={refreshStats} disabled={segments === 0}>
                    Read render stats
                  </button>
                  {stats && (
                    <div style={{ marginTop: 'var(--gp-space-3)' }} className="gp-mono">
                      <div>
                        backend: {stats.backend} ({stats.capability})
                      </div>
                      <div>geometry: {stats.geometryMode}</div>
                      <div>segments: {formatCount(stats.renderedSegmentCount ?? 0)}</div>
                      <div>draw calls: {stats.drawCalls ?? '—'}</div>
                      {stats.gpuRenderer && <div style={{ color: 'var(--gp-text-faint)' }}>{stats.gpuRenderer}</div>}
                    </div>
                  )}
                  {picked !== null && (
                    <p className="gp-reason" style={{ marginTop: 'var(--gp-space-2)' }}>
                      Picked IR segment #{picked}
                    </p>
                  )}
                  {picked === null && segments > 0 && (
                    <p className="gp-reason" style={{ marginTop: 'var(--gp-space-2)' }}>
                      Click the model to identify a segment.
                    </p>
                  )}
                </section>
              </>
            ) : (
              <section className="gp-panel">
                <h3>Source model</h3>
                <p className="gp-reason" style={{ marginBottom: 'var(--gp-space-3)' }}>
                  {modelFx ? modelFx.blurb : ''}
                </p>
                {modelInfo && (
                  <div className="gp-mono">
                    <div>objects: {formatCount(modelInfo.objectCount)}</div>
                    <div>placements: {formatCount(modelInfo.instancedCount)}</div>
                    <div>
                      materials:{' '}
                      <span className={`gp-badge ${confidenceTier(modelInfo.materials).cls}`}>
                        {confidenceTier(modelInfo.materials).label}
                      </span>
                    </div>
                    {modelInfo.plates && <div>plates: {modelInfo.plates.list.length}</div>}
                  </div>
                )}
                {!modelInfo && <p className="gp-reason">Press Load to view a source model.</p>}
              </section>
            )}
          </div>
        </aside>
      </div>

      <footer className="sc-status">
        <div className="sc-caps">
          {!prepare
            ? ['featureRoles', 'objects', 'feedrate', 'colorChanges'].map((k) => {
                const tier = confidenceTier(caps[k]);
                return (
                  <span key={k} className={`gp-badge ${tier.cls}`} title={`${k}: ${tier.label}`}>
                    {k} · {tier.label}
                  </span>
                );
              })
            : modelInfo && (
                <span className={`gp-badge ${confidenceTier(modelInfo.materials).cls}`}>
                  materials · {confidenceTier(modelInfo.materials).label}
                </span>
              )}
        </div>
        <div className="sc-spacer" />
        <span>
          {disclosure ||
            (prepare ? 'Prepare: view the source model before slicing.' : fx ? fx.blurb : 'Pick a fixture to begin.')}
        </span>
      </footer>
    </>
  );
}

createRoot(document.getElementById('app')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
