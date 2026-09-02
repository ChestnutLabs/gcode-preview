// @vitest-environment happy-dom
/**
 * Regression: the React <ModelViewer> / useModelViewer hook must DISPOSE its controller on unmount,
 * matching the toolpath hook (and Vue/Svelte/Element). Previously only the GL engine was freed via the
 * canvas-ref-null path; the controller was never disposed, so in-flight setSource promises never
 * settled and the controller leaked. We spy on the controller factory and assert dispose() on unmount.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MODEL_STUB_GL, MODEL_STUB_CONTROLS } from '@chestnutlabs/gcode-model-renderer/testing';

const spy = vi.hoisted(() => ({ disposes: [] as ReturnType<typeof vi.fn>[] }));

vi.mock('@chestnutlabs/gcode-model-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chestnutlabs/gcode-model-renderer')>();
  return {
    ...actual,
    createModelPreviewController: (opts?: Parameters<typeof actual.createModelPreviewController>[0]) => {
      const controller = actual.createModelPreviewController(opts);
      const disposeSpy = vi.fn(controller.dispose.bind(controller));
      controller.dispose = disposeSpy;
      spy.disposes.push(disposeSpy);
      return controller;
    }
  };
});

// Import AFTER vi.mock so the hook binds to the spied factory.
const { useModelViewer } = await import('../model/index');

function Probe() {
  const viewer = useModelViewer({ createRenderer: MODEL_STUB_GL, createControls: MODEL_STUB_CONTROLS });
  return createElement('canvas', { ref: viewer.canvasRef });
}

describe('<ModelViewer> (react) — disposes its controller on unmount (regression)', () => {
  it('calls controller.dispose() when the component unmounts', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    spy.disposes.length = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(Probe));
    });
    await act(async () => {
      for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    });
    expect(spy.disposes.length).toBeGreaterThan(0); // the hook created a controller through the factory
    const disposedBefore = spy.disposes.some((d) => d.mock.calls.length > 0);
    expect(disposedBefore).toBe(false); // still mounted → not disposed yet

    await act(async () => root?.unmount());
    host.remove();

    const disposedAfter = spy.disposes.some((d) => d.mock.calls.length > 0);
    expect(disposedAfter).toBe(true); // unmount must dispose the controller
  });
});
