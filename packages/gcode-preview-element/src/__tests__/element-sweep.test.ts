// @vitest-environment happy-dom
/**
 * Mutation-sweep pins for the older `<gcode-preview>` / `<gcode-model-viewer>` code: boolean attributes,
 * layer-range / role-list parsing, feature-role diffing, build volume / colour / theme setters, pre-connect
 * camera state, double connect, and the event re-emit shapes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SuiteStubWorker, makeSuiteStubGL } from '@chestnutlabs/gcode-preview-core/testing';
import { type GcodePreviewElement, defineGcodePreview } from '../index';
import { type GcodeModelViewerElement, defineGcodeModelViewer } from '../model/index';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
type Priv = { reemit(e: unknown): void; controller: { clearProgress(): void } };

function makePreview(attrs: Record<string, string> = {}): GcodePreviewElement {
  defineGcodePreview();
  const canvas = document.createElement('canvas');
  const el = document.createElement('gcode-preview') as GcodePreviewElement;
  el.createWorker = () => new SuiteStubWorker();
  el.rendererOptions = { createRenderer: () => makeSuiteStubGL(canvas), scheduleFrame: (cb) => cb(), chunksPerTick: 8 };
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function makeModel(attrs: Record<string, string> = {}): GcodeModelViewerElement {
  defineGcodeModelViewer();
  const canvas = document.createElement('canvas');
  const el = document.createElement('gcode-model-viewer') as GcodeModelViewerElement;
  el.createRenderer = () => makeSuiteStubGL(canvas) as never;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
async function connected<T extends HTMLElement>(el: T): Promise<T> {
  document.body.appendChild(el);
  await settle();
  return el;
}
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('<gcode-preview> boolean attributes', () => {
  it('getters: the show-* defaults, and only the exact string decides', () => {
    const el = makePreview();
    expect([el.showTravel, el.showWipe, el.showRetractions, el.showVolumeCage]).toEqual([true, true, false, true]);
    el.setAttribute('show-travel', 'false');
    el.setAttribute('show-wipe', 'false');
    el.setAttribute('show-retractions', 'true');
    el.setAttribute('show-volume-cage', 'false');
    expect([el.showTravel, el.showWipe, el.showRetractions, el.showVolumeCage]).toEqual([false, false, true, false]);
    for (const a of ['show-travel', 'show-wipe', 'show-retractions', 'show-volume-cage']) el.setAttribute(a, 'x');
    expect([el.showTravel, el.showWipe, el.showRetractions, el.showVolumeCage]).toEqual([true, true, false, true]);
  });
  it('setters write the literal strings', () => {
    const el = makePreview();
    el.showTravel = false;
    el.showWipe = false;
    el.showRetractions = true;
    el.showVolumeCage = false;
    expect(el.getAttribute('show-travel')).toBe('false');
    expect(el.getAttribute('show-wipe')).toBe('false');
    expect(el.getAttribute('show-retractions')).toBe('true');
    expect(el.getAttribute('show-volume-cage')).toBe('false');
    el.showTravel = true;
    el.showWipe = true;
    el.showRetractions = false;
    el.showVolumeCage = true;
    expect(el.getAttribute('show-travel')).toBe('true');
    expect(el.getAttribute('show-wipe')).toBe('true');
    expect(el.getAttribute('show-retractions')).toBe('false');
    expect(el.getAttribute('show-volume-cage')).toBe('true');
  });
  it('changes reach the controls: only exact "false" hides, only exact "true" shows retractions', async () => {
    const el = await connected(makePreview());
    const kind = vi.spyOn(el.controls, 'setKindVisible');
    const cage = vi.spyOn(el.controls, 'setBuildVolumeCage');
    const ret = vi.spyOn(el.controls, 'setShowRetractions');
    el.setAttribute('show-travel', 'false');
    el.setAttribute('show-travel', 'x');
    el.setAttribute('show-wipe', 'false');
    el.setAttribute('show-wipe', 'x');
    expect(kind.mock.calls).toEqual([
      ['travel', false],
      ['travel', true],
      ['wipe', false],
      ['wipe', true]
    ]);
    el.setAttribute('show-volume-cage', 'false');
    el.setAttribute('show-volume-cage', 'x');
    expect(cage.mock.calls).toEqual([[false], [true]]);
    el.setAttribute('show-retractions', 'true');
    el.setAttribute('show-retractions', 'x');
    expect(ret.mock.calls).toEqual([[true], [false]]);
  });
});

describe('<gcode-preview> layer-range and hidden-feature-roles parsing', () => {
  it('layer-range needs exactly two numbers', () => {
    const el = makePreview();
    for (const bad of ['1', '1,2,3', 'a,b', '1,b', '']) {
      el.setAttribute('layer-range', bad);
      expect(el.layerRange).toBeNull();
    }
    el.setAttribute('layer-range', ' 1 , 2 ');
    expect(el.layerRange).toEqual([1, 2]);
    el.layerRange = [3, 4];
    expect(el.getAttribute('layer-range')).toBe('3,4');
    el.layerRange = null;
    expect(el.hasAttribute('layer-range')).toBe(false);
  });
  it('removing layer-range resets the clip to everything', async () => {
    const el = await connected(makePreview({ 'layer-range': '1,2' }));
    const spy = vi.spyOn(el.controls, 'setLayerRange');
    el.removeAttribute('layer-range');
    expect(spy.mock.calls).toEqual([[0, Number.POSITIVE_INFINITY]]);
    el.setAttribute('layer-range', '2,5');
    expect(spy.mock.calls[1]).toEqual([2, 5]);
  });
  it('the role list ignores blanks and non-finite entries and trims', () => {
    const el = makePreview();
    el.setAttribute('hidden-feature-roles', '');
    expect(el.hiddenFeatureRoles).toEqual([]);
    el.setAttribute('hidden-feature-roles', '   ');
    expect(el.hiddenFeatureRoles).toEqual([]);
    el.setAttribute('hidden-feature-roles', ' 6 , 7 ');
    expect(el.hiddenFeatureRoles).toEqual([6, 7]);
    el.setAttribute('hidden-feature-roles', 'a,6,Infinity,NaN,-Infinity');
    expect(el.hiddenFeatureRoles).toEqual([6]);
    el.hiddenFeatureRoles = [6, 7];
    expect(el.getAttribute('hidden-feature-roles')).toBe('6,7');
    el.hiddenFeatureRoles = [];
    expect(el.hasAttribute('hidden-feature-roles')).toBe(false);
    el.hiddenFeatureRoles = [1];
    el.hiddenFeatureRoles = null;
    expect(el.hasAttribute('hidden-feature-roles')).toBe(false);
  });
  it('role changes toggle only the roles that changed', async () => {
    const el = await connected(makePreview({ 'hidden-feature-roles': '6,7' }));
    const spy = vi.spyOn(el.controls, 'setFeatureRoleVisible');
    el.setAttribute('hidden-feature-roles', '6,7,8');
    expect(spy.mock.calls).toEqual([[8, false]]);
    spy.mockClear();
    el.setAttribute('hidden-feature-roles', '7');
    expect(spy.mock.calls).toEqual([
      [6, true],
      [8, true]
    ]);
    spy.mockClear();
    el.removeAttribute('hidden-feature-roles');
    expect(spy.mock.calls).toEqual([[7, true]]);
  });
});

describe('<gcode-preview> property setters', () => {
  it('buildVolume reaches the controls only for a machine geometry, only when connected', async () => {
    const el = makePreview();
    el.buildVolume = { bed: 1 } as never; // disconnected: stored, nothing to call
    const el2 = await connected(makePreview());
    const spy = vi.spyOn(el2.controls, 'setBuildVolume').mockImplementation(() => undefined);
    el2.buildVolume = { x: 1 } as never;
    el2.buildVolume = undefined;
    expect(spy).not.toHaveBeenCalled();
    const machine = { bed: 1 } as never;
    el2.buildVolume = machine;
    expect(spy.mock.calls).toEqual([[machine]]);
  });
  it('buildVolume = null before connect is no volume: connect builds the controller (#590)', async () => {
    const el = makePreview();
    el.buildVolume = null as never;
    const errors: unknown[] = [];
    el.addEventListener('error', (e) => errors.push((e as CustomEvent).detail));
    await connected(el);
    expect(el.controls).not.toBeNull();
    expect(el.buildVolume).toBeNull();
    expect(errors).toEqual([]);
  });
  it('buildVolume = null once connected does not throw and calls nothing (#590)', async () => {
    const el = await connected(makePreview());
    const spy = vi.spyOn(el.controls, 'setBuildVolume').mockImplementation(() => undefined);
    expect(() => (el.buildVolume = null as never)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });
  it('colorMode and theme: undefined is stored but not applied; a value is applied', async () => {
    const el = await connected(makePreview());
    const cm = vi.spyOn(el.controls, 'setColorMode').mockImplementation(() => undefined);
    const th = vi.spyOn(el.controls, 'setTheme').mockImplementation(() => undefined);
    el.colorMode = undefined;
    el.theme = undefined;
    expect(cm).not.toHaveBeenCalled();
    expect(th).not.toHaveBeenCalled();
    el.colorMode = { mode: 'feature' } as never;
    el.theme = { background: '#000000' } as never;
    expect(cm.mock.calls).toEqual([[{ mode: 'feature' }]]);
    expect(th.mock.calls).toEqual([[{ background: '#000000' }]]);
  });
  it('pixelRatio and cameraFov accept their inclusive upper ends through the property', () => {
    const el = makePreview();
    el.pixelRatio = 4;
    expect(el.getAttribute('pixel-ratio')).toBe('4');
    expect(() => (el.pixelRatio = 4.01)).toThrow(RangeError);
    expect(() => (el.pixelRatio = 0)).toThrow(RangeError);
    el.pixelRatio = 'device';
    expect(el.getAttribute('pixel-ratio')).toBe('device');
    el.cameraFov = 120;
    expect(el.getAttribute('camera-fov')).toBe('120');
  });
  it('a camera state set before connect is applied at connect', async () => {
    const first = await connected(makePreview());
    const saved = { ...first.controls.getCameraState()!, position: { x: -70, y: 80, z: -90 } };
    const el = makePreview();
    el.cameraState = saved;
    await connected(el);
    const p = el.controls.getCameraState()!.position; // the saved pose (x and z negative), not the default iso
    expect(p.x).toBeLessThan(0);
    expect(p.z).toBeLessThan(0);
    expect(p.y).toBeGreaterThan(0);
  });
});

describe('<gcode-preview> lifecycle and re-emit', () => {
  it('a second connectedCallback keeps the first controller', async () => {
    const el = await connected(makePreview());
    const controls = el.controls;
    el.connectedCallback();
    expect(el.controls).toBe(controls);
  });
  it('progress: null clears, a value observes; disconnected calls are inert', async () => {
    const idle = makePreview();
    expect(idle.observeProgress({} as never)).toBeNull();
    expect(idle.tickProgress(0)).toBeNull();
    expect(() => idle.clearProgress()).not.toThrow();
    const el = await connected(makePreview());
    const clear = vi.spyOn((el as unknown as Priv).controller, 'clearProgress');
    el.progress = null;
    expect(clear).toHaveBeenCalledTimes(1);
  });
  it('re-emits: a geometry mismatch is its own event, not `error`; presentation detail omits an absent reason', () => {
    const el = makePreview();
    const seen: [string, unknown][] = [];
    for (const t of ['error', 'machine-geometry-mismatch', 'progress-presentation-changed']) {
      el.addEventListener(t, (e) => seen.push([t, (e as CustomEvent).detail]));
    }
    const p = el as unknown as Priv;
    p.reemit({ type: 'error', code: 'machine-geometry-mismatch', message: 'm' });
    p.reemit({ type: 'error', code: 'E_X', message: 'x' });
    p.reemit({ type: 'progress-presentation-changed', mode: 'hold' });
    p.reemit({ type: 'progress-presentation-changed', mode: 'hold', reason: 'r' });
    expect(seen).toStrictEqual([
      ['machine-geometry-mismatch', { message: 'm' }],
      ['error', { code: 'E_X', message: 'x' }],
      ['progress-presentation-changed', { mode: 'hold' }],
      ['progress-presentation-changed', { mode: 'hold', reason: 'r' }]
    ]);
  });
});

describe('<gcode-model-viewer> older code', () => {
  it('a second connectedCallback keeps the first controller', async () => {
    const el = await connected(makeModel());
    const controls = el.controls;
    el.connectedCallback();
    expect(el.controls).toBe(controls);
  });
  it('source: null is stored but not sent; a value is sent', async () => {
    const el = await connected(makeModel());
    const spy = vi.spyOn(el.controls, 'setSource').mockResolvedValue(undefined as never);
    el.source = null;
    expect(spy).not.toHaveBeenCalled();
    const src = { kind: 'stl', bytes: new Uint8Array(0) } as never;
    el.source = src;
    expect(spy.mock.calls).toEqual([[src]]);
  });
  it('buildVolume undefined/null clears (null reaches the controls); theme undefined is ignored', async () => {
    const el = await connected(makeModel());
    const bv = vi.spyOn(el.controls, 'setBuildVolume').mockImplementation(() => undefined);
    el.buildVolume = undefined as never;
    expect(el.buildVolume).toBeNull();
    expect(bv.mock.calls).toEqual([[null]]);
    const th = vi.spyOn(el.controls, 'setTheme').mockImplementation(() => undefined);
    el.theme = undefined;
    expect(th).not.toHaveBeenCalled();
    expect(el.theme).toBeUndefined();
  });
  it('lens and pixel ratio properties accept their inclusive ends', () => {
    const el = makeModel();
    el.cameraFov = 120;
    el.cameraFov = 10;
    expect(el.cameraFov).toBe(10);
    expect(() => (el.cameraFov = 120.01)).toThrow(RangeError);
    el.pixelRatio = 4;
    expect(el.pixelRatio).toBe(4);
    expect(() => (el.pixelRatio = 4.01)).toThrow(RangeError);
    expect(() => (el.pixelRatio = 0)).toThrow(RangeError);
  });
  it('attributes: camera-fov / pixel-ratio record valid values only; cage and background reach the controls', async () => {
    const el = await connected(makeModel());
    const bg = vi.spyOn(el.controls, 'setBackground');
    const cage = vi.spyOn(el.controls, 'setBuildVolumeCage');
    const fov = vi.spyOn(el.controls, 'setCameraFov');
    const pr = vi.spyOn(el.controls, 'setPixelRatio');
    el.setAttribute('background', '#102030');
    el.removeAttribute('background');
    expect(bg.mock.calls).toEqual([['#102030']]);
    expect(el.background).toBe('#102030');
    el.setAttribute('show-volume-cage', 'false');
    el.setAttribute('show-volume-cage', 'x');
    expect(cage.mock.calls).toEqual([[false], [true]]);
    expect(el.showVolumeCage).toBe(true);
    el.setAttribute('camera-fov', '40');
    el.setAttribute('camera-fov', 'abc');
    el.setAttribute('camera-fov', ' ');
    el.setAttribute('camera-fov', '120');
    el.setAttribute('camera-fov', '121');
    expect(fov.mock.calls).toEqual([[40], [120]]);
    expect(el.cameraFov).toBe(120);
    el.setAttribute('pixel-ratio', '2');
    el.setAttribute('pixel-ratio', 'bad');
    el.setAttribute('pixel-ratio', '4');
    el.setAttribute('pixel-ratio', '4.5');
    expect(pr.mock.calls).toEqual([[2], [4]]);
    expect(el.pixelRatio).toBe(4);
  });
  it('showVolumeCage: default on, exact "false" off, the setter writes strings', () => {
    const el = makeModel();
    expect(el.showVolumeCage).toBe(true);
    el.showVolumeCage = false;
    expect(el.getAttribute('show-volume-cage')).toBe('false');
    expect(el.showVolumeCage).toBe(false);
    el.showVolumeCage = true;
    expect(el.getAttribute('show-volume-cage')).toBe('true');
  });
  it('a camera state set before connect is applied at connect', async () => {
    const first = await connected(makeModel());
    const saved = { ...first.controls.getCameraState()!, position: { x: -70, y: 80, z: -90 } };
    const el = makeModel();
    el.cameraState = saved;
    await connected(el);
    const p = el.controls.getCameraState()!.position; // the saved pose (x and z negative), not the default iso
    expect(p.x).toBeLessThan(0);
    expect(p.z).toBeLessThan(0);
    expect(p.y).toBeGreaterThan(0);
  });
  it('re-emits context-lost, context-restored and renderer-unsupported as DOM events', () => {
    const el = makeModel();
    const seen: [string, unknown][] = [];
    for (const t of ['context-lost', 'context-restored', 'renderer-unsupported', 'camerachange', 'ready', 'error']) {
      el.addEventListener(t, (e) => seen.push([t, (e as CustomEvent).detail]));
    }
    const p = el as unknown as Priv;
    p.reemit({ type: 'context-lost' });
    p.reemit({ type: 'context-restored' });
    p.reemit({ type: 'renderer-unsupported', feature: 'f', message: 'm' });
    expect(seen).toStrictEqual([
      ['context-lost', null],
      ['context-restored', null],
      ['renderer-unsupported', { feature: 'f', message: 'm' }]
    ]);
  });
});
