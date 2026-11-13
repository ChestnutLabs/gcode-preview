// @vitest-environment happy-dom
/**
 * Adapter wiring (mutation sweep): every `<GcodePreview>` prop reaches the controller with the literal value,
 * defaults and mount-time application included, and every controller event reaches its emit with the literal
 * payload. The controller is the recording stand-in from spy-core.ts, so a mutant in the shell cannot hide
 * behind engine behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, reactive, shallowReactive, type App } from 'vue';
import { GcodePreview, type GcodePreviewHandle } from '../index';
import { StubWorker, makeStubGL, settle } from './helpers';
import { created, fire, log, reset } from './spy-core';

vi.mock('@chestnutlabs/gcode-preview-core', async (importOriginal) => {
  const spy = await import('./spy-core');
  return spy.wrapCore(await importOriginal<typeof import('@chestnutlabs/gcode-preview-core')>());
});

type Props = Record<string, unknown>;

async function mount(initial: Props = {}) {
  const { gl } = makeStubGL();
  const state = shallowReactive<Props>({ ...initial });
  let exposed: unknown = null;
  const Parent = defineComponent({
    setup: () => () =>
      h(GcodePreview, {
        ref: (i: unknown) => {
          exposed = i;
        },
        createWorker: () => new StubWorker(),
        rendererOptions: { createRenderer: () => gl, scheduleFrame: (cb: () => void) => cb() },
        ...state
      } as never)
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const app: App = createApp(Parent);
  app.mount(container);
  await settle();
  return {
    handle: () => (exposed as { preview: GcodePreviewHandle }).preview,
    async set(patch: Props) {
      Object.assign(state, patch);
      await settle();
    },
    unmount: () => app.unmount()
  };
}

const calls = (prefix: string) => log.filter((l) => l.startsWith(prefix));

beforeEach(reset);
afterEach(() => {
  document.body.innerHTML = '';
});

describe('<GcodePreview> (vue) wiring: mount', () => {
  it('a bare mount applies the runtime defaults and nothing optional', async () => {
    const m = await mount();
    expect(log.filter((l) => !l.startsWith('ctl.'))).toEqual([
      'setLayerRange(0,"Infinity")',
      'setKindVisible("travel",true)',
      'setKindVisible("wipe",true)',
      'setShowRetractions(false)',
      'setBuildVolumeCage(true)'
    ]);
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

  it('runtime props set at mount apply with the literal value (immediate), construction props do not re-apply', async () => {
    const m = await mount({
      source: new Uint8Array(40),
      parseOptions: { maxSegments: 7 },
      adjacentLayers: 3,
      layerRange: [2, 5],
      showTravel: false,
      showWipe: false,
      showRetractions: true,
      showVolumeCage: false,
      view: 'top',
      cameraState: { position: [1, 2, 3] },
      hiddenFeatureRoles: ['skirt', 'brim'],
      progress: { v: 1, timestampMs: 1, position: { byte: 9 } },
      colorMode: { mode: 'single', color: [1, 0, 0] },
      theme: { background: '#101010' },
      frameContent: 'object',
      interactionQuality: 'auto'
    });
    const c = log.filter((l) => !l.startsWith('ctl.'));
    for (const expected of [
      'setLayerRange(2,5)',
      'setKindVisible("travel",false)',
      'setKindVisible("wipe",false)',
      'setShowRetractions(true)',
      'setBuildVolumeCage(false)',
      'setView("top")',
      'setCameraState({"position":[1,2,3]})',
      'setFeatureRoleVisible("skirt",false)',
      'setFeatureRoleVisible("brim",false)'
    ]) {
      expect(c.filter((l) => l === expected)).toEqual([expected]);
    }
    for (const never of ['setColorMode', 'setTheme', 'setFrameContent', 'setInteractionQuality']) {
      expect(calls(never)).toEqual([]);
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

  it('a null cameraState applies nothing', async () => {
    const m = await mount({ cameraState: null });
    expect(calls('setCameraState')).toEqual([]);
    m.unmount();
  });
});

describe('<GcodePreview> (vue) wiring: changes after mount', () => {
  it('layerRange, show* and progress changes apply; clearing resets', async () => {
    const m = await mount({ layerRange: [1, 2], progress: { v: 1, timestampMs: 1, position: { byte: 1 } } });
    log.length = 0;
    await m.set({ layerRange: null, progress: null, showTravel: false, showRetractions: true });
    expect(log.slice().sort()).toEqual(
      [
        'ctl.clearProgress()',
        'setLayerRange(0,"Infinity")',
        'setKindVisible("travel",false)',
        'setShowRetractions(true)'
      ].sort()
    );
    m.unmount();
  });

  it('colorMode, qualityMode, progressivePreview, frameContent, interactionQuality, view, cameraState change', async () => {
    const m = await mount();
    log.length = 0;
    await m.set({
      colorMode: { mode: 'single', color: [0, 0, 1] },
      qualityMode: 'full',
      progressivePreview: 'off',
      frameContent: 'object',
      interactionQuality: 'auto',
      view: 'iso',
      cameraState: { position: [0, 0, 1] }
    });
    expect(log.slice().sort()).toEqual(
      [
        'setColorMode({"mode":"single","color":[0,0,1]})',
        'setQualityMode("full")',
        'setProgressivePreview("off")',
        'setFrameContent("object")',
        'setInteractionQuality("auto")',
        'setView("iso")',
        'setCameraState({"position":[0,0,1]})'
      ].sort()
    );
    m.unmount();
  });

  it('a theme edited IN PLACE re-applies (deep watch); a theme set to undefined applies nothing', async () => {
    const theme = reactive({ background: '#000' });
    const m = await mount({ theme });
    log.length = 0;
    theme.background = '#fff';
    await settle();
    expect(log).toEqual(['setTheme({"background":"#fff"})']);
    log.length = 0;
    await m.set({ theme: undefined });
    expect(log).toEqual([]);
    m.unmount();
  });

  it('source parses with the CURRENT parseOptions; a parseOptions-only change does not re-parse', async () => {
    const m = await mount({ source: new Uint8Array(40), parseOptions: { maxSegments: 7 } });
    await m.set({ parseOptions: { maxSegments: 9 } });
    expect(calls('ctl.parse')).toHaveLength(1);
    await m.set({ source: new Uint8Array(41) });
    expect(calls('ctl.parse')[1]).toBe('ctl.parse("Uint8Array(41)",{"maxSegments":9})');
    await m.set({ source: null });
    expect(calls('ctl.parse')).toHaveLength(2);
    m.unmount();
  });

  it('hiddenFeatureRoles: hides what is added, shows only what this prop hid, and tracks the last list', async () => {
    const m = await mount({ hiddenFeatureRoles: ['skirt', 'brim'] });
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
});

describe('<GcodePreview> (vue) wiring: buildVolume', () => {
  it('a plain def is a construction option; a change applies, an unset does not', async () => {
    const a = { x: 1, y: 2, z: 3 };
    const m = await mount({ buildVolume: a });
    expect(created[0].options.renderer?.buildVolume).toEqual(a);
    expect(calls('setBuildVolume(')).toEqual([]);
    await m.set({ buildVolume: { x: 4, y: 5, z: 6 } });
    expect(calls('setBuildVolume(')).toEqual(['setBuildVolume({"x":4,"y":5,"z":6})']);
    await m.set({ buildVolume: undefined });
    expect(calls('setBuildVolume(')).toHaveLength(1);
    m.unmount();
  });

  it('a machine geometry is not a construction option and applies once at mount', async () => {
    const machine = { bed: { shape: 'rect' }, x: 9 };
    const m = await mount({ buildVolume: machine });
    expect(created[0].options.renderer?.buildVolume).toBeUndefined();
    expect(calls('setBuildVolume(')).toEqual(['setBuildVolume({"bed":{"shape":"rect"},"x":9})']);
    m.unmount();
  });
});

describe('<GcodePreview> (vue) wiring: events reach emits', () => {
  it('maps every event to its emit with the literal payload', async () => {
    const got: Array<[string, unknown]> = [];
    const cb = (name: string) => (payload?: unknown) => got.push([name, payload]);
    const m = await mount({
      onReady: cb('ready'),
      onCameraChange: cb('camera'),
      onParseError: cb('parseError'),
      onParseCancelled: cb('cancelled'),
      onParseProgress: cb('progress'),
      onStage: cb('stage'),
      onBuildComplete: cb('build'),
      onQualityFallback: cb('fallback'),
      onProgressPresentationChanged: cb('presentation'),
      onMachineGeometryDiscovered: cb('discovered'),
      onMachineGeometryMismatch: cb('mismatch'),
      onRendererUnsupported: cb('unsupported'),
      onDisclosure: cb('disclosure'),
      onError: cb('error')
    });
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
      ['camera', { p: 1 }],
      ['parseError', { code: 'E1', message: 'm1' }],
      ['cancelled', undefined],
      ['progress', { bytesProcessed: 5, totalBytes: 9 }],
      ['stage', { stage: 'building-geometry', progress: 0.5, detail: { built: 1, total: 2 } }],
      ['build', { segments: 8, quality: 'lines' }],
      ['disclosure', ''],
      ['fallback', { from: 'tubes', to: 'lines', reason: 'r' }],
      ['presentation', { mode: 'exact' }],
      ['presentation', { mode: 'hidden', reason: 'stale' }],
      ['discovered', { x: 1 }],
      ['mismatch', 'mm'],
      ['error', { code: 'E2', message: 'm2' }],
      ['unsupported', { feature: 'camera', message: 'cm' }]
    ]);
    m.unmount();
  });
});

describe('useGcodePreview (vue) wiring: handle plumbing', () => {
  it('forwards parse/cancel/tickProgress/observeProgress/capture arguments', async () => {
    const m = await mount();
    log.length = 0;
    const h2 = m.handle();
    void h2.parse(new Uint8Array(3), { maxSegments: 2 });
    h2.cancel();
    h2.tickProgress(12);
    h2.observeProgress({ v: 1, timestampMs: 5, position: { byte: 1 } });
    h2.clearProgress();
    await h2.capture({ width: 10 } as never);
    expect(log).toEqual([
      'ctl.parse("Uint8Array(3)",{"maxSegments":2})',
      'ctl.cancel()',
      'ctl.tickProgress(12)',
      'ctl.observeProgress({"v":1,"timestampMs":5,"position":{"byte":1}})',
      'ctl.clearProgress()',
      'capture({"width":10})'
    ]);
    expect(h2.controls).toBeDefined();
    m.unmount();
  });

  it('state is readonly to the consumer, and onEvent subscribes', async () => {
    const m = await mount();
    const st = m.handle().state as unknown as Record<string, unknown>;
    const before = st['disclosure'];
    try {
      st['disclosure'] = 'hacked';
    } catch {
      /* readonly may warn or throw; the value must not change either way */
    }
    expect(st['disclosure']).toBe(before);
    const seen: unknown[] = [];
    m.handle().onEvent((e) => seen.push(e));
    fire({ type: 'parse-cancelled' });
    expect(seen).toEqual([{ type: 'parse-cancelled' }]);
    m.unmount();
  });

  it('unmount unbinds the canvas and disposes the controller', async () => {
    const m = await mount();
    m.unmount();
    expect(calls('ctl.dispose')).toEqual(['ctl.dispose()']);
    expect(calls('offState')).toEqual(['offState()']);
  });
});
describe('<GcodePreview> (vue) wiring: scrub props and a source change (Part C)', () => {
  const view = () => log.filter((l: string) => /^set(LayerRange|ScrubPosition|ScrubTime)\(/.test(l));
  it('an unset scrub prop sends nothing, so scrub at mount is not cleared; a cleared sent value sends null', async () => {
    const m = await mount({ scrub: 5 });

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
    const m = await mount({ source: new Uint8Array(40), layerRange: [2, 5], scrub: 3, scrubTime: 9 });

    expect(view()).toEqual(['setLayerRange(2,5)', 'setScrubPosition(3)', 'setScrubTime(9)']);
    log.length = 0;
    await m.set({ source: new Uint8Array(41) });
    expect(log.filter((l: string) => l.startsWith('ctl.parse') || view().includes(l))).toEqual([
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
