import { describe, it, expect } from 'vitest';
import {
  describeCause,
  describeError,
  renderErrorDetail,
  createErrorDetail,
  ERROR_DETAIL_IDLE
} from './demo/src/error-detail.js';
import { cutRowState } from './demo/src/cut-row.js';

describe('Feature Lab error detail: describeCause', () => {
  it('is null for no cause', () => {
    expect(describeCause(undefined)).toBeNull();
    expect(describeCause(null)).toBeNull();
  });
  it('reads an Error: plain Error is its message, a subclass is name: message', () => {
    expect(describeCause(new Error('no webgl'))).toBe('no webgl');
    expect(describeCause(new TypeError('x is not a function'))).toBe('TypeError: x is not a function');
  });
  it('reads a string, a message-bearing object, and anything else', () => {
    expect(describeCause('boom')).toBe('boom');
    expect(describeCause({ message: 'from worker' })).toBe('from worker');
    expect(describeCause(42)).toBe('42');
  });
  it('never throws on a hostile cause', () => {
    const hostile = {
      get message() {
        throw new Error('getter');
      }
    };
    expect(describeCause(hostile)).toBe('unreadable error');
  });
});

describe('Feature Lab error detail: describeError / renderErrorDetail', () => {
  it('describes a renderer error with reason and cause', () => {
    const d = describeError({
      code: 'E_RENDERER_LOAD',
      message: 'no webgl',
      reason: 'start',
      cause: new Error('ctx lost')
    });
    expect(d).toEqual({
      code: 'E_RENDERER_LOAD',
      message: 'no webgl',
      reason: 'start',
      hint: 'the renderer downloaded but could not start, usually no WebGL; the 2D renderer still works',
      cause: 'ctx lost'
    });
  });
  it('leaves reason, hint and cause null when the error has none', () => {
    expect(describeError({ code: 'E_UNKNOWN', message: 'm' })).toEqual({
      code: 'E_UNKNOWN',
      message: 'm',
      reason: null,
      hint: null,
      cause: null
    });
  });
  it('falls back to E_UNKNOWN and an empty message for a bare object', () => {
    expect(describeError({})).toMatchObject({ code: 'E_UNKNOWN', message: '' });
  });
  it('keeps an unknown reason without a hint', () => {
    expect(describeError({ code: 'E_X', message: 'm', reason: 'later' })).toMatchObject({
      reason: 'later',
      hint: null
    });
  });
  it('shows only the rows that exist, and escapes everything', () => {
    expect(renderErrorDetail({ code: 'E_A', message: 'plain' })).toBe(
      '<ul class="gp-notes"><li><span class="gp-badge gp-unavailable">E_A</span> <span class="gp-note-text">plain</span></li></ul>'
    );
    const html = renderErrorDetail({ code: 'E_RENDERER_LOAD', message: '<b>', reason: 'load', cause: 'a & b' });
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain(
      '<span class="gp-note-count">reason</span> <span class="gp-note-text">load: the renderer code could not be downloaded; reloading the page can help</span>'
    );
    expect(html).toContain('<span class="gp-note-count">cause</span> <span class="gp-note-text">a &amp; b</span>');
  });
});

describe('Feature Lab error detail: createErrorDetail', () => {
  const err = (type, extra = {}) => ({ type, code: 'E_WORKER_CREATE_FAILED', message: 'm', ...extra });
  it('ignores unrelated events', () => {
    const r = createErrorDetail();
    expect(r.onEvent({ type: 'parse-started' })).toBeUndefined();
    expect(r.onEvent({ type: 'parse-complete' })).toBeUndefined();
    expect(r.onEvent(undefined)).toBeUndefined();
  });
  it('shows a parse-error with its cause, and clears it when the next file loads', () => {
    const r = createErrorDetail();
    expect(r.onEvent(err('parse-error', { cause: new Error('SecurityError') }))).toContain('SecurityError');
    expect(r.onEvent({ type: 'parse-complete' })).toBe(ERROR_DETAIL_IDLE);
    expect(r.onEvent({ type: 'parse-complete' })).toBeUndefined();
  });
  it('keeps a renderer error through a successful parse', () => {
    const r = createErrorDetail();
    r.onEvent(err('error', { code: 'E_RENDERER_LOAD', reason: 'start' }));
    expect(r.onEvent({ type: 'parse-complete' })).toBeUndefined();
  });
  it('ignores an advisory event of type error (lower-case code, no E_ prefix)', () => {
    const r = createErrorDetail();
    expect(
      r.onEvent({ type: 'error', code: 'machine-geometry-mismatch', message: 'bed differs', severity: 'warn' })
    ).toBeUndefined();
    expect(r.onEvent({ type: 'error', message: 'no code' })).toBeUndefined();
    // and it does not displace a real error
    r.onEvent(err('parse-error', { code: 'E_PARSE' }));
    expect(r.onEvent({ type: 'error', code: 'machine-geometry-mismatch', message: 'x' })).toBeUndefined();
  });
  it('a later error replaces an earlier one', () => {
    const r = createErrorDetail();
    r.onEvent(err('error', { code: 'E_RENDERER_LOAD', reason: 'start' }));
    const html = r.onEvent(err('parse-error', { code: 'E_PARSE' }));
    expect(html).toContain('E_PARSE');
    expect(html).not.toContain('E_RENDERER_LOAD');
  });
});

describe('Feature Lab Cut moves row: cutRowState', () => {
  it('is plain and disabled before a file is ready', () => {
    expect(cutRowState(null, false)).toEqual({ label: 'Cut moves', disabled: true });
    expect(cutRowState(false, false)).toEqual({ label: 'Cut moves', disabled: true });
  });
  it('is enabled for a ready file with cuts', () => {
    expect(cutRowState(true, true)).toEqual({ label: 'Cut moves', disabled: false });
  });
  it('says none in this file, disabled, for a ready file without cuts', () => {
    expect(cutRowState(false, true)).toEqual({ label: 'Cut moves — none in this file', disabled: true });
  });
  it('a ready viewer with no file known stays enabled and plain', () => {
    expect(cutRowState(null, true)).toEqual({ label: 'Cut moves', disabled: false });
  });
});
