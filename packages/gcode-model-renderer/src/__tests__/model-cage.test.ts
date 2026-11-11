// @vitest-environment happy-dom
/**
 * #490 — the model viewer's build-volume cage toggle (parity with the toolpath `setBuildVolumeCage`): in place,
 * remembered across every plate rebuild (theme, bed, scope, context restore) and a capture cutout, the plate
 * itself unaffected, and the controller's pre-bind / option / rebind paths. Headless: stub GL + stub controls.
 */
import { describe, expect, it } from 'vitest';
import { Vector3, type Object3D, type PerspectiveCamera, type Scene } from 'three';
import { studioTheme, type ControlsLike, type GLRendererLike } from '@chestnutlabs/gcode-renderer-three';
import { createModelViewer, type ModelViewerOptions } from '../model-viewer.js';
import { createModelPreviewController } from '../model-preview.js';
import { IDENTITY_MAT4, type ModelScene } from '../scene-model.js';

function stubControls(camera: unknown): ControlsLike {
  return {
    object: camera,
    target: new Vector3(),
    enabled: true,
    update: () => undefined,
    dispose: () => undefined,
    addEventListener: () => undefined,
    listenToKeyEvents: () => undefined
  } as unknown as ControlsLike;
}

interface Frame {
  target: unknown;
  cage: boolean | null;
  plate: boolean | null;
}

const cageOf = (s: Scene): Object3D | undefined => s.getObjectByName('volumeCage');
const plateOf = (s: Scene): Object3D | undefined => s.getObjectByName('buildVolume');

function rig(options: ModelViewerOptions = {}, opts: { capture?: boolean } = {}) {
  const canvas = document.createElement('canvas');
  const frames: Frame[] = [];
  let scene: Scene | null = null;
  let target: unknown = null;
  const gl: GLRendererLike = {
    render: (s) => {
      scene = s;
      frames.push({ target, cage: cageOf(s)?.visible ?? null, plate: plateOf(s)?.visible ?? null });
    },
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas,
    ...(opts.capture
      ? {
          setRenderTarget: (t: unknown) => {
            target = t;
          },
          readRenderTargetPixels: () => undefined
        }
      : {})
  };
  const viewer = createModelViewer(canvas, {
    createRenderer: () => gl,
    createControls: (cam) => stubControls(cam as PerspectiveCamera),
    ...options
  });
  return { viewer, canvas, frames, scene: () => scene! };
}

/** Two 10 mm objects so an `{ objectIds }` scope is a real rebuild of a smaller scene. */
function twoObjects(): ModelScene {
  const obj = (id: string, dx: number) => ({
    id,
    geometry: {
      positions: new Float32Array([dx, 0, 0, dx + 10, 0, 0, dx, 10, 0, dx, 0, 5]),
      indices: new Uint32Array([0, 1, 2, 0, 1, 3])
    },
    transform: IDENTITY_MAT4
  });
  return {
    objects: [obj('a', 0), obj('b', 20)],
    bounds: { min: [0, 0, 0], max: [30, 10, 5] },
    capabilities: {
      materials: 'unavailable',
      transforms: 'unavailable',
      multiObject: 'known',
      instanced: 'unavailable',
      plates: 'unavailable'
    }
  };
}

const BED = { x: 100, y: 100, z: 100 };

describe('model viewer — setBuildVolumeCage', () => {
  it('draws the cage by default (unchanged), and hides only the cage in place', async () => {
    const r = rig({ buildVolume: BED });
    await r.viewer.setSource(twoObjects());
    expect(cageOf(r.scene())!.visible).toBe(true);
    const plate = plateOf(r.scene());
    const before = r.frames.length;
    r.viewer.setBuildVolumeCage(false);
    expect(r.frames.length).toBe(before + 1); // one render, so the change is on screen
    expect(r.frames.at(-1)!.cage).toBe(false);
    expect(r.frames.at(-1)!.plate).toBe(true); // the plate, grid and shadow stay
    expect(plateOf(r.scene())).toBe(plate); // in place: not rebuilt
    expect(r.viewer.getPlacement()).toEqual({ placement: 'approximated', placementOffset: { x: 35, y: 45, z: 0 } });
    r.viewer.setBuildVolumeCage(true);
    expect(r.frames.at(-1)!.cage).toBe(true);
  });

  it('the showVolumeCage: false option draws the plate without its cage', async () => {
    const r = rig({ buildVolume: BED, showVolumeCage: false });
    await r.viewer.setSource(twoObjects());
    expect(cageOf(r.scene())!.visible).toBe(false);
    expect(plateOf(r.scene())!.visible).toBe(true);
  });

  it('a toggle before any plate is drawn applies once the plate appears', async () => {
    const r = rig();
    r.viewer.setBuildVolumeCage(false); // no plate, no source yet: nothing to throw
    await r.viewer.setSource(twoObjects());
    expect(cageOf(r.scene())).toBeUndefined();
    r.viewer.setBuildVolume(BED);
    expect(cageOf(r.scene())!.visible).toBe(false);
  });

  describe('stays off across every plate rebuild', () => {
    async function off() {
      const r = rig({ buildVolume: BED });
      await r.viewer.setSource(twoObjects());
      r.viewer.setBuildVolumeCage(false);
      return r;
    }

    it('setTheme', async () => {
      const r = await off();
      const old = plateOf(r.scene());
      r.viewer.setTheme(studioTheme('dark'));
      expect(plateOf(r.scene())).not.toBe(old); // really rebuilt
      expect(cageOf(r.scene())!.visible).toBe(false);
    });

    it('setBuildVolume', async () => {
      const r = await off();
      const old = plateOf(r.scene());
      r.viewer.setBuildVolume({ x: 200, y: 200, z: 200 });
      expect(plateOf(r.scene())).not.toBe(old);
      expect(cageOf(r.scene())!.visible).toBe(false);
    });

    it('setRenderScope', async () => {
      const r = await off();
      const old = plateOf(r.scene());
      r.viewer.setRenderScope({ objectIds: ['a'] });
      expect(plateOf(r.scene())).not.toBe(old);
      expect(r.viewer.getPlacement().placement).toBe('approximated');
      expect(cageOf(r.scene())!.visible).toBe(false);
    });

    it('a context-loss restore', async () => {
      const r = await off();
      const old = plateOf(r.scene());
      r.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
      r.canvas.dispatchEvent(new Event('webglcontextrestored'));
      expect(plateOf(r.scene())).not.toBe(old);
      expect(cageOf(r.scene())!.visible).toBe(false);
    });

    it('a new source', async () => {
      const r = await off();
      await r.viewer.setSource(twoObjects());
      expect(cageOf(r.scene())!.visible).toBe(false);
    });
  });

  it('capture({ includeBuildVolume: false }) with the cage off restores the plate with the cage still off', async () => {
    const r = rig({ buildVolume: BED }, { capture: true });
    r.viewer.resize(400, 300);
    await r.viewer.setSource(twoObjects());
    r.viewer.setBuildVolumeCage(false);
    const before = r.frames.length;
    await r.viewer.capture({ includeBuildVolume: false }).catch(() => undefined); // encoding needs a real 2D canvas
    const cap = r.frames.slice(before).filter((f) => f.target !== null);
    expect(cap).toHaveLength(1);
    expect(cap[0].plate).toBe(false);
    expect(plateOf(r.scene())!.visible).toBe(true);
    expect(cageOf(r.scene())!.visible).toBe(false);
  });

  it('a default capture keeps the cage off too', async () => {
    const r = rig({ buildVolume: BED }, { capture: true });
    r.viewer.resize(400, 300);
    await r.viewer.setSource(twoObjects());
    r.viewer.setBuildVolumeCage(false);
    const before = r.frames.length;
    await r.viewer.capture().catch(() => undefined);
    const cap = r.frames.slice(before).find((f) => f.target !== null)!;
    expect(cap.plate).toBe(true);
    expect(cap.cage).toBe(false);
  });
});

describe('model preview controller — setBuildVolumeCage', () => {
  function sized(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, get: () => 600 });
    return canvas;
  }
  function ctl(options: Parameters<typeof createModelPreviewController>[0] = {}) {
    let scene: Scene | null = null;
    const c = createModelPreviewController({
      buildVolume: BED,
      createRenderer: (canvas) => ({
        render: (s) => {
          scene = s;
        },
        setSize: () => undefined,
        dispose: () => undefined,
        domElement: canvas
      }),
      createControls: (cam) => stubControls(cam),
      ...options
    });
    return { c, cage: () => cageOf(scene!)?.visible ?? null };
  }

  it('the default is a drawn cage', async () => {
    const { c, cage } = ctl();
    c.bindCanvas(sized());
    await c.controls.setSource(twoObjects());
    expect(cage()).toBe(true);
    c.dispose();
  });

  it('the showVolumeCage: false option reaches the engine at bind', async () => {
    const { c, cage } = ctl({ showVolumeCage: false });
    c.bindCanvas(sized());
    await c.controls.setSource(twoObjects());
    expect(cage()).toBe(false);
    c.dispose();
  });

  it('a call before the canvas binds is remembered', async () => {
    const { c, cage } = ctl();
    c.controls.setBuildVolumeCage(false);
    c.bindCanvas(sized());
    await c.controls.setSource(twoObjects());
    expect(cage()).toBe(false);
    c.dispose();
  });

  it('a call after bind is forwarded, and survives a canvas rebind', async () => {
    const { c, cage } = ctl();
    c.bindCanvas(sized());
    await c.controls.setSource(twoObjects());
    c.controls.setBuildVolumeCage(false);
    expect(cage()).toBe(false);
    c.bindCanvas(sized()); // a new engine: built from the remembered value, not the initial option
    await c.controls.setSource(twoObjects());
    expect(cage()).toBe(false);
    c.controls.setBuildVolumeCage(true);
    expect(cage()).toBe(true);
    c.dispose();
  });

  it('never moves the model: placement in state is unchanged by the toggle', async () => {
    const { c } = ctl();
    c.bindCanvas(sized());
    await c.controls.setSource(twoObjects());
    const seen: unknown[] = [];
    c.onStateChange((s) => seen.push(s));
    c.controls.setBuildVolumeCage(false);
    expect(seen).toHaveLength(0);
    expect(c.getState().placementOffset).toEqual({ x: 35, y: 45, z: 0 });
    c.dispose();
  });
});
