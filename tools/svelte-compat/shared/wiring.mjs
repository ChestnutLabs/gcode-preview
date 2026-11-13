// Adapter wiring for the Svelte <GcodePreview> (mutation sweep), run under each Svelte major: every prop reaches
// the controller with the literal value (defaults included), and every controller event reaches its dispatched
// event with the literal payload. The controller is the recording stand-in from spy-core.mjs (installed with
// vi.mock in the leg's wiring.test.mjs), so a mutant in the shell cannot hide behind engine behaviour.
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import GcodePreview from '../../../packages/gcode-preview-svelte/src/GcodePreview.svelte';
import { mountComponent } from './mount-api.mjs';
import { created, fire, log, reset } from './spy-core.mjs';

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

export function registerWiring({ describe, it, expect, beforeEach, svelte, expectedMajor }) {
  const label = `svelte ${expectedMajor}`;
  const calls = (prefix) => log.filter((l) => l.startsWith(prefix));
  const plain = () => log.filter((l) => !l.startsWith('ctl.'));

  const mountP = (props = {}, events = {}) => {
    const target = document.body.appendChild(document.createElement('div'));
    const handle = mountComponent(svelte, GcodePreview, {
      target,
      props: {
        createWorker: () => new SuiteStubWorker(),
        rendererOptions: { createRenderer: (canvas) => makeSuiteStubGL(canvas), scheduleFrame: (cb) => cb() },
        ...props
      },
      events
    });
    return {
      handle,
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

  describe(`${label}: GcodePreview wiring (props -> controller)`, () => {
    beforeEach(reset);

    it('a bare mount applies the runtime defaults and nothing optional', async () => {
      const m = mountP();
      await settle();
      expect(plain().sort()).toEqual(
        [
          'setBuildVolumeCage(true)',
          'setFrameContent("all")',
          'setInteractionQuality("off")',
          'setKindVisible("travel",true)',
          'setKindVisible("wipe",true)',
          'setLayerRange(0,"Infinity")',
          'setShowRetractions(false)'
        ].sort()
      );
      expect(calls('ctl.parse')).toEqual([]);
      expect(calls('ctl.clearProgress')).toEqual(['ctl.clearProgress()']);
      expect(created[0].options.renderer).toMatchObject({
        frameContent: 'all',
        interactionQuality: 'off',
        adjacentLayers: undefined,
        quality: 'auto',
        cameraMode: 'perspective'
      });
      m.unmount();
    });

    it('props set at mount apply with the literal value', async () => {
      const m = mountP({
        source: new Uint8Array(40),
        parseOptions: { maxSegments: 7 },
        adjacentLayers: 3,
        layerRange: [2, 5],
        showTravel: false,
        showWipe: false,
        showRetractions: true,
        showVolumeCage: false,
        colorMode: { mode: 'single', color: [1, 0, 0] },
        qualityMode: 'fast',
        progressivePreview: 'hold',
        frameContent: 'object',
        interactionQuality: 'auto',
        view: 'top',
        cameraState: { position: [1, 2, 3] },
        theme: { background: '#101010' },
        hiddenFeatureRoles: ['skirt', 'brim'],
        progress: { v: 1, timestampMs: 1, position: { byte: 9 } }
      });
      await settle();
      for (const expected of [
        'setLayerRange(2,5)',
        'setKindVisible("travel",false)',
        'setKindVisible("wipe",false)',
        'setShowRetractions(true)',
        'setBuildVolumeCage(false)',
        'setColorMode({"mode":"single","color":[1,0,0]})',
        'setQualityMode("fast")',
        'setProgressivePreview("hold")',
        'setFrameContent("object")',
        'setInteractionQuality("auto")',
        'setView("top")',
        'setCameraState({"position":[1,2,3]})',
        'setTheme({"background":"#101010"})',
        'setFeatureRoleVisible("skirt",false)',
        'setFeatureRoleVisible("brim",false)'
      ]) {
        expect(plain().filter((l) => l === expected)).toEqual([expected]);
      }
      expect(calls('ctl.parse')).toEqual(['ctl.parse("Uint8Array(40)",{"maxSegments":7})']);
      expect(calls('ctl.observeProgress')).toEqual([
        'ctl.observeProgress({"v":1,"timestampMs":1,"position":{"byte":9}})'
      ]);
      expect(calls('ctl.clearProgress')).toEqual([]);
      expect(created[0].options.renderer).toMatchObject({
        frameContent: 'object',
        interactionQuality: 'auto',
        adjacentLayers: 3
      });
      expect(created[0].options.parseDefaults).toEqual({ maxSegments: 7 });
      m.unmount();
    });

    it('a null cameraState and unset optional props apply nothing', async () => {
      const m = mountP({
        cameraState: null,
        theme: undefined,
        view: undefined,
        qualityMode: '',
        progressivePreview: ''
      });
      await settle();
      for (const never of [
        'setCameraState',
        'setTheme',
        'setView',
        'setColorMode',
        'setQualityMode',
        'setProgressivePreview',
        'setBuildVolume(',
        'setCameraFov',
        'setPixelRatio'
      ]) {
        expect(calls(never)).toEqual([]);
      }
      m.unmount();
    });

    it('changes after mount apply, and clearing layerRange / progress resets them', async () => {
      const m = mountP({ layerRange: [1, 2], progress: { v: 1, timestampMs: 1, position: { byte: 1 } } });
      await settle();
      log.length = 0;
      await m.set({ layerRange: undefined, progress: undefined, showTravel: false, showRetractions: true });
      expect(log.slice().sort()).toEqual(
        [
          'ctl.clearProgress()',
          'setKindVisible("travel",false)',
          'setLayerRange(0,"Infinity")',
          'setShowRetractions(true)'
        ].sort()
      );
      log.length = 0;
      await m.set({ layerRange: null, progress: null, showTravel: true, showWipe: false, showVolumeCage: false });
      expect(log.slice().sort()).toEqual(
        [
          'ctl.clearProgress()',
          'setBuildVolumeCage(false)',
          'setKindVisible("travel",true)',
          'setKindVisible("wipe",false)',
          'setLayerRange(0,"Infinity")'
        ].sort()
      );
      m.unmount();
    });

    it('a changed source parses with the CURRENT parseOptions; a parseOptions-only change does not re-parse', async () => {
      const m = mountP({ source: new Uint8Array(40), parseOptions: { maxSegments: 7 } });
      await settle();
      await m.set({ parseOptions: { maxSegments: 9 } });
      expect(calls('ctl.parse')).toHaveLength(1);
      await m.set({ source: new Uint8Array(41) });
      expect(calls('ctl.parse')[1]).toBe('ctl.parse("Uint8Array(41)",{"maxSegments":9})');
      await m.set({ source: null });
      expect(calls('ctl.parse')).toHaveLength(2);
      await m.set({ source: undefined });
      expect(calls('ctl.parse')).toHaveLength(2);
      m.unmount();
    });

    it('colorMode, view, theme and cameraState changes apply; frameContent / interactionQuality / quality too', async () => {
      const m = mountP();
      await settle();
      log.length = 0;
      await m.set({
        colorMode: { mode: 'single', color: [0, 0, 1] },
        view: 'iso',
        theme: { background: '#fff' },
        cameraState: { position: [0, 0, 1] },
        frameContent: 'object',
        interactionQuality: 'auto'
      });
      expect(log.slice().sort()).toEqual(
        [
          'setColorMode({"mode":"single","color":[0,0,1]})',
          'setView("iso")',
          'setTheme({"background":"#fff"})',
          'setCameraState({"position":[0,0,1]})',
          'setFrameContent("object")',
          'setInteractionQuality("auto")'
        ].sort()
      );
      m.unmount();
    });

    it('hiddenFeatureRoles: hides what is added, shows only what this prop hid, and tracks the last list', async () => {
      const m = mountP({ hiddenFeatureRoles: ['skirt', 'brim'] });
      await settle();
      log.length = 0;
      await m.set({ hiddenFeatureRoles: ['brim'] });
      expect(log).toEqual(['setFeatureRoleVisible("skirt",true)']);
      log.length = 0;
      await m.set({ hiddenFeatureRoles: undefined });
      expect(log).toEqual(['setFeatureRoleVisible("brim",true)']);
      log.length = 0;
      await m.set({ hiddenFeatureRoles: ['skirt'] });
      expect(log).toEqual(['setFeatureRoleVisible("skirt",false)']);
      m.unmount();
    });

    it('buildVolume: a plain def is a construction option AND applied at mount; a machine geometry only applies', async () => {
      const a = { x: 1, y: 2, z: 3 };
      const m = mountP({ buildVolume: a });
      await settle();
      expect(created[0].options.renderer.buildVolume).toEqual(a);
      expect(calls('setBuildVolume(')).toEqual(['setBuildVolume({"x":1,"y":2,"z":3})']);
      await m.set({ buildVolume: { x: 4, y: 5, z: 6 } });
      expect(calls('setBuildVolume(')[1]).toBe('setBuildVolume({"x":4,"y":5,"z":6})');
      m.unmount();
      reset();
      const machine = { bed: { shape: 'rect' }, x: 9 };
      const m2 = mountP({ buildVolume: machine });
      await settle();
      expect(created[0].options.renderer.buildVolume).toBeUndefined();
      expect(calls('setBuildVolume(')).toEqual(['setBuildVolume({"bed":{"shape":"rect"},"x":9})']);
      m2.unmount();
    });
  });

  describe(`${label}: GcodePreview wiring (events -> dispatched events)`, () => {
    beforeEach(reset);

    it('maps every controller event to its dispatched event with the literal payload', async () => {
      const got = [];
      const names = [
        'ready',
        'camerachange',
        'parseerror',
        'parsecancelled',
        'parseprogress',
        'stage',
        'buildcomplete',
        'qualityfallback',
        'progresspresentationchanged',
        'machinegeometrydiscovered',
        'machinegeometrymismatch',
        'rendererunsupported',
        'disclosure',
        'error'
      ];
      const events = Object.fromEntries(names.map((n) => [n, (e) => got.push([n, e.detail])]));
      const m = mountP({}, events);
      await settle();
      fire({
        type: 'parse-complete',
        segments: 11,
        layers: 3,
        complete: false,
        capabilities: { a: 'known' },
        warnings: [],
        metadata: undefined
      });
      fire({ type: 'camera-changed', state: { p: 1 } });
      fire({ type: 'parse-error', code: 'E1', message: 'm1' });
      fire({ type: 'parse-cancelled' });
      fire({ type: 'parse-progress', progress: { bytesProcessed: 5, totalBytes: 9 } });
      fire({ type: 'stage', stage: 'building-geometry', progress: 0.5, detail: { built: 1, total: 2 } });
      fire({ type: 'buildComplete', segments: 8, quality: 'lines' });
      fire({ type: 'qualityFallback', from: 'tubes', to: 'lines', reason: 'r' });
      fire({ type: 'progress-presentation-changed', mode: 'exact' });
      fire({ type: 'progress-presentation-changed', mode: 'hidden', reason: 'stale' });
      fire({ type: 'machine-geometry-discovered', machine: { x: 1 } });
      fire({ type: 'error', code: 'machine-geometry-mismatch', message: 'mm' });
      fire({ type: 'error', code: 'E2', message: 'm2' });
      fire({ type: 'renderer-unsupported', feature: 'camera', message: 'cm' });
      expect(got).toStrictEqual([
        [
          'ready',
          { segments: 11, layers: 3, complete: false, capabilities: { a: 'known' }, warnings: [], metadata: undefined }
        ],
        ['camerachange', { p: 1 }],
        ['parseerror', { code: 'E1', message: 'm1' }],
        ['parsecancelled', null],
        ['parseprogress', { bytesProcessed: 5, totalBytes: 9 }],
        ['stage', { stage: 'building-geometry', progress: 0.5, detail: { built: 1, total: 2 } }],
        ['buildcomplete', { segments: 8, quality: 'lines' }],
        ['disclosure', ''],
        ['qualityfallback', { from: 'tubes', to: 'lines', reason: 'r' }],
        ['progresspresentationchanged', { mode: 'exact' }],
        ['progresspresentationchanged', { mode: 'hidden', reason: 'stale' }],
        ['machinegeometrydiscovered', { x: 1 }],
        ['machinegeometrymismatch', 'mm'],
        ['error', { code: 'E2', message: 'm2' }],
        ['rendererunsupported', { feature: 'camera', message: 'cm' }]
      ]);
      m.unmount();
    });
  });

  describe(`${label}: createGcodePreview wiring (the store handle)`, () => {
    beforeEach(reset);

    it('forwards parse/cancel/tickProgress/observeProgress/clearProgress/capture arguments, and unmount disposes', async () => {
      const m = mountP();
      await settle();
      log.length = 0;
      const preview = m.handle.instance.preview;
      void preview.parse(new Uint8Array(3), { maxSegments: 2 });
      preview.cancel();
      preview.tickProgress(12);
      preview.observeProgress({ v: 1, timestampMs: 5, position: { byte: 1 } });
      preview.clearProgress();
      await preview.capture({ width: 10 });
      expect(log).toEqual([
        'ctl.parse("Uint8Array(3)",{"maxSegments":2})',
        'ctl.cancel()',
        'ctl.tickProgress(12)',
        'ctl.observeProgress({"v":1,"timestampMs":5,"position":{"byte":1}})',
        'ctl.clearProgress()',
        'capture({"width":10})'
      ]);
      const states = [];
      const off = preview.state.subscribe((s) => states.push(s));
      expect(states).toHaveLength(1); // immediate emission (store contract)
      off();
      expect(typeof preview.onEvent(() => undefined)).toBe('function');
      m.unmount();
      expect(calls('ctl.dispose')).toEqual(['ctl.dispose()']);
      expect(calls('ctl.bindCanvas').at(-1)).toBe('ctl.bindCanvas(null)');
    });
  });

  describe(`${label}: GcodePreview wiring: scrub props and a source change (Part C)`, () => {
    const view = () => log.filter((l) => /^set(LayerRange|ScrubPosition|ScrubTime)\(/.test(l));
    beforeEach(reset);
    it('an unset scrub prop sends nothing, so scrub at mount is not cleared; a cleared sent value sends null', async () => {
      const m = mountP({ scrub: 5 });
      await settle();
      expect(view()).toEqual(['setLayerRange(0,"Infinity")', 'setScrubPosition(5)']);
      log.length = 0;
      await m.set({ scrubTime: 7 });
      expect(view()).toEqual(['setScrubTime(7)']);
      log.length = 0;
      await m.set({ scrub: null, scrubTime: null });
      expect(view()).toEqual(['setScrubPosition(null)', 'setScrubTime(null)']);
      log.length = 0;
      // From null to unset is a change the adapter sees, but nothing was sent since the clear: no second null.
      await m.set({ scrub: undefined, scrubTime: undefined });
      expect(view()).toEqual([]);
      log.length = 0;
      await m.set({ scrubTime: 4 });
      expect(view()).toEqual(['setScrubTime(4)']);
      m.unmount();
    });

    it('a source change re-sends the view props that hold a value, after the parse; the first parse does not', async () => {
      const m = mountP({ source: new Uint8Array(40), layerRange: [2, 5], scrub: 3, scrubTime: 9 });
      await settle();
      expect(view()).toEqual(['setLayerRange(2,5)', 'setScrubPosition(3)', 'setScrubTime(9)']);
      log.length = 0;
      await m.set({ source: new Uint8Array(41) });
      expect(log.filter((l) => l.startsWith('ctl.parse') || view().includes(l))).toEqual([
        'ctl.parse("Uint8Array(41)","undefined")',
        'setLayerRange(2,5)',
        'setScrubPosition(3)',
        'setScrubTime(9)'
      ]);
      log.length = 0;
      // Cleared in the same update: nothing is re-sent for the new file, and each clear is sent once.
      await m.set({ source: new Uint8Array(42), layerRange: null, scrub: null, scrubTime: null });
      expect(view()).toEqual(['setLayerRange(0,"Infinity")', 'setScrubPosition(null)', 'setScrubTime(null)']);
      log.length = 0;
      await m.set({ source: new Uint8Array(43) });
      expect(view()).toEqual([]);
      expect(calls('ctl.parse')).toEqual(['ctl.parse("Uint8Array(43)","undefined")']);
      m.unmount();
    });
  });

  describe(`${label}: GcodePreview wiring: lens, projection, pixel ratio, tube and the 2D mount (#520)`, () => {
    const lens = () => log.filter((l) => /^set(CameraMode|CameraFov|PixelRatio|Tube|Quality)\(/.test(l));
    beforeEach(reset);

    it('3D: construction values are the controller options and are NOT re-applied at mount; tube is construction-only', async () => {
      const tube = { radialSegments: 5 };
      const m = mountP({ cameraMode: 'orthographic', cameraFov: 35, pixelRatio: 1.5, tube, quality: 'lines' });
      await settle();
      expect(created[0].options.renderer).toMatchObject({
        cameraMode: 'orthographic',
        cameraFov: 35,
        pixelRatio: 1.5,
        tube: { radialSegments: 5 },
        quality: 'lines'
      });
      expect(lens()).toEqual([]);
      await m.set({ tube: { radialSegments: 9 } });
      expect(lens()).toEqual([]);
      m.unmount();
    });

    it('3D: a changed cameraMode / cameraFov / pixelRatio applies once with the literal value; same or unset applies nothing', async () => {
      const m = mountP({ cameraMode: 'orthographic', cameraFov: 35, pixelRatio: 1.5 });
      await settle();
      await m.set({ cameraMode: 'perspective' });
      expect(lens()).toEqual(['setCameraMode("perspective")']);
      log.length = 0;
      await m.set({ cameraFov: 60, pixelRatio: 'device' });
      expect(lens()).toEqual(['setCameraFov(60)', 'setPixelRatio("device")']);
      log.length = 0;
      await m.set({ cameraMode: 'perspective', cameraFov: 60, pixelRatio: 'device' });
      expect(lens()).toEqual([]);
      await m.set({ cameraFov: undefined, pixelRatio: undefined });
      expect(lens()).toEqual([]);
      await m.set({ cameraFov: 35 });
      expect(lens()).toEqual(['setCameraFov(35)']);
      m.unmount();
    });

    it('2D: a mount at the documented defaults applies nothing, and the mode reaches the controller', async () => {
      const m = mountP({ renderer: '2d', cameraMode: 'perspective', cameraFov: 50, quality: 'auto' });
      await settle();
      expect(created[0].options.renderer.mode).toBe('2d');
      expect(lens()).toEqual([]);
      m.unmount();
    });

    it('2D: a non-default mount value is applied once; 3D builds with it and applies nothing', async () => {
      const m = mountP({ renderer: '2d', cameraMode: 'orthographic', cameraFov: 35, pixelRatio: 2, quality: 'lines' });
      await settle();
      expect(lens().sort()).toEqual(
        ['setCameraFov(35)', 'setCameraMode("orthographic")', 'setPixelRatio(2)', 'setQuality("lines")'].sort()
      );
      // The applied value is now the mount value: setting it again sends nothing, a change sends one call.
      log.length = 0;
      await m.set({ cameraMode: 'orthographic', cameraFov: 35, pixelRatio: 2 });
      expect(lens()).toEqual([]);
      await m.set({ cameraMode: 'perspective' });
      expect(lens()).toEqual(['setCameraMode("perspective")']);
      m.unmount();
    });
  });

  describe(`${label}: wiring coverage guard (every public prop is asserted with a literal)`, () => {
    // A prop counts as covered when a wiring file passes it as `name: <value>` (not `undefined`) or a shorthand
    // `name,` line in a mount / set call; the "never called when unset" lists are stripped first.
    it.each([
      ['GcodePreview.svelte', '../../../packages/gcode-preview-svelte/src/GcodePreview.svelte', 'wiring.mjs'],
      ['ModelViewer.svelte', '../../../packages/gcode-preview-svelte/src/model/ModelViewer.svelte', 'model-wiring.mjs']
    ])('%s', async (_name, rel, wiringFile) => {
      const { readFileSync } = await import('node:fs');
      const { resolve } = await import('node:path');
      const shared = resolve(process.cwd(), '../shared'); // vitest runs from the leg dir (svelte4 / svelte5)
      const props = [...readFileSync(resolve(shared, rel), 'utf8').matchAll(/^\s*export let (\w+)/gm)].map((x) => x[1]);
      const wiring = readFileSync(resolve(shared, wiringFile), 'utf8').replace(
        /for \(const never of \[[^\]]*\]\)/g,
        ''
      );
      expect(props.length).toBeGreaterThan(10);
      const uncovered = props.filter((p) => !new RegExp(`\\b${p}(: [^u\\s]|,\\n)`).test(wiring));
      expect(uncovered).toEqual([]);
    });
  });
}
