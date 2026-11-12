import { describe, it, expect, vi } from 'vitest';
import type { GLRendererLike, RenderTargetCanvas } from '@chestnutlabs/gcode-renderer-three';
import type { ModelViewerOptions } from '../model-viewer.js';

const seen: ModelViewerOptions[] = [];
vi.mock('../model-viewer.js', async () => {
  const actual = await vi.importActual<typeof import('../model-viewer.js')>('../model-viewer.js');
  return {
    ...actual,
    createModelViewer: (c: RenderTargetCanvas, o: ModelViewerOptions) => {
      seen.push(o);
      return actual.createModelViewer(c, o);
    }
  };
});

const { createModelPreviewController } = await import('../model-preview.js');
const { IDENTITY_MAT4 } = await import('../scene-model.js');
import type { ModelScene } from '../scene-model.js';

const canvas = (): RenderTargetCanvas => ({ width: 8, height: 8 }) as unknown as RenderTargetCanvas;
const gl = (d: RenderTargetCanvas): GLRendererLike => ({
  render: () => undefined,
  setSize: () => undefined,
  dispose: () => undefined,
  domElement: d
});
const sc = (): ModelScene => ({
  objects: [
    { id: 'a', geometry: { positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]) }, transform: IDENTITY_MAT4 }
  ],
  bounds: { min: [0, 0, 0], max: [10, 10, 0] },
  capabilities: {
    materials: 'unavailable',
    transforms: 'unavailable',
    multiObject: 'unavailable',
    instanced: 'unavailable',
    plates: 'unavailable'
  }
});
const last = (): ModelViewerOptions => seen[seen.length - 1];

describe('controller remembers scope / background / interaction quality across a rebind', () => {
  it('re-applies the consumer values, not the initial options', () => {
    seen.length = 0;
    const c = createModelPreviewController({
      createRenderer: gl,
      renderScope: { objectIds: ['init'] },
      background: '#111111',
      interactionQuality: 'auto'
    });
    c.bindCanvas(canvas());
    expect(last().renderScope).toEqual({ objectIds: ['init'] });
    expect(last().background).toBe('#111111');
    expect(last().interactionQuality).toBe('auto');
    c.controls.setRenderScope({ plateId: 2 });
    c.controls.setBackground('#ff0000');
    c.controls.setInteractionQuality('off');
    c.bindCanvas(canvas());
    expect(last().renderScope).toEqual({ plateId: 2 });
    expect(last().background).toBe('#ff0000');
    expect(last().interactionQuality).toBe('off');
    c.controls.setRenderScope(null);
    c.bindCanvas(canvas());
    expect(last().renderScope).toBeUndefined();
    c.dispose();
  });

  it('values set before the first bind reach the engine exactly once', () => {
    seen.length = 0;
    const c = createModelPreviewController({ createRenderer: gl });
    c.controls.setRenderScope({ objectIds: ['a'] });
    c.controls.setBackground('#00ff00');
    c.controls.setInteractionQuality('off');
    expect(seen).toHaveLength(0);
    c.bindCanvas(canvas());
    expect(seen).toHaveLength(1);
    expect(last().renderScope).toEqual({ objectIds: ['a'] });
    expect(last().background).toBe('#00ff00');
    expect(last().interactionQuality).toBe('off');
    c.dispose();
  });

  it('an invalid scope throws RangeError synchronously and is not stored', () => {
    seen.length = 0;
    const c = createModelPreviewController({ createRenderer: gl, renderScope: { objectIds: ['ok'] } });
    expect(() => c.controls.setRenderScope({ objectIds: 'a' } as never)).toThrow(RangeError);
    c.bindCanvas(canvas());
    expect(last().renderScope).toEqual({ objectIds: ['ok'] });
    c.dispose();
    expect(() => createModelPreviewController({ renderScope: {} as never })).toThrow(RangeError);
  });
});

describe('controller lifecycle edges', () => {
  it('setSource after dispose rejects instead of hanging, and does not flip loading', async () => {
    const c = createModelPreviewController({ createRenderer: gl });
    c.dispose();
    await expect(c.controls.setSource(sc())).rejects.toThrow('E_MODEL_PREVIEW_DISPOSED');
    expect(c.getState().loading).toBe(false);
  });

  it('capture before a canvas binds rejects with CaptureUnsupportedError (code)', async () => {
    const c = createModelPreviewController({ createRenderer: gl });
    await expect(c.controls.capture()).rejects.toMatchObject({
      code: 'E_CAPTURE_UNSUPPORTED',
      name: 'CaptureUnsupportedError'
    });
    c.dispose();
  });

  it('a superseded load that fails emits no error event and leaves the newer ready state clean', async () => {
    const slow = {
      kind: 'slow',
      parse: () => new Promise<ModelScene>((_, rej) => setTimeout(() => rej(new Error('boom')), 30))
    };
    const c = createModelPreviewController({ createRenderer: gl, loaders: [slow] });
    const types: string[] = [];
    c.onEvent((e) => types.push(e.type));
    c.bindCanvas(canvas());
    const p1 = c.controls.setSource({ kind: 'slow', bytes: new Uint8Array(1) });
    const p1Settled = p1.then(
      () => 'resolved',
      (e: Error) => e.message
    );
    await c.controls.setSource(sc());
    expect(await p1Settled).toBe('boom'); // its own caller still sees the failure
    const s = c.getState();
    expect(s.ready).toBe(true);
    expect(s.error).toBeNull();
    expect(types).not.toContain('error');
    c.dispose();
  });

  it('the current load that fails still emits error', async () => {
    const bad = { kind: 'bad', parse: () => Promise.reject(new Error('nope')) };
    const c = createModelPreviewController({ createRenderer: gl, loaders: [bad] });
    c.bindCanvas(canvas());
    await expect(c.controls.setSource({ kind: 'bad', bytes: new Uint8Array(1) })).rejects.toThrow('nope');
    expect(c.getState().error).toEqual({ code: 'E_MODEL_PARSE', message: 'nope' });
    c.dispose();
  });
});
