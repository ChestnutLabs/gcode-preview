// @vitest-environment happy-dom
/**
 * <GcodePreview> component + StrictMode tests (DD-007 D1 amendment, phase 6, #113).
 */
import { describe, expect, it } from 'vitest';
import { StrictMode, act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreview, type GcodePreviewHandle } from '../index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

function mountPreview(opts: { strict?: boolean; source?: Uint8Array } = {}) {
  const canvas = document.createElement('canvas');
  const ref = createRef<GcodePreviewHandle>();
  const events: Record<string, unknown[]> = {};
  const record = (name: string) => (payload?: unknown) => {
    (events[name] ??= []).push(payload);
  };
  const el = createElement(GcodePreview, {
    ref,
    source: opts.source ?? null,
    quality: 'lines',
    createWorker: () => new SuiteStubWorker(),
    rendererOptions: {
      createRenderer: () => makeSuiteStubGL(canvas),
      scheduleFrame: (cb: () => void) => cb(),
      chunksPerTick: 8
    },
    onReady: record('ready'),
    onBuildComplete: record('build-complete')
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  return {
    ref,
    events,
    host,
    async mount() {
      await act(async () => {
        root = createRoot(host);
        root.render(opts.strict === true ? createElement(StrictMode, null, el) : el);
      });
    },
    async unmount() {
      await act(async () => root?.unmount());
      host.remove();
    }
  };
}

describe('<GcodePreview> (react)', () => {
  it('source prop parses and fires callbacks; the ref exposes the hook handle', async () => {
    const m = mountPreview({ source: new Uint8Array(1_000) });
    await m.mount();
    await settle();
    expect(m.events['ready']?.[0]).toMatchObject({ segments: 12, layers: 2, complete: true });
    expect(m.ref.current?.state.summary?.segments).toBe(12);
    expect(m.ref.current?.raw.renderer()).not.toBeNull();
    await m.unmount();
  });

  it('StrictMode double-mount neither leaks workers nor breaks parsing', async () => {
    const created0 = SuiteStubWorker.created;
    const terminated0 = SuiteStubWorker.terminated;
    const m = mountPreview({ strict: true, source: new Uint8Array(1_000) });
    await m.mount();
    await settle();
    // The remounted instance must be fully functional after StrictMode's dispose/recreate —
    // INCLUDING the renderer: refs never re-fire, so the effect must rebind the canvas
    // (this exact assertion caught a real black-canvas bug in the example app).
    expect(m.ref.current?.state.summary?.segments).toBe(12);
    expect(m.ref.current?.raw.renderer()).not.toBeNull();
    expect(m.ref.current?.raw.renderer()?.segmentCount).toBe(12);
    await m.unmount();
    // Every created worker is terminated — no leaks across the double lifecycle.
    expect(SuiteStubWorker.created - created0).toBeGreaterThan(0);
    expect(SuiteStubWorker.terminated - terminated0).toBe(SuiteStubWorker.created - created0);
  });
});
