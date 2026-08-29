/*
 * Full showcase example (DD-031 §4.7, tier 2).
 *
 * Exercises the real declarative surface of @chestnutlabs/gcode-preview-react and mirrors the
 * Feature Lab's capability-aware UX in React idiom: color modes gate on the file's capabilities
 * with a plain-language reason, feature-role hiding is a declarative prop, and diagnostics/picking
 * come through the ref handle's `controls`. Chrome (light/dark) is separate from the renderer's
 * neutral viewport. Styling is the shared workspace-internal demo-kit — not a published UI kit and
 * not a library default. Still the real package: no raw renderer or parser imports.
 */
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GcodePreview } from '@chestnutlabs/gcode-preview-react';
import { FeatureRole } from '@chestnutlabs/toolpath-core';
import {
  FIXTURE_GROUPS,
  FIXTURE_BY_ID,
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
  const ref = useRef(null);
  const [chrome, setChrome] = useState('dark');
  const [fixtureId, setFixtureId] = useState('skirt-brim');
  const [source, setSource] = useState(null);

  // Reactive UI state, mirrored from the component's event callbacks (the controlled-component idiom).
  const [caps, setCaps] = useState({});
  const [layers, setLayers] = useState(0);
  const [segments, setSegments] = useState(0);
  const [topLayer, setTopLayer] = useState(0);
  const [disclosure, setDisclosure] = useState('');
  const [hasRetractions, setHasRetractions] = useState(false);
  const [time, setTime] = useState({ ms: null, src: null });
  const [stats, setStats] = useState(null);
  const [picked, setPicked] = useState(null);

  // Declarative control props.
  const [colorModeId, setColorModeId] = useState('feature');
  const [hideAdhesion, setHideAdhesion] = useState(false);
  const [showTravel, setShowTravel] = useState(false);
  const [showRetractions, setShowRetractions] = useState(false);
  const [view, setView] = useState('iso');

  document.documentElement.dataset.chrome = chrome;

  const mode = COLOR_MODE_BY_ID[colorModeId];
  const modeReason = colorModeReason(colorModeId, caps);
  const colorMode = modeReason === '' ? mode.build() : undefined; // don't apply an unavailable mode
  const legend = mode.legend ?? (colorModeId === 'feature' ? COLOR_MODE_BY_ID.feature.legend : null);
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

  function onReady(s) {
    if (typeof window !== 'undefined') window.gcodePreview = ref.current; // handle, for devtools/inspection
    setCaps(s.capabilities);
    setLayers(s.layers);
    setSegments(s.segments);
    setTopLayer(Math.max(0, s.layers - 1));
    // Pull the reactive fields the ready summary doesn't carry from the live state snapshot.
    const st = ref.current?.state;
    if (st) {
      setHasRetractions(st.hasRetractions);
      setTime({ ms: st.totalTimeMs, src: st.timeEstimateSource });
      // If the chosen mode isn't available for this file, fall back to a mode that always is.
      if (!st.availableColorModes.includes(colorModeId) && colorModeReason(colorModeId, s.capabilities) !== '') {
        setColorModeId('single');
      }
    }
  }

  function refreshStats() {
    setStats(ref.current?.controls.getRenderStats() ?? null);
  }

  function onCanvasClick(e) {
    const c = e.currentTarget.querySelector('canvas');
    if (!c || layers === 0) return;
    const r = c.getBoundingClientRect();
    const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
    // pickSegment returns the IR segment index, or null if the ray missed.
    setPicked(ref.current?.controls.pickSegment(ndcX, ndcY) ?? null);
  }

  const fx = FIXTURE_BY_ID[fixtureId];

  return (
    <>
      <header className="sc-header">
        <div className="sc-brand">
          <span className="gp-title">G-code Preview · React</span>
          <span className="gp-eyebrow">Showcase</span>
        </div>
        <select
          className="gp-input"
          style={{ width: 220 }}
          value={fixtureId}
          onChange={(e) => load(e.target.value)}
        >
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
        <button className="gp-btn gp-primary" onClick={() => load(fixtureId)}>
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
          {legend && (
            <div className="sc-legend-card">
              <span className="gp-eyebrow">{mode.label}</span>
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
          {segments > 0 && (
            <div className="sc-count">
              {formatCount(segments)} segments · {layers} layers
              {time.ms !== null && ` · ${formatDuration(time.ms)}`}
            </div>
          )}
        </div>

        <aside className="sc-rail">
          <div className="gp-scroll">
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
                    Top layer <span className="gp-value">{topLayer} / {Math.max(0, layers - 1)}</span>
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
                  <div>backend: {stats.backend} ({stats.capability})</div>
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
          </div>
        </aside>
      </div>

      <footer className="sc-status">
        <div className="sc-caps">
          {['featureRoles', 'objects', 'feedrate', 'colorChanges'].map((k) => {
            const tier = confidenceTier(caps[k]);
            return (
              <span key={k} className={`gp-badge ${tier.cls}`} title={`${k}: ${tier.label}`}>
                {k} · {tier.label}
              </span>
            );
          })}
        </div>
        <div className="sc-spacer" />
        <span>{disclosure || (fx ? fx.blurb : 'Pick a fixture to begin.')}</span>
      </footer>
    </>
  );
}

createRoot(document.getElementById('app')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
