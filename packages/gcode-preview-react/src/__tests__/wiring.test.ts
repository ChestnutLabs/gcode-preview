// @vitest-environment happy-dom
/**
 * Adapter wiring (mutation sweep): every `<GcodePreview>` prop reaches the controller with the literal value,
 * defaults included, and every controller event reaches its callback with the literal payload. The controller is
 * the recording stand-in from spy-core.ts, so a mutant in the shell cannot hide behind engine behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act, createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { GcodePreview, type GcodePreviewHandle } from '../index';
import { created, fire, log, reset } from './spy-core';

vi.mock('@chestnutlabs/gcode-preview-core', async (importOriginal) => {
  const spy = await import('./spy-core');
  return spy.wrapCore(await importOriginal<typeof import('@chestnutlabs/gcode-preview-core')>());
});

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  });
};

type Props = Record<string, unknown>;

async function mount(initial: Props = {}, opts: { strict?: boolean } = {}) {
  const canvas = document.createElement('canvas');
  const ref = createRef<GcodePreviewHandle>();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  let current: Props = initial;
  const el = () => {
    const e = createElement(GcodePreview, {
      ref,
      createWorker: () => new SuiteStubWorker(),
      rendererOptions: { createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (cb: () => void) => cb() },
      ...current
    } as never);
    return opts.strict === true ? createElement(StrictMode, null, e) : e;
  };
  await act(async () => root.render(el()));
  await settle();
  return {
    ref,
    async set(patch: Props) {
      current = { ...current, ...patch };
      await act(async () => root.render(el()));
      await settle();
    },
    async unmount() {
      await act(async () => root.unmount());
      host.remove();
    }
  };
}

const calls = (prefix: string) => log.filter((l) => l.startsWith(prefix));

beforeEach(reset);
afterEach(() => {
  document.body.innerHTML = '';
});

describe('<GcodePreview> (react) wiring: defaults at mount', () => {
  it('a bare mount applies the documented defaults and nothing optional', async () => {
    const m = await mount();
    expect(log.filter((l) => !l.startsWith('ctl.'))).toEqual([
      'setLayerRange(0,"Infinity")',
      'setKindVisible("travel",true)',
      'setKindVisible("wipe",true)',
      'setKindVisible("cut",true)',
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
    await m.unmount();
  });
});

describe('<GcodePreview> (react) wiring: props reach the controller', () => {
  it('values set at mount are applied once, with the literal value', async () => {
    const theme = { background: '#101010' };
    const cameraState = { position: [1, 2, 3] };
    const m = await mount({
      colorMode: { mode: 'single', color: [1, 0, 0] },
      qualityMode: 'fast',
      progressivePreview: 'hold',
      frameContent: 'object',
      interactionQuality: 'auto',
      view: 'top',
      cameraState,
      theme,
      showTravel: false,
      showWipe: false,
      showCut: false,
      showRetractions: true,
      showVolumeCage: false,
      layerRange: [2, 5],
      progress: { v: 1, timestampMs: 1, position: { byte: 9 } },
      adjacentLayers: 3,
      parseOptions: { maxSegments: 7 }
    });
    const c = log.filter((l) => !l.startsWith('ctl.'));
    for (const expected of [
      'setColorMode({"mode":"single","color":[1,0,0]})',
      'setQualityMode("fast")',
      'setProgressivePreview("hold")',
      'setFrameContent("object")',
      'setInteractionQuality("auto")',
      'setView("top")',
      'setCameraState({"position":[1,2,3]})',
      'setTheme({"background":"#101010"})',
      'setKindVisible("travel",false)',
      'setKindVisible("wipe",false)',
      'setKindVisible("cut",false)',
      'setShowRetractions(true)',
      'setBuildVolumeCage(false)',
      'setLayerRange(2,5)'
    ]) {
      expect(c.filter((l) => l === expected)).toEqual([expected]);
    }
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
    await m.unmount();
  });

  it('a null cameraState and an undefined optional prop apply nothing', async () => {
    const m = await mount({ cameraState: null, theme: undefined, view: undefined });
    expect(calls('setCameraState')).toEqual([]);
    expect(calls('setTheme')).toEqual([]);
    expect(calls('setView')).toEqual([]);
    expect(calls('setColorMode')).toEqual([]);
    expect(calls('setQualityMode')).toEqual([]);
    expect(calls('setProgressivePreview')).toEqual([]);
    await m.unmount();
  });

  it('changes after mount apply, and clearing layerRange / progress resets them', async () => {
    const m = await mount({ layerRange: [1, 2], progress: { v: 1, timestampMs: 1, position: { byte: 1 } } });
    log.length = 0;
    await m.set({ layerRange: undefined, progress: undefined, showTravel: false, showRetractions: true });
    expect(log).toEqual([
      'setLayerRange(0,"Infinity")',
      'setKindVisible("travel",false)',
      'setShowRetractions(true)',
      'ctl.clearProgress()'
    ]);
    log.length = 0;
    await m.set({ layerRange: null, progress: null, showTravel: true, showWipe: false, showVolumeCage: false });
    expect(log).toEqual([
      'setLayerRange(0,"Infinity")',
      'setKindVisible("travel",true)',
      'setKindVisible("wipe",false)',
      'setBuildVolumeCage(false)',
      'ctl.clearProgress()'
    ]);
    await m.unmount();
  });

  it('colorMode, qualityMode, progressivePreview, frameContent, interactionQuality, view, theme, cameraState change', async () => {
    const m = await mount();
    log.length = 0;
    await m.set({
      colorMode: { mode: 'single', color: [0, 0, 1] },
      qualityMode: 'full',
      progressivePreview: 'off',
      frameContent: 'object',
      interactionQuality: 'auto',
      view: 'iso',
      theme: { background: '#fff' },
      cameraState: { position: [0, 0, 1] }
    });
    expect(log).toEqual([
      'setColorMode({"mode":"single","color":[0,0,1]})',
      'setQualityMode("full")',
      'setProgressivePreview("off")',
      'setFrameContent("object")',
      'setInteractionQuality("auto")',
      'setView("iso")',
      'setCameraState({"position":[0,0,1]})',
      'setTheme({"background":"#fff"})'
    ]);
    await m.unmount();
  });

  it('source parses with the CURRENT parseOptions; a parseOptions-only change does not re-parse', async () => {
    const bytes = new Uint8Array(40);
    const m = await mount({ source: bytes, parseOptions: { maxSegments: 7 } });
    expect(calls('ctl.parse')).toEqual(['ctl.parse("Uint8Array(40)",{"maxSegments":7})']);
    await m.set({ parseOptions: { maxSegments: 9 } });
    expect(calls('ctl.parse')).toHaveLength(1);
    await m.set({ source: new Uint8Array(41) });
    expect(calls('ctl.parse')[1]).toBe('ctl.parse("Uint8Array(41)",{"maxSegments":9})');
    await m.unmount();
  });

  it('hiddenFeatureRoles: hides what is added, shows only what this prop hid, and tracks the last list', async () => {
    const m = await mount({ hiddenFeatureRoles: ['skirt', 'brim'] });
    expect(calls('setFeatureRoleVisible')).toEqual([
      'setFeatureRoleVisible("skirt",false)',
      'setFeatureRoleVisible("brim",false)'
    ]);
    log.length = 0;
    await m.set({ hiddenFeatureRoles: ['brim'] });
    expect(log).toEqual(['setFeatureRoleVisible("skirt",true)']);
    log.length = 0;
    await m.set({ hiddenFeatureRoles: undefined });
    expect(log).toEqual(['setFeatureRoleVisible("brim",true)']);
    log.length = 0;
    await m.set({ hiddenFeatureRoles: ['skirt'] });
    expect(log).toEqual(['setFeatureRoleVisible("skirt",false)']);
    await m.unmount();
  });
});

describe('<GcodePreview> (react) wiring: buildVolume', () => {
  it('a plain def is a construction option (no mount call); later changes apply, including back to the first', async () => {
    const a = { x: 1, y: 2, z: 3 };
    const b = { x: 4, y: 5, z: 6 };
    const m = await mount({ buildVolume: a });
    expect(created[0].options.renderer?.buildVolume).toEqual(a);
    expect(calls('setBuildVolume(')).toEqual([]);
    await m.set({ buildVolume: b });
    expect(calls('setBuildVolume(')).toEqual(['setBuildVolume({"x":4,"y":5,"z":6})']);
    await m.set({ buildVolume: a });
    expect(calls('setBuildVolume(')).toEqual([
      'setBuildVolume({"x":4,"y":5,"z":6})',
      'setBuildVolume({"x":1,"y":2,"z":3})'
    ]);
    await m.set({ buildVolume: a });
    expect(calls('setBuildVolume(')).toHaveLength(2);
    await m.unmount();
  });

  it('a machine geometry is not a construction option and applies on every mount pass (StrictMode remount too)', async () => {
    const machine = { bed: { shape: 'rect' }, x: 9 };
    const m = await mount({ buildVolume: machine }, { strict: true });
    expect(created[0].options.renderer?.buildVolume).toBeUndefined();
    expect(calls('setBuildVolume(')).toEqual([
      'setBuildVolume({"bed":{"shape":"rect"},"x":9})',
      'setBuildVolume({"bed":{"shape":"rect"},"x":9})'
    ]);
    await m.unmount();
  });
});

describe('<GcodePreview> (react) wiring: events reach callbacks', () => {
  it('maps every event to its callback with the literal payload', async () => {
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
    await m.unmount();
  });
});

describe('<GcodePreview> (react) wiring: handle plumbing', () => {
  it('the handle forwards parse/cancel/tickProgress/observeProgress/capture arguments', async () => {
    const m = await mount();
    log.length = 0;
    const h = m.ref.current!;
    await act(async () => {
      void h.parse(new Uint8Array(3), { maxSegments: 2 });
      h.cancel();
      h.tickProgress(12);
      h.observeProgress({ v: 1, timestampMs: 5, position: { byte: 1 } });
      h.clearProgress();
      await h.capture({ width: 10 } as never);
    });
    expect(log).toEqual([
      'ctl.parse("Uint8Array(3)",{"maxSegments":2})',
      'ctl.cancel()',
      'ctl.tickProgress(12)',
      'ctl.observeProgress({"v":1,"timestampMs":5,"position":{"byte":1}})',
      'ctl.clearProgress()',
      'capture({"width":10})'
    ]);
    await m.unmount();
  });

  it('dispose() disposes the controller, and the next use builds a fresh one', async () => {
    const m = await mount();
    expect(created).toHaveLength(1);
    m.ref.current!.dispose();
    expect(calls('ctl.dispose')).toEqual(['ctl.dispose()']);
    void m.ref.current!.controls;
    expect(created).toHaveLength(2);
    await m.unmount();
  });

  it('a canvas detached after dispose() does not build a new controller', async () => {
    const m = await mount();
    m.ref.current!.dispose();
    await m.unmount();
    expect(created).toHaveLength(1);
  });

  it('unmount unbinds the canvas without creating a controller', async () => {
    const m = await mount();
    await m.unmount();
    expect(calls('ctl.bindCanvas').at(-1)).toBe('ctl.bindCanvas(null)');
    expect(created).toHaveLength(1);
  });
});
describe('<GcodePreview> (react) wiring: scrub props and a source change (Part C)', () => {
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
    await m.unmount();
  });
  it('a StrictMode mount sends no clear for an unset scrubTime', async () => {
    const m = await mount({ scrub: 5 }, { strict: true });
    expect(view().filter((l) => l.includes('null'))).toEqual([]);
    expect(view().at(-1)).toBe('setScrubPosition(5)');
    await m.unmount();
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
    await m.unmount();
  });
});
