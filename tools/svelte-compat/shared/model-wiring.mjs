// Adapter wiring for the Svelte <ModelViewer> (mutation sweep), run under each Svelte major: every prop reaches the
// controller with the literal value (defaults included), and every controller event reaches its dispatched event
// with the literal payload. The controller is the recording stand-in from spy-model.mjs (installed with vi.mock in
// the leg's model-wiring.test.mjs), so a mutant in the shell cannot hide behind engine behaviour.
import { MODEL_STUB_CONTROLS, MODEL_STUB_GL } from '@chestnutlabs/gcode-model-renderer/testing';
import ModelViewer from '../../../packages/gcode-preview-svelte/src/model/ModelViewer.svelte';
import { mountComponent } from './mount-api.mjs';
import { created, fire, log, reset } from './spy-model.mjs';

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

export function registerModelWiring({ describe, it, expect, beforeEach, svelte, expectedMajor }) {
  const label = `svelte ${expectedMajor}`;
  const calls = (prefix) => log.filter((l) => l.startsWith(prefix));
  const plain = () => log.filter((l) => !l.startsWith('ctl.'));

  const mountM = (props = {}, events = {}) => {
    const target = document.body.appendChild(document.createElement('div'));
    const handle = mountComponent(svelte, ModelViewer, {
      target,
      props: { createRenderer: MODEL_STUB_GL, createControls: MODEL_STUB_CONTROLS, ...props },
      events
    });
    return {
      handle,
      target,
      set: async (patch) => {
        handle.setProps(patch);
        await settle();
      },
      unmount: () => {
        handle.destroy();
        target.remove();
      }
    };
  };

  describe(`${label}: ModelViewer wiring (props -> controller)`, () => {
    beforeEach(reset);

    it('a bare mount applies only the cage default; every optional construction option is undefined', async () => {
      const m = mountM();
      await settle();
      expect(plain()).toEqual(['setBuildVolumeCage(true)']);
      expect(calls('ctl.bindCanvas')).toEqual(['ctl.bindCanvas("node")']);
      const o = created[0].options;
      for (const k of [
        'background',
        'interactionQuality',
        'cameraMode',
        'limits',
        'filamentPalette',
        'loaders',
        'renderScope',
        'buildVolume',
        'theme',
        'cameraFov',
        'pixelRatio'
      ]) {
        expect(o[k]).toBeUndefined();
      }
      expect(m.target.querySelector('canvas').getAttribute('aria-label')).toBe('3D source-model preview');
      expect(m.target.querySelector('canvas').getAttribute('tabindex')).toBe('0');
      m.unmount();
    });

    it('props set at mount are construction options AND applied once with the literal value', async () => {
      const loaders = [{ kind: 'x' }];
      const m = mountM({
        source: { kind: 'stl', bytes: new Uint8Array(5) },
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
        pixelRatio: 2
      });
      await settle();
      expect(plain().sort()).toEqual(
        [
          'setSource({"kind":"stl","bytes":"Uint8Array(5)"})',
          'setView("top")',
          'setCameraState({"position":[1,2,3]})',
          'setBackground("#ff0000")',
          'setInteractionQuality("off")',
          'setRenderScope({"objectIds":["a"]})',
          'setBuildVolume({"x":1,"y":2,"z":3})',
          'setBuildVolumeCage(false)',
          'setTheme({"background":"#101010"})',
          'setCameraFov(32)',
          'setPixelRatio(2)'
        ].sort()
      );
      const o = created[0].options;
      expect(o).toMatchObject({
        background: '#ff0000',
        interactionQuality: 'off',
        cameraMode: 'orthographic',
        renderScope: { objectIds: ['a'] },
        limits: { maxTriangles: 9 },
        filamentPalette: ['#111111', undefined],
        buildVolume: { x: 1, y: 2, z: 3 },
        theme: { background: '#101010' },
        cameraFov: 32,
        pixelRatio: 2
      });
      expect(o.loaders).toStrictEqual(loaders);
      m.unmount();
    });

    it('null cameraState / source apply nothing; a null scope and plate are applied', async () => {
      const m = mountM({ source: null, cameraState: null, renderScope: null, buildVolume: null });
      await settle();
      expect(plain().sort()).toEqual(['setBuildVolume(null)', 'setBuildVolumeCage(true)', 'setRenderScope(null)']);
      m.unmount();
    });

    it('each runtime prop re-applies; cameraMode and the construction-only options do not', async () => {
      const m = mountM();
      await settle();
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
      m.unmount();
    });
  });

  describe(`${label}: ModelViewer wiring (events -> dispatched events, handle)`, () => {
    beforeEach(reset);

    it('maps every controller event to its dispatched event with the literal payload', async () => {
      const got = [];
      const names = [
        'ready',
        'camerachange',
        'error',
        'rendererunsupported',
        'contextlost',
        'contextrestored',
        'progress'
      ];
      const events = Object.fromEntries(names.map((n) => [n, (e) => got.push([n, e.detail])]));
      const m = mountM({}, events);
      await settle();
      fire({ type: 'ready', info: { objectCount: 2 } });
      fire({ type: 'camera-changed', state: { p: 1 } });
      fire({ type: 'error', code: 'E1', message: 'm1', extra: 1 });
      fire({ type: 'renderer-unsupported', feature: 'camera', message: 'cm', extra: 1 });
      fire({ type: 'context-lost' });
      fire({ type: 'context-restored' });
      fire({ type: 'something-else' });
      created[0].options.onProgress({ bytesProcessed: 5 });
      expect(got).toStrictEqual([
        ['ready', { objectCount: 2 }],
        ['camerachange', { p: 1 }],
        ['error', { code: 'E1', message: 'm1' }],
        ['rendererunsupported', { feature: 'camera', message: 'cm' }],
        ['contextlost', null],
        ['contextrestored', null],
        ['progress', { bytesProcessed: 5 }]
      ]);
      m.unmount();
    });

    it('the exported viewer forwards setSource / capture arguments; unmount disposes', async () => {
      const m = mountM();
      await settle();
      log.length = 0;
      const viewer = m.handle.instance.viewer;
      void viewer.setSource({ kind: 'stl', bytes: new Uint8Array(3) });
      await viewer.capture({ width: 10 });
      expect(log).toEqual(['setSource({"kind":"stl","bytes":"Uint8Array(3)"})', 'capture({"width":10})']);
      m.unmount();
      expect(calls('ctl.dispose')).toEqual(['ctl.dispose()']);
      expect(calls('ctl.bindCanvas').at(-1)).toBe('ctl.bindCanvas(null)');
    });
  });
}
