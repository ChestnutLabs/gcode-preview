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

let lastHandle: ReturnType<typeof useModelViewer> | null = null;

function Probe() {
  const viewer = useModelViewer({ createRenderer: MODEL_STUB_GL, createControls: MODEL_STUB_CONTROLS });
  lastHandle = viewer;
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

  it('a handle call after unmount is refused (E_MODEL_PREVIEW_DISPOSED), never a rebuilt controller that hangs', async () => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    spy.disposes.length = 0;
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(Probe));
    });
    const handle = lastHandle!;
    const created = spy.disposes.length;
    await act(async () => root?.unmount());
    host.remove();
    const outcome = await Promise.race([
      handle.setSource({ kind: 'stl', bytes: new Uint8Array(84) }).then(
        () => 'resolved',
        (e: unknown) => (e as Error).message
      ),
      new Promise<string>((r) => setTimeout(() => r('HANG'), 2_000))
    ]);
    expect(outcome).toBe('E_MODEL_PREVIEW_DISPOSED');
    await expect(handle.controls.setSource({ kind: 'stl', bytes: new Uint8Array(84) })).rejects.toThrow(
      'E_MODEL_PREVIEW_DISPOSED'
    );
    expect(spy.disposes.length).toBe(created); // no controller was rebuilt after the unmount
  });
});
