// @vitest-environment happy-dom
/**
 * Part B: core checks every 3D renderer option synchronously with the renderer's own rules (validate.ts via
 * the three-free `/lite` entry). A bad option throws `RangeError` from the constructor or the setter, in
 * EVERY mode, instead of failing the on-demand 3D load (`E_RENDERER_LOAD`) or coming back later as
 * `E_CONTROL_REJECTED`. Literal messages.
 */
import { describe, expect, it, vi } from 'vitest';
import type { BuildVolumeDef, CameraState, Theme } from '@chestnutlabs/gcode-renderer-three';
import { createPreviewController, type PreviewControllerOptions, type PreviewEvent } from '../index';
import { SuiteStubWorker, TEST_MACHINE, makeSuiteStubGL } from '../testing';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

type RendererOpts = NonNullable<PreviewControllerOptions['renderer']>;
const make = (renderer: RendererOpts) =>
  createPreviewController({ createWorker: () => new SuiteStubWorker(), renderer });
const make3d = () =>
  make({
    quality: 'lines',
    createRenderer: (c) => makeSuiteStubGL(c as HTMLCanvasElement),
    scheduleFrame: (cb) => cb()
  });

const POSE: CameraState = {
  cameraMode: 'perspective',
  position: { x: 1, y: 2, z: 3 },
  target: { x: 0, y: 0, z: 0 },
  zoom: 1
};
const VOLUME: BuildVolumeDef = { x: 220, y: 220, z: 250 };

/** One bad value per renderer option the constructor checks, with the renderer's literal message. */
const BAD_OPTIONS: Array<[string, Partial<RendererOpts>, string]> = [
  ['mode', { mode: '3D' as '3d' }, "renderer.mode must be '2d' or '3d' (got 3D)"],
  ['buildVolume', { buildVolume: { ...VOLUME, x: Number.NaN } }, 'buildVolume.x must be a finite number (got NaN)'],
  ['qualityMode', { qualityMode: 'best' as 'full' }, "qualityMode must be 'full', 'adaptive' or 'fast' (got best)"],
  [
    'progressivePreview',
    { progressivePreview: 'stream' as 'lines' },
    "progressivePreview must be 'auto', 'lines', 'hold' or 'off' (got stream)"
  ],
  [
    'cameraMode',
    { cameraMode: 'ortho' as 'orthographic' },
    "cameraMode must be 'perspective' or 'orthographic' (got ortho)"
  ],
  ['cameraFov', { cameraFov: 5 }, 'fov must be in [10, 120] degrees (got 5)'],
  ['pixelRatio', { pixelRatio: 0 }, "pixelRatio must be 'device' or a number in (0, 4] (got 0)"],
  ['frameContent', { frameContent: 'model' as 'object' }, "frameContent must be 'object' or 'all' (got model)"],
  ['interactionQuality', { interactionQuality: 'on' as 'auto' }, "interactionQuality must be 'off' or 'auto' (got on)"],
  ['theme', { theme: { gridOpacity: 2 } }, 'theme gridOpacity must be a number in [0,1] (got 2)']
];

describe('constructor: a bad renderer option throws RangeError synchronously', () => {
  it.each(BAD_OPTIONS)('%s, in 3D (the default mode; before any 3D load)', (_name, bad, message) => {
    const run = (): unknown => make({ ...bad });
    expect(run).toThrow(RangeError);
    expect(run).toThrow(message);
  });

  it.each(BAD_OPTIONS.filter(([n]) => n !== 'mode'))('%s, in 2D too (parity with colorMode)', (_name, bad, message) => {
    expect(() => make({ mode: '2d', ...bad })).toThrow(message);
  });

  it('every valid value still constructs, in both modes', () => {
    const good: Partial<RendererOpts> = {
      buildVolume: VOLUME,
      qualityMode: 'fast',
      progressivePreview: 'off',
      cameraMode: 'orthographic',
      cameraFov: 120,
      pixelRatio: 'device',
      frameContent: 'object',
      interactionQuality: 'off',
      theme: { gridOpacity: 1 }
    };
    for (const mode of ['2d', '3d'] as const) make({ mode, ...good }).dispose();
  });

  it('a MachineGeometry-shaped volume is left to the renderer (a discovered bed reports, never throws)', () => {
    const machine = { ...TEST_MACHINE, bed: { ...TEST_MACHINE.bed, x: Number.NaN } };
    expect(() => make({ mode: '2d', buildVolume: machine as unknown as BuildVolumeDef }).dispose()).not.toThrow();
  });
});

/** Each setter, a bad value, its literal message. */
type Ctl = ReturnType<typeof make3d>;
const BAD_CALLS: Array<[string, (c: Ctl) => void, string]> = [
  [
    'setQualityMode',
    (c) => c.controls.setQualityMode('best' as 'full'),
    "qualityMode must be 'full', 'adaptive' or 'fast' (got best)"
  ],
  [
    'setProgressivePreview',
    (c) => c.controls.setProgressivePreview('stream' as 'lines'),
    "progressivePreview must be 'auto', 'lines', 'hold' or 'off' (got stream)"
  ],
  [
    'setCameraMode',
    (c) => c.controls.setCameraMode('ortho' as 'perspective'),
    "cameraMode must be 'perspective' or 'orthographic' (got ortho)"
  ],
  [
    'setView',
    (c) => c.controls.setView('side' as 'top'),
    "view must be 'top', 'bottom', 'front', 'back', 'left', 'right' or 'iso' (got side)"
  ],
  [
    'setCameraState',
    (c) => c.controls.setCameraState({ ...POSE, zoom: 0 }),
    'camera state zoom must be a finite number > 0 (got 0)'
  ],
  [
    'setTheme',
    (c) => c.controls.setTheme({ gridOpacity: -1 } as Theme),
    'theme gridOpacity must be a number in [0,1] (got -1)'
  ],
  [
    'setBuildVolume',
    (c) => c.controls.setBuildVolume({ ...VOLUME, grid: 0 }),
    'buildVolume.grid must be a positive finite number (got 0)'
  ],
  [
    'setFrameContent',
    (c) => c.controls.setFrameContent('model' as 'all'),
    "frameContent must be 'object' or 'all' (got model)"
  ],
  [
    'setInteractionQuality',
    (c) => c.controls.setInteractionQuality('on' as 'off'),
    "interactionQuality must be 'off' or 'auto' (got on)"
  ]
];

describe('setters: a bad value throws before anything is queued', () => {
  it.each(BAD_CALLS)(
    '%s throws before the 3D renderer has loaded, and reports nothing later',
    async (_n, call, message) => {
      const c = make3d();
      const events: PreviewEvent[] = [];
      c.onEvent((e) => events.push(e));
      c.bindCanvas(document.createElement('canvas'));
      expect(c.raw.renderer()).toBeNull(); // the 3D load is still pending
      expect(() => call(c)).toThrow(RangeError);
      expect(() => call(c)).toThrow(message);
      await settle();
      expect(c.raw.renderer()).not.toBeNull();
      expect(c.getState().error).toBeNull();
      expect(events.filter((e) => e.type === 'error')).toEqual([]);
      c.dispose();
    }
  );

  it.each(BAD_CALLS)('%s throws on a bound 2D viewer too', (_n, call, message) => {
    const c = make({ mode: '2d' });
    c.bindCanvas(document.createElement('canvas'));
    expect(() => call(c as Ctl)).toThrow(message);
    c.dispose();
  });

  it('a MachineGeometry passed to setBuildVolume is not checked by core', () => {
    const c = make({ mode: '2d' });
    const machine = { ...TEST_MACHINE, bed: { ...TEST_MACHINE.bed, x: Number.NaN } };
    expect(() => c.controls.setBuildVolume(machine as unknown as BuildVolumeDef)).not.toThrow();
    c.dispose();
  });

  it('a rejected setBuildVolume does not count as a consumer volume: the file bed still auto-applies', async () => {
    const c = createPreviewController({
      createWorker: () => new SuiteStubWorker(TEST_MACHINE),
      renderer: { mode: '2d' }
    });
    const events: PreviewEvent[] = [];
    c.onEvent((e) => events.push(e));
    expect(() => c.controls.setBuildVolume({ ...VOLUME, z: Number.POSITIVE_INFINITY })).toThrow(
      'buildVolume.z must be a finite number (got Infinity)'
    );
    await c.parse(new Uint8Array(1_000));
    expect(events.some((e) => e.type === 'machine-geometry-discovered')).toBe(false);
    // Control: an accepted volume DOES make the file bed discovered-only.
    c.controls.setBuildVolume(VOLUME);
    await c.parse(new Uint8Array(1_000));
    expect(events.filter((e) => e.type === 'machine-geometry-discovered')).toHaveLength(1);
    c.dispose();
  });

  it('valid values still pass through every setter', async () => {
    const c = make3d();
    c.bindCanvas(document.createElement('canvas'));
    c.controls.setQualityMode('full');
    c.controls.setProgressivePreview('hold');
    c.controls.setCameraMode('orthographic');
    c.controls.setView('iso');
    c.controls.setTheme({ gridOpacity: 0 });
    c.controls.setBuildVolume(VOLUME);
    c.controls.setFrameContent('all');
    c.controls.setInteractionQuality('auto');
    await settle();
    c.controls.setCameraState(POSE);
    expect(c.getState().error).toBeNull();
    expect(c.controls.getCameraState()?.zoom).toBe(1);
    c.dispose();
  });
});

/**
 * R1 round A on #590: `null` (and `undefined`) mean "unset", as before these checks. A Vue prop or Svelte binding
 * hands over `null` for an option left empty; base defaulted it with `??` or a truthiness test.
 */
describe('null and undefined mean unset (the renderer default), never a throw', () => {
  const UNSET_OPTIONS = [
    'buildVolume',
    'qualityMode',
    'progressivePreview',
    'cameraMode',
    'cameraFov',
    'pixelRatio',
    'frameContent',
    'interactionQuality',
    'theme'
  ] as const;

  it.each(UNSET_OPTIONS)('%s: null constructs in 2D', (name) => {
    expect(() => make({ mode: '2d', [name]: null } as unknown as RendererOpts).dispose()).not.toThrow();
  });

  it.each(UNSET_OPTIONS)('%s: null constructs in 3D, and the 3D load succeeds', async (name) => {
    const c = make({
      quality: 'lines',
      createRenderer: (cv) => makeSuiteStubGL(cv as HTMLCanvasElement),
      scheduleFrame: (cb) => cb(),
      [name]: null
    } as unknown as RendererOpts);
    const events: PreviewEvent[] = [];
    c.onEvent((e) => events.push(e));
    c.bindCanvas(document.createElement('canvas'));
    await settle();
    expect(c.raw.renderer()).not.toBeNull();
    expect(events.filter((e) => e.type === 'error')).toEqual([]);
    expect(c.getState().error).toBeNull();
    c.dispose();
  });

  it('buildVolume: null is no consumer volume, so the file bed still auto-applies', async () => {
    const c = createPreviewController({
      createWorker: () => new SuiteStubWorker(TEST_MACHINE),
      renderer: { mode: '2d', buildVolume: null as unknown as BuildVolumeDef }
    });
    const events: PreviewEvent[] = [];
    c.onEvent((e) => events.push(e));
    await c.parse(new Uint8Array(1_000));
    expect(events.some((e) => e.type === 'machine-geometry-discovered')).toBe(false);
    c.dispose();
  });

  it.each([null, undefined])(
    'setBuildVolume(%s) is a no-op: no throw, nothing queued, not a consumer volume',
    async (v) => {
      const c = createPreviewController({
        createWorker: () => new SuiteStubWorker(TEST_MACHINE),
        renderer: {
          quality: 'lines',
          createRenderer: (cv) => makeSuiteStubGL(cv as HTMLCanvasElement),
          scheduleFrame: (cb) => cb()
        }
      });
      const events: PreviewEvent[] = [];
      c.onEvent((e) => events.push(e));
      c.bindCanvas(document.createElement('canvas'));
      expect(() => c.controls.setBuildVolume(v as unknown as BuildVolumeDef)).not.toThrow(); // queued path
      await settle();
      const r = c.raw.renderer();
      expect(r).not.toBeNull();
      const spy = vi.spyOn(r as NonNullable<typeof r>, 'setBuildVolume');
      expect(() => c.controls.setBuildVolume(v as unknown as BuildVolumeDef)).not.toThrow(); // bound path
      await c.parse(new Uint8Array(1_000));
      // The file bed applied (it would only be reported if a consumer volume had been set).
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(TEST_MACHINE);
      expect(events.filter((e) => e.type === 'error' || e.type === 'machine-geometry-discovered')).toEqual([]);
      c.dispose();
    }
  );

  it.each([
    ['setFrameContent', null, 'all'],
    ['setFrameContent', undefined, 'all'],
    ['setInteractionQuality', null, 'off'],
    ['setInteractionQuality', undefined, 'off']
  ] as const)('%s(%s) applies the default %s, queued and bound', async (control, value, expected) => {
    const c = make3d();
    c.bindCanvas(document.createElement('canvas'));
    const calls: unknown[] = [];
    const call = (): void => (c.controls[control] as (m: unknown) => void)(value);
    expect(call).not.toThrow(); // before the 3D load: queued
    expect(c.raw.renderer()).toBeNull();
    await settle();
    const r = c.raw.renderer() as NonNullable<ReturnType<typeof c.raw.renderer>>;
    expect(c.getState().error).toBeNull(); // the queued call replayed without a rejection
    vi.spyOn(r, control).mockImplementation((m: unknown) => void calls.push(m));
    expect(call).not.toThrow(); // bound
    expect(calls).toEqual([expected]);
    c.dispose();
  });
});

describe('a non-object build volume is a RangeError, never a TypeError', () => {
  it('in the constructor and in setBuildVolume', () => {
    const bad = 220 as unknown as BuildVolumeDef;
    const message = 'buildVolume.x must be a finite number (got undefined)';
    expect(() => make({ mode: '2d', buildVolume: bad })).toThrow(RangeError);
    expect(() => make({ mode: '2d', buildVolume: bad })).toThrow(message);
    const c = make({ mode: '2d' });
    expect(() => c.controls.setBuildVolume(bad)).toThrow(RangeError);
    expect(() => c.controls.setBuildVolume(bad)).toThrow(message);
    c.dispose();
  });
});
