/*
 * Feature Lab "Parse notes": groups the parse warnings a `parse-complete` event carries into one row per
 * code, for the Diagnostics tab. Pure (no DOM), so the grouping and the markup are unit-tested in Node.
 *
 * Honesty wording (USER_FACING_DOCS_STYLE.md): these are notes on what the parser inferred, approximated
 * or kept as metadata. They are not errors, and the preview is still drawn.
 */

/** The parser's one code for every command it keeps as metadata instead of drawing (m73, m201, g40 …). */
export const METADATA_CODE = 'unsupported-command';

const SEVERITY_RANK = { info: 0, warn: 1, error: 2 };

/**
 * One row per warning code: `{ code, count, severity, label, example }`, most frequent first (ties by
 * code). `count` sums each warning's own `count`, or 1 when it has none. `severity` is the worst one seen.
 * The first message is kept: as the label for most codes, and as the example for METADATA_CODE, whose
 * label is generic because its first message names only one of the commands it counts.
 */
export function groupWarnings(warnings) {
  const byCode = new Map();
  for (const w of warnings ?? []) {
    const n = Number.isFinite(w.count) && w.count > 0 ? w.count : 1;
    const g = byCode.get(w.code);
    if (g === undefined) {
      byCode.set(w.code, { code: w.code, count: n, severity: w.severity, message: w.message });
    } else {
      g.count += n;
      if ((SEVERITY_RANK[w.severity] ?? 0) > (SEVERITY_RANK[g.severity] ?? 0)) g.severity = w.severity;
    }
  }
  return [...byCode.values()]
    .sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map(({ code, count, severity, message }) =>
      code === METADATA_CODE
        ? { code, count, severity, label: 'Commands kept as metadata (not drawn)', example: message }
        : { code, count, severity, label: message, example: null }
    );
}

export function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/** Markup for the Parse notes list. `formatCount` is the demo's locale number format. */
export function renderParseNotes(groups, formatCount = String) {
  if (groups.length === 0) return '<p class="gp-hint">No parse notes for this file.</p>';
  const rows = groups.map((g) => {
    const badge = g.severity === 'error' ? 'gp-badge gp-unavailable' : 'gp-badge';
    const example = g.example === null ? '' : ` <span class="gp-note-eg">e.g. ${escapeHtml(g.example)}</span>`;
    return (
      `<li><span class="${badge}" title="severity: ${escapeHtml(g.severity)}">${escapeHtml(g.code)}</span>` +
      ` <span class="gp-note-count">×${escapeHtml(formatCount(g.count))}</span>` +
      ` <span class="gp-note-text">${escapeHtml(g.label)}</span>${example}</li>`
    );
  });
  return `<ul class="gp-notes">${rows.join('')}</ul>`;
}
