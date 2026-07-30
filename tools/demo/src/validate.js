/*
 * CNC / laser VALIDATION HARNESS (#189, DD-012 phase 6).
 *
 * Purpose: turn "does it work?" into a per-file checklist. The user loads a file they have
 * PHYSICALLY cut/milled/engraved, this page lists every claim the software makes about it
 * (machine class, cut-vs-rapid split, tool-power range, canned cycles, envelope, skipped
 * commands), and the user marks each claim ✓ / ✗ / n-a against what the real machine did.
 * Export produces a markdown report to hand back — the discrepancies are the deliverable, and
 * a clean pass on real hardware is what lets us flip a controller's tier experimental→validated.
 *
 * Everything runs locally in the page: parseGcodeToIR (synchronous, so we can wire the dialect
 * hooks) + the CNC dialect set. No upload, no worker, no repo commit.
 */
import { parseGcodeToIR } from '@chestnutlabs/gcode-parser';
import { createDialectRunner, grblLaser, grblMill, linuxCnc } from '@chestnutlabs/gcode-dialects';
import { MoveKind } from '@chestnutlabs/toolpath-core';

const canvas = document.getElementById('view');
const ctx = canvas.getContext('2d');
const dropHint = document.getElementById('dropHint');
const badges = document.getElementById('badges');
const emptyMsg = document.getElementById('empty');
const reportEl = document.getElementById('report');
const fileInput = document.getElementById('file');
const tgKind = document.getElementById('tgKind');
const tgPower = document.getElementById('tgPower');

const COLORS = {
  cut: '#ff8c42',
  rapid: '#3a6a86',
  extrude: '#4caf7d'
};

/** Current parse, kept so view toggles + resize can redraw without re-parsing. */
let current = null; // { ir, viewMode }

// ---- parse + analyze ---------------------------------------------------------------------

function analyze(text, fileName) {
  const runner = createDialectRunner([grblLaser(), grblMill(), linuxCnc()]);
  const run = runner.createRun({
    selection: 'auto',
    headText: text.slice(0, 64 * 1024),
    tailText: text.slice(-16 * 1024)
  });

  // Count command frequency ourselves (canned cycles, spindle/laser, motion) by wrapping the
  // dialect runner's onCommand — a read-only observer, it never alters the parse.
  const cmdCounts = Object.create(null);
  const onCommand = (event) => {
    if (event.gcode) cmdCounts[event.gcode] = (cmdCounts[event.gcode] || 0) + 1;
    if (run) run.onCommand(event);
  };

  const result = parseGcodeToIR(text, {
    sourceId: fileName,
    modalChannels: ['toolPower'],
    onComment: run ? run.onComment : undefined,
    onCommand
  });
  const ir = result.ir;
  const out = run ? run.finalize(ir) : { metadata: { raw: {} }, warnings: [] };
  const raw = (out.metadata && out.metadata.raw) || {};

  // Move breakdown from the SoA kind column.
  const seg = ir.segments;
  let cut = 0;
  let rapid = 0;
  let extrude = 0;
  for (let i = 0; i < seg.count; i++) {
    const k = seg.kind[i];
    if (k & MoveKind.Cut) cut++;
    else if (k & MoveKind.Extrude) extrude++;
    else if (k & MoveKind.Travel) rapid++;
  }

  // Tool-power range over CUTTING moves only — that's the power actually delivered to the work. A
  // rapid can still carry a latched S (M4 not yet cancelled) but the beam is off, so counting it would
  // over-report the "engaged" tally. Range collapses to lo===hi for a constant-power job.
  let pLo = Infinity;
  let pHi = -Infinity;
  let pSamples = 0;
  const power = seg.modal && seg.modal.toolPower;
  if (power) {
    for (let i = 0; i < seg.count; i++) {
      if (!(seg.kind[i] & MoveKind.Cut)) continue;
      const v = power[i];
      if (Number.isNaN(v)) continue;
      pSamples++;
      if (v < pLo) pLo = v;
      if (v > pHi) pHi = v;
    }
  }

  const canned = ['g81', 'g82', 'g83'].reduce((n, g) => n + (cmdCounts[g] || 0), 0);

  return {
    fileName,
    ir,
    raw,
    counts: { cut, rapid, extrude, total: seg.count },
    power: pSamples ? { lo: pLo, hi: pHi, samples: pSamples } : null,
    cmdCounts,
    canned,
    dialectWarnings: out.warnings || []
  };
}

// ---- rendering (top-down XY, cut vs rapid or power heatmap) -------------------------------

function fitView() {
  const wrap = canvas.parentElement;
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
  if (current) draw();
}
window.addEventListener('resize', fitView);

function powerColor(t) {
  // dark violet → magenta → amber → white (cold→hot laser/spindle power).
  const stops = [
    [0.15, 0.05, 0.3],
    [0.7, 0.1, 0.5],
    [1.0, 0.55, 0.1],
    [1.0, 0.98, 0.85]
  ];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = stops[i];
  const b = stops[Math.min(stops.length - 1, i + 1)];
  const c = a.map((v, j) => Math.round(255 * (v + (b[j] - v) * f)));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function draw() {
  const { ir, viewMode } = current;
  const seg = ir.segments;
  const off = ir.header.originOffset;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!seg.count) return;

  // Absolute XY bounds (delta + origin) over all moves.
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let i = 0; i < seg.count; i++) {
    const ax = seg.x0[i] + off.x,
      bx = seg.x1[i] + off.x,
      ay = seg.y0[i] + off.y,
      by = seg.y1[i] + off.y;
    if (ax < minX) minX = ax;
    if (bx < minX) minX = bx;
    if (ax > maxX) maxX = ax;
    if (bx > maxX) maxX = bx;
    if (ay < minY) minY = ay;
    if (by < minY) minY = by;
    if (ay > maxY) maxY = ay;
    if (by > maxY) maxY = by;
  }
  const pad = 24;
  const w = canvas.width - pad * 2;
  const h = canvas.height - pad * 2;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const s = Math.min(w / spanX, h / spanY);
  const ox = pad + (w - spanX * s) / 2;
  const oy = pad + (h - spanY * s) / 2;
  // Y flips: machine +Y is up, canvas +Y is down.
  const px = (x) => ox + (x - minX) * s;
  const py = (y) => canvas.height - (oy + (y - minY) * s);

  // Reuse the Cut-only range from analyze() so the drawing and the legend always agree.
  const power = seg.modal && seg.modal.toolPower;
  const pRange = current.power; // { lo, hi } over cutting moves, or null
  const constantPower = pRange && pRange.hi - pRange.lo < 1e-6;

  ctx.lineWidth = 1.1;
  ctx.lineCap = 'round';
  // Draw rapids first (thin, behind), then productive moves on top.
  for (const pass of ['rapid', 'productive']) {
    for (let i = 0; i < seg.count; i++) {
      const k = seg.kind[i];
      const isProductive = k & (MoveKind.Cut | MoveKind.Extrude);
      if (pass === 'rapid' && isProductive) continue;
      if (pass === 'productive' && !isProductive) continue;

      let color;
      if (viewMode === 'power' && pRange && isProductive) {
        const v = power[i];
        // Constant-power job: one flat mid-hot tone (there's no range to map); else cold→hot.
        color = Number.isNaN(v)
          ? COLORS.cut
          : constantPower
            ? powerColor(0.7)
            : powerColor((v - pRange.lo) / (pRange.hi - pRange.lo));
      } else if (isProductive) {
        color = k & MoveKind.Extrude ? COLORS.extrude : COLORS.cut;
      } else {
        color = COLORS.rapid;
      }
      ctx.strokeStyle = color;
      ctx.globalAlpha = isProductive ? 1 : viewMode === 'power' ? 0.15 : 0.5;
      ctx.beginPath();
      ctx.moveTo(px(seg.x0[i] + off.x), py(seg.y0[i] + off.y));
      ctx.lineTo(px(seg.x1[i] + off.x), py(seg.y1[i] + off.y));
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// ---- claims report + checklist -----------------------------------------------------------

const marks = new Map(); // claimId -> { verdict, note }

function markButtons(id) {
  const state = marks.get(id) || { verdict: '', note: '' };
  const btn = (v, label, cls) =>
    `<button data-claim="${id}" data-verdict="${v}" class="${state.verdict === v ? cls : ''}">${label}</button>`;
  return `<div class="marks">
      ${btn('ok', '✓ matches', 'sel-ok')}
      ${btn('bad', '✗ wrong', 'sel-bad')}
      ${btn('na', 'n/a', 'sel-na')}
      <input data-note="${id}" placeholder="notes (what the machine actually did)" value="${escapeAttr(state.note)}" />
    </div>`;
}

function claim(id, question, valueHtml) {
  return `<div class="claim">
      <div class="q">${question} ${valueHtml ? `<span class="val">${valueHtml}</span>` : ''}</div>
      ${markButtons(id)}
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}
function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function capClass(c) {
  return c === 'known' ? 'cap-known' : c === 'inferred' ? 'cap-inferred' : 'cap-unavailable';
}

function renderReport(a) {
  const { ir, raw, counts, power, canned, cmdCounts } = a;
  const cap = ir.header.capabilities || {};
  const dialects = ir.header.dialects || [];
  const machineClass = raw['cnc.machineClass'];
  const controller = raw['cnc.controller'];
  const tier = raw['cnc.validationTier'];
  const powerLabel = raw['cnc.toolPowerLabel'] || 'tool power (S)';
  const units = ir.header.units;

  const detected = dialects.length > 0 && !!machineClass;

  // Group parser warnings (esp. unsupported-command) by code.
  const warnGroups = Object.create(null);
  for (const w of ir.header.warnings || []) {
    warnGroups[w.code] = warnGroups[w.code] || { count: 0, sample: w.message };
    warnGroups[w.code].count += w.count || 1;
  }

  const b = ir.boundsWithTravel;
  const dim = (lo, hi) => (hi - lo).toFixed(1);

  let html = '';

  // --- headline: detection ---
  html += `<h2>What we detected</h2>`;
  if (detected) {
    html += `<div class="kv">
      <div><span class="k">Machine class:</span> <b>${escapeHtml(machineClass)}</b></div>
      <div><span class="k">Controller:</span> ${escapeHtml(controller || dialects[0].id)}</div>
      <div><span class="k">Confidence tier:</span> <span class="tier ${tier}">${escapeHtml(
        tier || 'experimental'
      )}</span></div>
    </div>`;
  } else {
    html += `<div class="kv"><b style="color:var(--warn)">Not recognized as CNC/laser.</b>
      <div class="muted">No CNC dialect matched — either it's an FDM file, or a controller/emitter we
      don't yet fingerprint. The claims below still come from the raw parse.</div></div>`;
  }

  // --- the checkable claims ---
  html += `<h2>Check each against the real cut</h2>`;

  if (detected) {
    html += claim(
      'machineClass',
      `We call this a <b>${escapeHtml(machineClass)}</b> job. Is that the machine you ran it on?`,
      ''
    );
  }

  html += claim(
    'moveSplit',
    `<b>${counts.cut.toLocaleString()}</b> cutting/burning moves and <b>${counts.rapid.toLocaleString()}</b> rapids.
     Do the highlighted (orange) moves match where the tool was actually <b>engaged</b>, and the faded ones where it traveled in the air?`,
    ''
  );

  if (power) {
    const source = machineClass === 'mill' ? 'spindle' : 'laser';
    const constant = power.hi - power.lo < 1e-6;
    const desc = constant
      ? `Constant <b>${escapeHtml(powerLabel)} ${fmt(power.lo)}</b> across all
         ${power.samples.toLocaleString()} cutting moves — the ${source} was set once and never modulated
         (so the Power view is a single flat color; there's no ramp to show). Was it a single-power job?`
      : `${escapeHtml(powerLabel)} ranges <b>${fmt(power.lo)}</b>–<b>${fmt(
          power.hi
        )}</b> across ${power.samples.toLocaleString()} cutting moves. Switch to the <b>Power</b> view (colors
         run cold→hot) — does the intensity track how the ${source} actually behaved?`;
    html += claim('power', desc, '');
  } else {
    html += `<div class="claim"><div class="q muted">No modal tool-power (S while engaged) seen — power claim n/a for this file.</div></div>`;
  }

  if (canned > 0) {
    html += claim(
      'canned',
      `<b>${canned}</b> drilling/canned-cycle call(s) (G81/G82/G83). Do the drilled holes land where — and as deep as — the machine actually drilled?`,
      ''
    );
  }

  html += claim(
    'envelope',
    `Work envelope <b>${dim(b.min.x, b.max.x)} × ${dim(b.min.y, b.max.y)} × ${dim(
      b.min.z,
      b.max.z
    )} ${units}</b> (X×Y×Z). Does that match the real part's dimensions?`,
    ''
  );

  html += claim('geometry', `Does the overall path shape on the left match the real part / toolpath?`, '');

  // --- honesty / capability tiers ---
  html += `<h2>Capability honesty (what tier we report)</h2>`;
  html += `<div class="kv">`;
  for (const key of ['cutMoves', 'toolPower', 'cannedCycles']) {
    if (!cap[key]) continue;
    html += `<div><span class="k">${key}:</span> <span class="${capClass(cap[key])}">${cap[key]}</span></div>`;
  }
  html += `</div>`;
  if (tier === 'experimental') {
    html += `<div class="muted" style="margin-top:6px">These read <b>inferred</b> because ${escapeHtml(
      controller || 'this controller'
    )} is still experimental. A clean ✓ pass here is exactly what lets us flip it to <b>validated</b> (→ these become <b>known</b>, warnings drop).</div>`;
  }

  // --- commands we skipped (the gap list) ---
  html += `<h2>Commands we skipped</h2>`;
  const unsupported = warnGroups['unsupported-command'];
  if (unsupported) {
    html += `<div class="warnlist"><div class="warnrow"><code>${
      unsupported.count
    }</code> command(s) the parser didn't interpret. If the real part has features missing from the render, they're likely here.</div>
      <div class="muted" style="margin-top:6px">${escapeHtml(unsupported.sample)}</div></div>`;
  } else {
    html += `<div class="muted">None — every command in the file was interpreted.</div>`;
  }

  // --- all warnings ---
  const warnCodes = Object.keys(warnGroups);
  if (warnCodes.length) {
    html += `<h2>All parser warnings</h2><div class="warnlist">`;
    for (const code of warnCodes) {
      html += `<div class="warnrow"><code>${escapeHtml(code)}</code> ×${warnGroups[code].count}<br /><span class="muted">${escapeHtml(
        warnGroups[code].sample
      )}</span></div>`;
    }
    html += `</div>`;
  }

  // --- command frequency (reference) ---
  html += `<h2>Command frequency</h2><div class="kv">`;
  const freq = Object.entries(cmdCounts)
    .filter(([g]) => g)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 16);
  html += freq.map(([g, n]) => `<span class="k">${escapeHtml(g.toUpperCase())}</span> ${n}`).join(' &nbsp; ');
  html += `</div>`;

  html += `<div class="exportbar">
      <button id="exportBtn">Export report ↓</button>
      <button id="copyBtn" class="ghost">Copy to clipboard</button>
    </div>`;

  reportEl.innerHTML = html;
  reportEl.style.display = 'block';
  emptyMsg.style.display = 'none';

  wireMarks();
  document.getElementById('exportBtn').addEventListener('click', () => exportReport(a, 'download'));
  document.getElementById('copyBtn').addEventListener('click', () => exportReport(a, 'clipboard'));
}

function fmt(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function wireMarks() {
  reportEl.querySelectorAll('button[data-claim]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.claim;
      const state = marks.get(id) || { verdict: '', note: '' };
      state.verdict = state.verdict === btn.dataset.verdict ? '' : btn.dataset.verdict;
      marks.set(id, state);
      // repaint just this claim's buttons
      const row = btn.closest('.claim');
      row.querySelectorAll('button[data-claim]').forEach((b2) => {
        const sel = state.verdict === b2.dataset.verdict;
        b2.className = sel ? { ok: 'sel-ok', bad: 'sel-bad', na: 'sel-na' }[b2.dataset.verdict] : '';
      });
    });
  });
  reportEl.querySelectorAll('input[data-note]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const id = inp.dataset.note;
      const state = marks.get(id) || { verdict: '', note: '' };
      state.note = inp.value;
      marks.set(id, state);
    });
  });
}

const CLAIM_LABELS = {
  machineClass: 'Machine class correct',
  moveSplit: 'Cut-vs-rapid split correct',
  power: 'Tool-power ramp correct',
  canned: 'Canned/drilling cycles correct',
  envelope: 'Work envelope matches part',
  geometry: 'Overall path shape matches'
};

function exportReport(a, dest) {
  const { ir, raw, counts, power, canned } = a;
  const tier = raw['cnc.validationTier'] || 'n/a';
  const lines = [];
  lines.push(`# Hardware validation — ${a.fileName}`);
  lines.push('');
  lines.push(
    `- Detected: **${raw['cnc.machineClass'] || 'NOT DETECTED'}** / ${raw['cnc.controller'] || '—'} (tier: ${tier})`
  );
  lines.push(`- Moves: ${counts.cut} cut, ${counts.rapid} rapid, ${counts.total} total`);
  if (power)
    lines.push(
      power.hi - power.lo < 1e-6
        ? `- Tool power: constant ${fmt(power.lo)} over ${power.samples} cutting moves`
        : `- Tool power: ${fmt(power.lo)}–${fmt(power.hi)} over ${power.samples} cutting moves`
    );
  if (canned) lines.push(`- Canned cycles: ${canned}`);
  const b = ir.boundsWithTravel;
  lines.push(
    `- Envelope: ${(b.max.x - b.min.x).toFixed(1)} × ${(b.max.y - b.min.y).toFixed(1)} × ${(b.max.z - b.min.z).toFixed(
      1
    )} ${ir.header.units}`
  );
  lines.push('');
  lines.push('## Findings');
  lines.push('');
  lines.push('| Claim | Verdict | Notes |');
  lines.push('| --- | --- | --- |');
  for (const [id, label] of Object.entries(CLAIM_LABELS)) {
    const m = marks.get(id);
    if (!m || (!m.verdict && !m.note)) continue;
    const v = { ok: '✓ matches', bad: '✗ WRONG', na: 'n/a' }[m.verdict] || '—';
    lines.push(`| ${label} | ${v} | ${(m.note || '').replace(/\|/g, '\\|')} |`);
  }
  // Any claims left unmarked
  const unmarked = Object.entries(CLAIM_LABELS).filter(([id]) => {
    const m = marks.get(id);
    return !m || (!m.verdict && !m.note);
  });
  if (unmarked.length) {
    lines.push('');
    lines.push(`_Unreviewed: ${unmarked.map(([, l]) => l).join(', ')}_`);
  }
  const md = lines.join('\n');

  if (dest === 'clipboard') {
    navigator.clipboard.writeText(md).then(
      () => flash('Copied report to clipboard'),
      () => flash('Clipboard blocked — use Export instead')
    );
  } else {
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = a.fileName.replace(/\.[^.]+$/, '') + '.validation.md';
    link.click();
    URL.revokeObjectURL(url);
  }
}

function flash(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText =
    'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1c5a5f;color:#eafeff;padding:8px 16px;border-radius:6px;font-size:13px;z-index:10';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

// ---- load flow ---------------------------------------------------------------------------

async function loadFile(file) {
  const text = await file.text();
  marks.clear();
  const a = analyze(text, file.name);
  current = {
    ir: a.ir,
    viewMode: tgPower.classList.contains('on') ? 'power' : 'kind',
    power: a.power,
    powerLabel: a.raw['cnc.toolPowerLabel'] || 'tool power (S)',
    hasExtrude: a.counts.extrude > 0
  };
  dropHint.classList.add('hide');
  updateBadges();
  fitView();
  renderReport(a);
}

/** The view legend, keyed to the active color mode — cut/rapid swatches, or a cold→hot power scale
 *  with the real min/max (or a "constant" note when the job never modulates power). */
function updateBadges() {
  if (!current) {
    badges.style.display = 'none';
    return;
  }
  badges.style.display = 'flex';
  if (current.viewMode === 'power') {
    const p = current.power;
    if (!p) {
      badges.innerHTML = `<span class="muted">No tool-power (S) recorded — nothing to color by power.</span>`;
      return;
    }
    if (p.hi - p.lo < 1e-6) {
      badges.innerHTML = `<span><span class="swatch" style="background:${powerColor(
        0.7
      )}"></span>constant ${escapeHtml(current.powerLabel)} <b>${fmt(p.lo)}</b> (no variation)</span>`;
      return;
    }
    const bar = 'linear-gradient(to right,' + [0, 0.33, 0.66, 1].map((t) => powerColor(t)).join(',') + ')';
    badges.innerHTML =
      `<span class="muted">${escapeHtml(current.powerLabel)}</span>` +
      `<span style="font-variant-numeric:tabular-nums">${fmt(p.lo)}</span>` +
      `<span style="display:inline-block;width:120px;height:11px;border-radius:2px;background:${bar}"></span>` +
      `<span style="font-variant-numeric:tabular-nums">${fmt(p.hi)}</span>` +
      `<span class="muted">cold → hot · rapids faded</span>`;
    return;
  }
  badges.innerHTML =
    `<span><span class="swatch" style="background:var(--cut)"></span>${
      current.hasExtrude ? 'cut / extrude' : 'cut / burn'
    }</span>` + `<span><span class="swatch" style="background:var(--rapid)"></span>rapid / travel</span>`;
}

fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadFile(fileInput.files[0]);
});

/** Load one of the bundled test-data fixtures by name (?sample=easel) as a synthesized File —
 *  a zero-setup "try it" path that runs the exact same flow as a user-picked file. */
async function loadSample(name) {
  const res = await fetch(`./gcodes/${name}.gcode`);
  if (!res.ok) return;
  const text = await res.text();
  await loadFile(new File([text], `${name}.gcode`, { type: 'text/plain' }));
}
const sample = new URLSearchParams(location.search).get('sample');
if (sample) loadSample(sample.replace(/[^\w.-]/g, ''));

// drag & drop
const wrap = document.getElementById('viewWrap');
['dragover', 'dragenter'].forEach((ev) =>
  wrap.addEventListener(ev, (e) => {
    e.preventDefault();
    wrap.style.outline = '2px dashed #1c5a5f';
  })
);
['dragleave', 'drop'].forEach((ev) =>
  wrap.addEventListener(ev, (e) => {
    e.preventDefault();
    wrap.style.outline = 'none';
  })
);
wrap.addEventListener('drop', (e) => {
  const f = e.dataTransfer.files[0];
  if (f) loadFile(f);
});

// view toggles
tgKind.addEventListener('click', () => {
  tgKind.classList.add('on');
  tgPower.classList.remove('on');
  if (current) {
    current.viewMode = 'kind';
    updateBadges();
    draw();
  }
});
tgPower.addEventListener('click', () => {
  tgPower.classList.add('on');
  tgKind.classList.remove('on');
  if (current) {
    current.viewMode = 'power';
    updateBadges();
    draw();
  }
});

fitView();
