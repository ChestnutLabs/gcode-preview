import { describe, it, expect } from 'vitest';
import { groupWarnings, renderParseNotes, escapeHtml } from './demo/src/parse-notes.js';

const w = (code, message, extra = {}) => ({ code, message, severity: 'warn', ...extra });

describe('Feature Lab parse notes: groupWarnings', () => {
  it('returns no rows for no warnings (and for a missing list)', () => {
    expect(groupWarnings([])).toEqual([]);
    expect(groupWarnings(undefined)).toEqual([]);
  });

  it('sums each warning count, defaulting to 1 when absent or not a positive number', () => {
    const rows = groupWarnings([
      w('arc-radius-too-small', 'first', { count: 3 }),
      w('arc-radius-too-small', 'second'),
      w('arc-radius-too-small', 'third', { count: 0 }),
      w('arc-radius-too-small', 'fourth', { count: Number.NaN })
    ]);
    expect(rows).toEqual([{ code: 'arc-radius-too-small', count: 6, severity: 'warn', label: 'first', example: null }]);
  });

  it('keeps the first message of a code, not a later one', () => {
    const rows = groupWarnings([w('layers-unavailable', 'one'), w('layers-unavailable', 'two')]);
    expect(rows[0].label).toBe('one');
  });

  it('labels the metadata code generically and shows its first message as the example', () => {
    const rows = groupWarnings([
      w('unsupported-command', "unsupported command 'm73' preserved as metadata", { count: 6549 }),
      w('unsupported-command', "unsupported command 'm201' preserved as metadata")
    ]);
    expect(rows).toEqual([
      {
        code: 'unsupported-command',
        count: 6550,
        severity: 'warn',
        label: 'Commands kept as metadata (not drawn)',
        example: "unsupported command 'm73' preserved as metadata"
      }
    ]);
  });

  it('sorts by count, highest first, then by code', () => {
    const rows = groupWarnings([
      w('b-code', 'b'),
      w('z-code', 'z', { count: 5 }),
      w('a-code', 'a'),
      w('m-code', 'm', { count: 2 })
    ]);
    expect(rows.map((r) => r.code)).toEqual(['z-code', 'm-code', 'a-code', 'b-code']);
  });

  it('keeps the worst severity seen for a code', () => {
    const rows = groupWarnings([
      w('x', 'a', { severity: 'info' }),
      w('x', 'b', { severity: 'error' }),
      w('x', 'c', { severity: 'warn' })
    ]);
    expect(rows[0].severity).toBe('error');
    expect(groupWarnings([w('y', 'a', { severity: 'warn' }), w('y', 'b', { severity: 'info' })])[0].severity).toBe(
      'warn'
    );
  });
});

describe('Feature Lab parse notes: renderParseNotes', () => {
  it('says so when there are no notes', () => {
    expect(renderParseNotes([])).toBe('<p class="gp-hint">No parse notes for this file.</p>');
  });

  it('renders one row per code with the count, label and example', () => {
    const html = renderParseNotes(
      [
        {
          code: 'unsupported-command',
          count: 6549,
          severity: 'warn',
          label: 'Commands kept as metadata (not drawn)',
          example: 'm73'
        },
        { code: 'layers-unavailable', count: 1, severity: 'warn', label: 'No planar layer index.', example: null }
      ],
      (n) => `#${n}`
    );
    expect(html).toBe(
      '<ul class="gp-notes">' +
        '<li><span class="gp-badge" title="severity: warn">unsupported-command</span>' +
        ' <span class="gp-note-count">×#6549</span>' +
        ' <span class="gp-note-text">Commands kept as metadata (not drawn)</span>' +
        ' <span class="gp-note-eg">e.g. m73</span></li>' +
        '<li><span class="gp-badge" title="severity: warn">layers-unavailable</span>' +
        ' <span class="gp-note-count">×#1</span>' +
        ' <span class="gp-note-text">No planar layer index.</span></li>' +
        '</ul>'
    );
  });

  it('marks only error severity with the unavailable badge', () => {
    const html = renderParseNotes([{ code: 'e', count: 1, severity: 'error', label: 'x', example: null }]);
    expect(html).toContain('<span class="gp-badge gp-unavailable" title="severity: error">e</span>');
  });

  it('escapes file-derived text', () => {
    expect(escapeHtml(`<b a="1">&'</b>`)).toBe('&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;');
    const html = renderParseNotes([{ code: '<c>', count: 1, severity: 'warn', label: '<l>', example: '<e>' }]);
    expect(html).not.toMatch(/<c>|<l>|<e>/);
    expect(html).toContain('&lt;e&gt;');
  });
});
