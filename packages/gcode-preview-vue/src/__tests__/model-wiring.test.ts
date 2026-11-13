// @vitest-environment happy-dom
/**
 * `/model` adapter wiring (mutation sweep): every `<ModelViewer>` prop reaches the controller with the literal
 * value, and every controller event reaches its emit with the literal payload. The controller is the recording
 * stand-in from spy-model.ts, so a mutant in the shell cannot hide behind engine behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, ref } from 'vue';
import { ModelViewer, type ModelViewerHandle } from '../model/index';
import { MODEL_STUB_CONTROLS, MODEL_STUB_GL } from '@chestnutlabs/gcode-model-renderer/testing';
import { created, fire, listeners as live, log, reset } from './spy-model';

vi.mock('@chestnutlabs/gcode-model-renderer', async (importOriginal) => {
  const spy = await import('./spy-model');
  return spy.wrapModel(await importOriginal<typeof import('@chestnutlabs/gcode-model-renderer')>());
});

const listeners = (): number => live.length;

const settle = async (): Promise<void> => {
  await nextTick();
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};

type Props = Record<string, unknown>;

async function mount(initial: Props = {}) {
  const props = reactive<Props>({ createRenderer: MODEL_STUB_GL, createControls: MODEL_STUB_CONTROLS, ...initial });
  const comp = ref<{ viewer: ModelViewerHandle } | null>(null);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const app = createApp({ render: () => h(ModelViewer, { ref: comp, ...props } as never) });
  app.mount(host);
  await settle();
  return {
    comp,
    host,
    async set(patch: Props) {
      Object.assign(props, patch);
      await settle();
    },
    async unmount() {
      app.unmount();
      await settle();
      host.remove();
    }
  };
}

const calls = (prefix: string) => log.filter((l) => l.startsWith(prefix));
const plain = () => log.filter((l) => !l.startsWith('ctl.'));

beforeEach(reset);
afterEach(() => {
  document.body.innerHTML = '';
});

describe('<ModelViewer> (vue) wiring: mount', () => {
  it('a bare mount applies nothing at runtime; the cage default is a construction option', async () => {
    const m = await mount();
    expect(plain()).toEqual([]);
    expect(calls('ctl.bindCanvas')).toEqual(['ctl.bindCanvas("node")']);
    const o = created[0]!.options as Record<string, unknown>;
    expect(Object.keys(o).sort()).toEqual(['createControls', 'createRenderer', 'onProgress', 'showVolumeCage']);
    expect(o['showVolumeCage']).toBe(true);
    expect(m.host.querySelector('canvas')?.getAttribute('aria-label')).toBe('3D source-model preview');
    expect(m.host.querySelector('canvas')?.getAttribute('tabindex')).toBe('0');
    await m.unmount();
  });

  it('props set at mount: source / view / cameraState apply once; the rest are construction options', async () => {
    const source = { kind: 'stl', bytes: new Uint8Array(5) };
    const createRenderer = () => undefined;
    const createControls = () => undefined;
    const loaders = [{ kind: 'x' }];
    const m = await mount({
      source,
      view: 'top',
      cameraState: { position: [1, 2, 3] },
      background: '#ff0000',
      interactionQuality: 'off',
      cameraMode: 'orthographic',
      renderScope: { objectIds: ['a'] },
      limits: { maxTriangles: 9 },
      filamentPalette: ['#111111', undefined],
      loaders,
      buildVolume: { x: 1, y: 2, z: 3 },
      showVolumeCage: false,
      theme: { background: '#101010' },
      cameraFov: 32,
      pixelRatio: 2,
      createRenderer,
      createControls
    });
    expect(plain().sort()).toEqual(
      [
        'setSource({"kind":"stl","bytes":"Uint8Array(5)"})',
        'setView("top")',
        'setCameraState({"position":[1,2,3]})'
      ].sort()
    );
    const o = created[0]!.options;
    expect(o).toMatchObject({
      background: '#ff0000',
      interactionQuality: 'off',
      cameraMode: 'orthographic',
      renderScope: { objectIds: ['a'] },
      limits: { maxTriangles: 9 },
      filamentPalette: ['#111111', undefined],
      buildVolume: { x: 1, y: 2, z: 3 },
      showVolumeCage: false,
      theme: { background: '#101010' },
      cameraFov: 32,
      pixelRatio: 2
    });
    expect(o.loaders).toStrictEqual(loaders);
    expect(o.createRenderer).toBe(createRenderer);
    expect(o.createControls).toBe(createControls);
    await m.unmount();
  });

  it('null / unset props: no source, camera pose or construction scope/plate', async () => {
    const m = await mount({ source: null, cameraState: null, renderScope: null, buildVolume: null });
    expect(plain()).toEqual([]);
    const o = created[0]!.options as Record<string, unknown>;
    expect('renderScope' in o).toBe(false);
    expect('buildVolume' in o).toBe(false);
    await m.unmount();
  });
});

describe('<ModelViewer> (vue) wiring: changes after mount', () => {
  it('each runtime prop re-applies; cameraMode and the construction-only options do not', async () => {
    const m = await mount();
    log.length = 0;
    await m.set({
      source: { kind: 'stl', bytes: new Uint8Array(6) },
      view: 'iso',
      cameraState: { position: [0, 0, 1] },
      background: 'transparent',
      interactionQuality: 'auto',
      renderScope: { plateId: 2 },
      buildVolume: { x: 4, y: 5, z: 6 },
      showVolumeCage: false,
      theme: { background: '#fff' },
      cameraFov: 60,
      pixelRatio: 'device',
      cameraMode: 'orthographic',
      limits: { maxTriangles: 1 }
    });
    expect(log.slice().sort()).toEqual(
      [
        'setSource({"kind":"stl","bytes":"Uint8Array(6)"})',
        'setView("iso")',
        'setCameraState({"position":[0,0,1]})',
        'setBackground("transparent")',
        'setInteractionQuality("auto")',
        'setRenderScope({"plateId":2})',
        'setBuildVolume({"x":4,"y":5,"z":6})',
        'setBuildVolumeCage(false)',
        'setTheme({"background":"#fff"})',
        'setCameraFov(60)',
        'setPixelRatio("device")'
      ].sort()
    );
    expect(created).toHaveLength(1);
    log.length = 0;
    await m.set({ renderScope: null, buildVolume: null });
    expect(log.slice().sort()).toEqual(['setBuildVolume(null)', 'setRenderScope(null)']);
    log.length = 0;
    await m.set({
      background: undefined,
      interactionQuality: undefined,
      theme: undefined,
      cameraFov: undefined,
      pixelRatio: undefined
    });
    expect(log).toEqual([]); // clearing an optional prop applies nothing
    await m.unmount();
  });
});

describe('<ModelViewer> (vue) wiring: events and the handle', () => {
  it('maps every controller event to its emit with the literal payload', async () => {
    const got: Array<[string, unknown]> = [];
    const m = await mount({
      onReady: (e: unknown) => got.push(['ready', e]),
      onCameraChange: (e: unknown) => got.push(['camera', e]),
      onError: (e: unknown) => got.push(['error', e]),
      onRendererUnsupported: (e: unknown) => got.push(['unsupported', e]),
      onContextLost: (...a: unknown[]) => got.push(['lost', a]),
      onContextRestored: (...a: unknown[]) => got.push(['restored', a]),
      onProgress: (e: unknown) => got.push(['progress', e])
    });
    fire({ type: 'ready', info: { objectCount: 2 } });
    fire({ type: 'camera-changed', state: { p: 1 } });
    fire({ type: 'error', code: 'E1', message: 'm1', extra: 1 });
    fire({ type: 'renderer-unsupported', feature: 'camera', message: 'cm', extra: 1 });
    fire({ type: 'context-lost' });
    fire({ type: 'context-restored' });
    fire({ type: 'something-else' });
    (created[0]!.options.onProgress as (p: unknown) => void)({ bytesProcessed: 5 });
    expect(got).toStrictEqual([
      ['ready', { objectCount: 2 }],
      ['camera', { p: 1 }],
      ['error', { code: 'E1', message: 'm1' }],
      ['unsupported', { feature: 'camera', message: 'cm' }],
      ['lost', []],
      ['restored', []],
      ['progress', { bytesProcessed: 5 }]
    ]);
    expect(listeners()).toBe(1);
    await m.unmount();
  });

  it('the exposed handle is the full viewer: setSource / capture forward their arguments; unmount disposes', async () => {
    const m = await mount();
    log.length = 0;
    const h = m.comp.value!.viewer;
    void h.setSource({ kind: 'stl', bytes: new Uint8Array(3) } as never);
    await h.capture({ width: 10 } as never);
    expect(log).toEqual(['setSource({"kind":"stl","bytes":"Uint8Array(3)"})', 'capture({"width":10})']);
    await m.unmount();
    expect(calls('ctl.dispose')).toEqual(['ctl.dispose()']);
    expect(calls('offState')).toEqual(['offState()']);
  });
});
