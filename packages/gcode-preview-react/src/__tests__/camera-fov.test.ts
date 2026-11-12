// @vitest-environment happy-dom
/** DD-032: the declarative `cameraFov` prop (construction option + effect; unset keeps the lens). */
import { describe, expect, it } from 'vitest';
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreview, type GcodePreviewHandle } from '../index';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

describe('<GcodePreview> cameraFov (react)', () => {
  it('applies the mount value, follows changes, and keeps the lens when unset', async () => {
    const canvas = document.createElement('canvas');
    const ref = createRef<GcodePreviewHandle>();
    const el = (cameraFov: number | undefined) =>
      createElement(GcodePreview, {
        ref,
        source: null,
        quality: 'lines',
        cameraFov,
        createWorker: () => new SuiteStubWorker(),
        rendererOptions: {
          createRenderer: () => makeSuiteStubGL(canvas),
          scheduleFrame: (cb: () => void) => cb(),
          chunksPerTick: 8
        }
      });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const lens = (): number => (ref.current!.raw.renderer() as unknown as { cameraFov: number }).cameraFov;
    await act(async () => root.render(el(32)));
    await settle();
    expect(lens()).toBe(32);
    await act(async () => root.render(el(40)));
    await settle();
    expect(lens()).toBe(40);
    await act(async () => root.render(el(undefined)));
    await settle();
    expect(lens()).toBe(40);
    await act(async () => root.unmount());
    host.remove();
  });
});
