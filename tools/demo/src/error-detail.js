/*
 * Feature Lab "Last error": what the Diagnostics tab shows when a load fails. Reads only the public
 * PreviewError fields (`code`, `message`, `reason`, `cause`, #589/#596) off the `error` / `parse-error`
 * events. Pure (no DOM), so the wording and the markup are unit-tested in Node.
 */
import { escapeHtml } from './parse-notes.js';

/** What each E_RENDERER_LOAD `reason` means for the person looking at the page. */
export const REASON_HINTS = {
  load: 'the renderer code could not be downloaded; reloading the page can help',
  start: 'the renderer downloaded but could not start, usually no WebGL; the 2D renderer still works'
};

/** The original error as one line, or null when there is none. Never throws, whatever `cause` is. */
export function describeCause(cause) {
  if (cause === undefined || cause === null) return null;
  try {
    if (cause instanceof Error)
      return cause.name && cause.name !== 'Error' ? `${cause.name}: ${cause.message}` : cause.message;
    if (typeof cause === 'string') return cause;
    if (typeof cause === 'object' && typeof cause.message === 'string') return cause.message;
    return String(cause);
  } catch {
    return 'unreadable error';
  }
}

/** `{ code, message, reason, hint, cause }` for one PreviewError; absent fields are null. */
export function describeError(e) {
  const reason = typeof e?.reason === 'string' ? e.reason : null;
  return {
    code: String(e?.code ?? 'E_UNKNOWN'),
    message: String(e?.message ?? ''),
    reason,
    hint: reason === null ? null : (REASON_HINTS[reason] ?? null),
    cause: describeCause(e?.cause)
  };
}

export const ERROR_DETAIL_IDLE = '<p class="gp-hint">No error so far.</p>';

/** Markup for one error: a row each for the code, message, reason (E_RENDERER_LOAD) and cause. */
export function renderErrorDetail(e) {
  const d = describeError(e);
  const row = (label, value) =>
    `<li><span class="gp-note-count">${label}</span> <span class="gp-note-text">${escapeHtml(value)}</span></li>`;
  const rows = [
    `<li><span class="gp-badge gp-unavailable">${escapeHtml(d.code)}</span> <span class="gp-note-text">${escapeHtml(d.message)}</span></li>`
  ];
  if (d.reason !== null) rows.push(row('reason', d.hint === null ? d.reason : `${d.reason}: ${d.hint}`));
  if (d.cause !== null) rows.push(row('cause', d.cause));
  return `<ul class="gp-notes">${rows.join('')}</ul>`;
}

/**
 * The section as a reducer over the controller's events. `onEvent(e)` returns the new markup, or `undefined`
 * for an event it ignores. An `error` (renderer or control) stays until the next `error`. A `parse-error`
 * is cleared by the next `parse-complete`, which brings a file that did load; it never clears a renderer error.
 */
export function createErrorDetail() {
  let shown = null; // { markup, fromParse }
  return {
    onEvent(e) {
      switch (e?.type) {
        case 'error':
          // The renderer also forwards advisory events of this type (e.g. machine-geometry-mismatch, which has
          // a lower-case code and a severity). A PreviewError code starts with E_.
          if (typeof e.code !== 'string' || !e.code.startsWith('E_')) return undefined;
          shown = { markup: renderErrorDetail(e), fromParse: false };
          return shown.markup;
        case 'parse-error':
          shown = { markup: renderErrorDetail(e), fromParse: true };
          return shown.markup;
        case 'parse-complete':
          if (shown !== null && shown.fromParse) {
            shown = null;
            return ERROR_DETAIL_IDLE;
          }
          return undefined;
        default:
          return undefined;
      }
    }
  };
}
