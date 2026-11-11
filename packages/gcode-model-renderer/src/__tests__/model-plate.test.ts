// @vitest-environment happy-dom
/**
 * DD-032 §4.3 / §6 — the model-viewer plate, live: placement fixtures (offset AND framed view contains the
 * drawn part), no-buildVolume ⇒ unchanged scene, authored bounds, picking through the presentation offset,
 * capture cutouts, model lighting unchanged under a theme, background precedence, the leak matrix (incl.
 * context-loss restore) and the lens. Headless: stub GL (records what it is asked to render) + stub controls.
 */
import { describe, expect, it } from 'vitest';
import {
  Camera,
  Color,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  PerspectiveCamera,
  Raycaster,
  Vector3,
  type Object3D,
  type Scene
} from 'three';
import { studioTheme, type ControlsLike, type GLRendererLike } from '@chestnutlabs/gcode-renderer-three';
import { createModelViewer, type ModelViewer, type ModelViewerOptions } from '../model-viewer.js';
import { createModelPreviewController } from '../model-preview.js';
import { IDENTITY_MAT4, type ModelScene } from '../scene-model.js';
import { enc, makeZip, singleObjectModel, TWO_PLATE_MODEL, TWO_PLATE_SETTINGS } from './zip-fixture.js';

interface Render {
  background: Scene['background'];
  target: unknown;
  plateVisible: boolean | null;
}

function stubControls(camera: PerspectiveCamera | { position: Vector3 }) {
  const listeners: Record<string, (() => void)[]> = {};
  const c = {
    object: camera,
    target: new Vector3(),
    enabled: true,
    update: () => c.fire('change'),
    dispose: () => undefined,
    addEventListener: (t: string, cb: () => void) => {
      (listeners[t] ??= []).push(cb);
    },
    listenToKeyEvents: () => undefined,
    fire: (t: string) => (listeners[t] ?? []).forEach((cb) => cb())
  };
  return c as unknown as ControlsLike & { fire(t: string): void };
}

function rig(options: ModelViewerOptions = {}, opts: { capture?: boolean } = {}) {
  const canvas = document.createElement('canvas');
  const renders: Render[] = [];
  let scene: Scene | null = null;
  let camera: Camera | null = null;
  const gl: GLRendererLike = {
    render: (s, c) => {
      scene = s;
      camera = c;
      renders.push({
        background: s.background,
        target: currentTarget,
        plateVisible: s.getObjectByName('buildVolume')?.visible ?? null
      });
    },
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas,
    ...(opts.capture
      ? {
          setRenderTarget: (t: unknown) => {
            currentTarget = t;
          },
          readRenderTargetPixels: () => undefined
        }
      : {})
  };
  let currentTarget: unknown = null;
  let controls: ReturnType<typeof stubControls> | null = null;
  const viewer = createModelViewer(canvas, {
    createRenderer: () => gl,
    createControls: (cam) => (controls = stubControls(cam)),
    ...options
  });
  return {
    viewer,
    canvas,
    renders,
    controls: () => controls!,
    scene: () => scene!,
    camera: () => camera as unknown as PerspectiveCamera
  };
}

const plateOf = (s: Scene): Object3D | undefined => s.getObjectByName('buildVolume');
const shadowOf = (s: Scene): Mesh | undefined => s.getObjectByName('contactShadow') as Mesh | undefined;
const under = (o: Object3D, name: string): boolean => {
  for (let p: Object3D | null = o; p !== null; p = p.parent) if (p.name === name) return true;
  return false;
};

/** The model's mesh (not the plate's surface/shadow). */
function modelMesh(s: Scene): Mesh {
  let found: Mesh | null = null;
  s.traverse((o) => {
    if ((o as Mesh).isMesh && !under(o, 'modelPlate') && found === null) found = o as Mesh;
  });
  if (found === null) throw new Error('no model mesh');
  return found;
}

/** World-space (printer coords, Z-up) bounds of the drawn model mesh. */
function drawnBounds(s: Scene): { min: number[]; max: number[] } {
  s.updateMatrixWorld(true);
  const m = modelMesh(s);
  const pos = m.geometry.getAttribute('position');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    const p = [v.x, -v.z, v.y]; // scene Y-up → printer Z-up
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[a]);
      max[a] = Math.max(max[a], p[a]);
    }
  }
  return { min, max };
}

function expectBounds(got: { min: number[]; max: number[] }, want: { min: number[]; max: number[] }): void {
  for (let a = 0; a < 3; a++) {
    expect(got.min[a]).toBeCloseTo(want.min[a], 6);
    expect(got.max[a]).toBeCloseTo(want.max[a], 6);
  }
}

/** Max |NDC| of the 8 corners of a printer-space box through the live camera (≤ 1 ⇒ fully on screen). */
function ndcMax(camera: PerspectiveCamera, b: { min: number[]; max: number[] }): number {
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  let worst = 0;
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? b.max[0] : b.min[0];
    const y = i & 2 ? b.max[1] : b.min[1];
    const z = i & 4 ? b.max[2] : b.min[2];
    const p = new Vector3(x, z, -y).project(camera);
    worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y));
  }
  return worst;
}

const settingsEntry = (obj: unknown) => ({ name: 'Metadata/project_settings.config', data: enc(JSON.stringify(obj)) });
const BED256 = { printable_area: ['0x0', '256x0', '256x256', '0x256'] };
const zip3mf = (model: string, ...extra: { name: string; data: Uint8Array }[]) => ({
  kind: '3mf' as const,
  bytes: makeZip([{ name: '3D/3dmodel.model', data: enc(model) }, ...extra])
});

function stlScene(): ModelScene {
  // A CCW triangle (0,0,0)-(10,0,0)-(0,10,0) plus an apex, bounds 0..10 × 0..10 × 0..5.
  return {
    objects: [
      {
        id: 'stl',
        geometry: {
          positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 5]),
          indices: new Uint32Array([0, 1, 2, 0, 1, 3])
        },
        transform: IDENTITY_MAT4
      }
    ],
    bounds: { min: [0, 0, 0], max: [10, 10, 5] },
    capabilities: {
      materials: 'unavailable',
      transforms: 'unavailable',
      multiObject: 'unavailable',
      instanced: 'unavailable',
      plates: 'unavailable'
    }
  };
}

const BED = { x: 256, y: 256, z: 256 };

describe('model viewer plate — no buildVolume is exactly today', () => {
  it('draws no plate, leaves the model where authored, reports null placement', async () => {
    const r = rig();
    r.viewer.resize(800, 600);
    const info = await r.viewer.setSource(stlScene());
    expect(plateOf(r.scene())).toBeUndefined();
    expect(shadowOf(r.scene())).toBeUndefined();
    expect(r.scene().getObjectByName('modelPlate')!.children.length).toBe(0);
    expectBounds(drawnBounds(r.scene()), { min: [0, 0, 0], max: [10, 10, 5] });
    expect(info.placement).toBeNull();
    expect(info.placementOffset).toBeNull();
    expect(r.viewer.getPlacement()).toEqual({ placement: null, placementOffset: null });
    expect(r.scene().background).toBeNull();
  });
});

describe('model viewer plate — placement fixtures (offset, drawn position, framed view)', () => {
  async function load(source: Parameters<ModelViewer['setSource']>[0], extra: ModelViewerOptions = {}) {
    const r = rig({ buildVolume: BED, ...extra });
    r.viewer.resize(800, 600);
    const info = await r.viewer.setSource(source);
    return { r, info };
  }

  function expectPresented(r: ReturnType<typeof rig>, authored: { min: number[]; max: number[] }, off: number[]) {
    const presented = {
      min: authored.min.map((v, i) => v + off[i]),
      max: authored.max.map((v, i) => v + off[i])
    };
    const drawn = drawnBounds(r.scene());
    for (let a = 0; a < 3; a++) {
      expect(drawn.min[a]).toBeCloseTo(presented.min[a], 4);
      expect(drawn.max[a]).toBeCloseTo(presented.max[a], 4);
    }
    // The framed view contains the drawn part, and is tight (not framing the authored origin).
    const e = ndcMax(r.camera(), presented);
    expect(e).toBeLessThanOrEqual(1);
    expect(e).toBeGreaterThan(0.8);
  }

  it('known: a Bambu/Orca plate-1 part on the bed is drawn where authored', async () => {
    const { r, info } = await load(zip3mf(singleObjectModel('100 100 0'), settingsEntry(BED256)));
    expect(info.placement).toBe('known');
    expect(info.placementOffset).toEqual({ x: 0, y: 0, z: 0 });
    expect(info.bounds).toEqual({ min: [100, 100, 0], max: [110, 110, 5] }); // authored
    expect(plateOf(r.scene())).toBeDefined();
    expectPresented(r, info.bounds as never, [0, 0, 0]);
  });

  it('inferred: plate 2 of a two-plate project (scope {plateId:2}) has one workspace cell subtracted', async () => {
    const { r, info } = await load(
      zip3mf(TWO_PLATE_MODEL, settingsEntry(BED256), {
        name: 'Metadata/model_settings.config',
        data: enc(TWO_PLATE_SETTINGS)
      }),
      { renderScope: { plateId: 2 } }
    );
    expect(info.placement).toBe('inferred');
    expect(info.placementOffset!.x).toBeCloseTo(-307.2, 4);
    expect(info.placementOffset!.y).toBe(0);
    expect(info.placementOffset!.z).toBe(0);
    // `info.bounds` is the whole source (authored); the drawn part is plate 2 moved onto the bed.
    expectPresented(r, { min: [435.2, 128, 0], max: [445.2, 138, 5] }, [-307.2, 0, 0]);
  });

  it('inferred, negative multiple: a part one cell BELOW the bed (−Y) is pulled up onto it', async () => {
    const s: ModelScene = {
      ...stlScene(),
      bounds: { min: [100, -207.2, 0], max: [110, -197.2, 5] },
      source: { slicerProject: 'bambu-orca' }
    };
    s.objects[0] = { ...s.objects[0], transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 100, -207.2, 0, 1] };
    const { r, info } = await load(s);
    expect(info.placement).toBe('inferred');
    expect(info.placementOffset!.x).toBe(0);
    expect(info.placementOffset!.y).toBeCloseTo(307.2, 4);
    expectPresented(r, { min: [100, -207.2, 0], max: [110, -197.2, 5] }, [0, 307.2, 0]);
  });

  it('approximated: a CAD 3MF centred on the origin, below z = 0, is centred on the bed and dropped to z = 0', async () => {
    const { r, info } = await load(zip3mf(singleObjectModel('0 0 -3')));
    expect(info.placement).toBe('approximated');
    expect(info.placementOffset).toEqual({ x: 123, y: 123, z: 3 });
    expect(info.bounds).toEqual({ min: [0, 0, -3], max: [10, 10, 2] });
    expectPresented(r, info.bounds as never, [123, 123, 3]);
  });

  it('approximated: an STL is centred on the bed; bounds stay authored', async () => {
    const { r, info } = await load(stlScene());
    expect(info.placement).toBe('approximated');
    expect(info.placementOffset).toEqual({ x: 123, y: 123, z: 0 });
    expect(info.bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 5] });
    expectPresented(r, info.bounds as never, [123, 123, 0]);
  });

  it('a Bambu/Orca file whose footprint matches neither check is approximated, not guessed', async () => {
    // Far off the bed AND not a whole workspace cell: no honest inference.
    const { info } = await load(zip3mf(singleObjectModel('270 100 0'), settingsEntry(BED256)));
    expect(info.placement).toBe('approximated');
  });

  it('null: a multi-plate project with no scope draws no plate (one bed would misrepresent it)', async () => {
    const { r, info } = await load(
      zip3mf(TWO_PLATE_MODEL, settingsEntry(BED256), {
        name: 'Metadata/model_settings.config',
        data: enc(TWO_PLATE_SETTINGS)
      })
    );
    expect(info.placement).toBeNull();
    expect(info.placementOffset).toBeNull();
    expect(plateOf(r.scene())).toBeUndefined();
    expect(shadowOf(r.scene())).toBeUndefined();
    // Nothing moved: the model root is at the origin and the placements are the authored ones.
    const mesh = modelMesh(r.scene()) as unknown as InstancedMesh;
    expect(mesh.parent!.position.toArray()).toEqual([0, 0, 0]);
    const m = new Matrix4();
    mesh.getMatrixAt(0, m);
    expect(m.elements[12]).toBe(128);
    mesh.getMatrixAt(1, m);
    expect(m.elements[12]).toBeCloseTo(435.2, 4);
  });

  it('a {plateId} scope naming a plate that does not exist draws no plate — never a guess', async () => {
    const { r, info } = await load(
      zip3mf(TWO_PLATE_MODEL, settingsEntry(BED256), {
        name: 'Metadata/model_settings.config',
        data: enc(TWO_PLATE_SETTINGS)
      }),
      { renderScope: { plateId: 9 } }
    );
    expect(info.placement).toBeNull();
    expect(r.viewer.getPlacement().placement).toBeNull();
    expect(plateOf(r.scene())).toBeUndefined();
  });

  it('setRenderScope re-places: plate 1 → known, plate 2 → inferred, unscoped → none', async () => {
    const { r } = await load(
      zip3mf(TWO_PLATE_MODEL, settingsEntry(BED256), {
        name: 'Metadata/model_settings.config',
        data: enc(TWO_PLATE_SETTINGS)
      })
    );
    r.viewer.setRenderScope({ plateId: 1 });
    expect(r.viewer.getPlacement().placement).toBe('known');
    r.viewer.setRenderScope({ plateId: 2 });
    expect(r.viewer.getPlacement().placement).toBe('inferred');
    r.viewer.setRenderScope(null);
    expect(r.viewer.getPlacement().placement).toBeNull();
  });

  it('presentation moves the model root only: the scene data stays authored and picking maps through it', async () => {
    const { r, info } = await load(stlScene());
    r.scene().updateMatrixWorld(true);
    // Ray straight down at the DRAWN spot (printer 125,125 = authored 2,2 + offset 123,123).
    const ray = new Raycaster(new Vector3(125, 100, -125), new Vector3(0, -1, 0));
    const hits = ray.intersectObject(modelMesh(r.scene()), false);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].point.x).toBeCloseTo(125, 4);
    expect(hits[0].point.z).toBeCloseTo(-125, 4);
    expect(hits[0].point.y).toBeCloseTo(0, 4);
    // ... and a ray at the AUTHORED spot misses (the part is not there any more).
    expect(
      new Raycaster(new Vector3(2, 100, -2), new Vector3(0, -1, 0)).intersectObject(modelMesh(r.scene()), false)
    ).toHaveLength(0);
    // The mesh's own matrix and the ready bounds are untouched (DD-025 D3).
    expect(modelMesh(r.scene()).matrix.elements[12]).toBe(0);
    expect(info.bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 5] });
  });

  it('auto-frame-on-resize and Reset view frame the PRESENTED part, not the authored origin', async () => {
    const { r } = await load(stlScene());
    const presented = { min: [123, 123, 0], max: [133, 133, 5] };
    r.viewer.resize(375, 700);
    expect(ndcMax(r.camera(), presented)).toBeLessThanOrEqual(1);
    expect(ndcMax(r.camera(), presented)).toBeGreaterThan(0.8);
    r.viewer.frame();
    expect(ndcMax(r.camera(), presented)).toBeLessThanOrEqual(1);
    expect(ndcMax(r.camera(), presented)).toBeGreaterThan(0.8);
  });

  it('setBuildVolume re-places (a new bed ⇒ a new offset), re-fits while auto-framing, and null removes the plate', async () => {
    const r = rig();
    r.viewer.resize(800, 600);
    await r.viewer.setSource(stlScene());
    r.viewer.setBuildVolume({ x: 100, y: 100, z: 100 });
    expect(r.viewer.getPlacement()).toEqual({ placement: 'approximated', placementOffset: { x: 45, y: 45, z: 0 } });
    expect(ndcMax(r.camera(), { min: [45, 45, 0], max: [55, 55, 5] })).toBeGreaterThan(0.8);
    expect(ndcMax(r.camera(), { min: [45, 45, 0], max: [55, 55, 5] })).toBeLessThanOrEqual(1);
    r.viewer.setBuildVolume(null);
    expect(r.viewer.getPlacement()).toEqual({ placement: null, placementOffset: null });
    expect(plateOf(r.scene())).toBeUndefined();
    expectBounds(drawnBounds(r.scene()), { min: [0, 0, 0], max: [10, 10, 5] });
  });
});

describe('model viewer plate — the contact shadow follows the presented footprint', () => {
  it('sits under the presented part (not the authored origin) and is a child of the plate', async () => {
    const r = rig({ buildVolume: BED, theme: studioTheme('dark') });
    await r.viewer.setSource(stlScene());
    const shadow = shadowOf(r.scene())!;
    expect(shadow).toBeDefined();
    expect(shadow.parent).toBe(plateOf(r.scene()));
    shadow.geometry.computeBoundingBox();
    const c = new Vector3();
    shadow.geometry.boundingBox!.getCenter(c);
    expect(c.x).toBeCloseTo(128, 4); // presented footprint centre (123..133)
    expect(c.y).toBeCloseTo(128, 4);
    const size = new Vector3();
    shadow.geometry.boundingBox!.getSize(size);
    expect(size.x).toBeCloseTo(14, 4); // 10 mm footprint × 1.4 spread
  });

  it('is absent with no plate, and without a contactShadow in the theme', async () => {
    const a = rig({ theme: studioTheme('dark') });
    await a.viewer.setSource(stlScene());
    expect(shadowOf(a.scene())).toBeUndefined();
    const b = rig({ buildVolume: BED });
    await b.viewer.setSource(stlScene());
    expect(plateOf(b.scene())).toBeDefined();
    expect(shadowOf(b.scene())).toBeUndefined();
  });
});

describe('model viewer plate — capture({ includeBuildVolume: false })', () => {
  const cutout = { background: 'transparent' as const, includeBuildVolume: false };

  it('hides the plate and its shadow for the capture render only, then restores them', async () => {
    const r = rig({ buildVolume: BED, theme: studioTheme('dark') }, { capture: true });
    r.viewer.resize(400, 300);
    await r.viewer.setSource(stlScene());
    const before = r.renders.length;
    await r.viewer.capture(cutout).catch(() => undefined); // encoding needs a real 2D canvas; the render has happened
    const captureRenders = r.renders.slice(before).filter((x) => x.target !== null);
    expect(captureRenders).toHaveLength(1);
    expect(captureRenders[0].plateVisible).toBe(false); // the shadow is the plate's child, so it is hidden with it
    expect(captureRenders[0].background).toBeNull(); // transparent cutout: no gradient either
    expect(plateOf(r.scene())!.visible).toBe(true);
    expect(r.scene().background).not.toBeNull(); // the live gradient is back
  });

  it('keeps the plate in a default capture', async () => {
    const r = rig({ buildVolume: BED, theme: studioTheme('dark') }, { capture: true });
    r.viewer.resize(400, 300);
    await r.viewer.setSource(stlScene());
    const before = r.renders.length;
    await r.viewer.capture({ background: 'transparent' }).catch(() => undefined);
    const cap = r.renders.slice(before).find((x) => x.target !== null)!;
    expect(cap.plateVisible).toBe(true);
  });

  it('restores the plate even when the capture fails, and ignores the flag when there is no plate', async () => {
    const r = rig({ buildVolume: BED }); // stub GL cannot render-to-target → CaptureUnsupportedError
    await r.viewer.setSource(stlScene());
    await expect(r.viewer.capture(cutout)).rejects.toMatchObject({ code: 'E_CAPTURE_UNSUPPORTED' });
    expect(plateOf(r.scene())!.visible).toBe(true);
    const plain = rig({}, { capture: true });
    await plain.viewer.setSource(stlScene());
    await plain.viewer.capture(cutout).catch(() => undefined); // nothing to hide, nothing to throw
  });
});

describe('model viewer plate — model lighting is unchanged by a theme', () => {
  function lights(s: Scene) {
    const out: unknown[] = [];
    s.traverse((o) => {
      if (o instanceof HemisphereLight) out.push(['hemi', o.color.getHex(), o.groundColor.getHex(), o.intensity]);
      if (o instanceof DirectionalLight) out.push(['dir', o.color.getHex(), o.intensity, o.position.toArray()]);
    });
    return out;
  }

  it.each(['dark', 'light'] as const)('studioTheme(%s) leaves the rig exactly as the default', async (mode) => {
    const plain = rig({ buildVolume: BED });
    await plain.viewer.setSource(stlScene());
    const baseline = lights(plain.scene());
    expect(baseline).toEqual([
      ['hemi', 0xffffff, 0x9098a5, 2.0],
      ['dir', 0xffffff, 1.6, [0.6, 1, 0.8]],
      ['dir', 0xffffff, 0.5, [-0.7, 0.3, -0.5]]
    ]);
    const r = rig({ buildVolume: BED, theme: studioTheme(mode) });
    await r.viewer.setSource(stlScene());
    expect(lights(r.scene())).toEqual(baseline);
    r.viewer.setTheme({
      ...studioTheme(mode),
      hemisphereIntensity: 9,
      directionalIntensity: 9,
      materialPreset: 'glossy'
    });
    expect(lights(r.scene())).toEqual(baseline);
  });
});

describe('model viewer — background precedence: capture > theme.background > background/setBackground > transparent', () => {
  const hex = (b: Scene['background']): number | string =>
    b instanceof Color ? b.getHex() : b === null ? 'null' : b.constructor.name;

  it('transparent by default; the background option is the fallback', () => {
    const a = rig();
    a.viewer.resize(10, 10);
    expect(hex(a.scene().background)).toBe('null');
    const b = rig({ background: '#ff0000' });
    b.viewer.resize(10, 10);
    expect(hex(b.scene().background)).toBe(0xff0000);
  });

  it('theme.background (solid and gradient) beats background; setBackground is then the fallback tier', async () => {
    const r = rig({ background: '#ff0000', theme: { background: '#00ff00' } });
    r.viewer.resize(10, 10);
    expect(hex(r.scene().background)).toBe(0x00ff00);
    r.viewer.setBackground('#0000ff'); // no visible effect while the theme sets a background
    expect(hex(r.scene().background)).toBe(0x00ff00);
    r.viewer.setTheme(studioTheme('dark')); // gradient
    expect(hex(r.scene().background)).toBe('DataTexture');
    r.viewer.setTheme({ ...studioTheme('dark'), background: null }); // null = omit → falls to the fallback
    expect(hex(r.scene().background)).toBe(0x0000ff);
    r.viewer.setBackground('transparent');
    expect(hex(r.scene().background)).toBe('null');
  });

  it('capture({ background }) beats everything and the live background returns', async () => {
    const r = rig({ buildVolume: BED, theme: studioTheme('dark') }, { capture: true });
    r.viewer.resize(40, 30);
    await r.viewer.setSource(stlScene());
    const before = r.renders.length;
    await r.viewer.capture({ background: '#123456' }).catch(() => undefined);
    const cap = r.renders.slice(before).find((x) => x.target !== null)!;
    expect(hex(cap.background)).toBe(0x123456);
    expect(hex(r.scene().background)).toBe('DataTexture');
  });

  it('the documented cutout recipe { ...studioTheme, background: null } is transparent with the plate kept', async () => {
    const r = rig({ buildVolume: BED, theme: { ...studioTheme('light'), background: null } });
    await r.viewer.setSource(stlScene());
    expect(r.scene().background).toBeNull();
    expect(plateOf(r.scene())).toBeDefined();
  });
});

/** Every geometry/material/map under `root`, plus the scene background texture, with dispose tracking. */
function trackDisposables(scene: Scene) {
  const disposed = new Set<object>();
  const all = new Set<object>();
  const add = (o: { addEventListener: (t: 'dispose', cb: () => void) => void }): void => {
    if (all.has(o)) return;
    all.add(o);
    o.addEventListener('dispose', () => disposed.add(o));
  };
  scene.getObjectByName('modelPlate')!.traverse((obj) => {
    const m = obj as Mesh;
    if (m.geometry) add(m.geometry);
    const mats = m.material === undefined ? [] : Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) {
      add(mat);
      const map = (mat as { map?: { addEventListener: never } | null }).map;
      if (map) add(map as never);
    }
  });
  if (scene.background && !(scene.background instanceof Color)) add(scene.background as never);
  return { all, disposed, undisposed: () => [...all].filter((o) => !disposed.has(o)) };
}

function texturedStudio() {
  const tex = document.createElement('canvas');
  tex.width = 4;
  tex.height = 4;
  const t = studioTheme('dark');
  return { ...t, bedSurface: { ...t.bedSurface!, texture: tex } };
}

describe('model viewer plate — leak matrix (textured slab + shadow + gradient)', () => {
  async function loaded() {
    const r = rig({ buildVolume: BED, theme: texturedStudio() });
    r.viewer.resize(200, 150);
    await r.viewer.setSource(stlScene());
    return r;
  }

  it('the textured studio plate really has a map, a shadow map, a gradient and a slab to leak', async () => {
    const r = await loaded();
    const t = trackDisposables(r.scene());
    expect(shadowOf(r.scene())).toBeDefined();
    expect(t.all.size).toBeGreaterThanOrEqual(10); // geometries + materials + 2 maps + the backdrop
  });

  it('setTheme frees the previous plate, maps and gradient', async () => {
    const r = await loaded();
    const t = trackDisposables(r.scene());
    r.viewer.setTheme(studioTheme('light'));
    expect(t.undisposed()).toEqual([]);
    const t2 = trackDisposables(r.scene());
    r.viewer.setTheme(texturedStudio());
    expect(t2.undisposed()).toEqual([]);
  });

  it('setBuildVolume frees the previous plate; null frees it entirely', async () => {
    const r = await loaded();
    const t = trackDisposables(r.scene());
    const gradient = [...t.all].filter((o) => o.constructor.name === 'DataTexture');
    r.viewer.setBuildVolume({ x: 180, y: 180, z: 180 });
    const plateStuff = [...t.all].filter((o) => !gradient.includes(o));
    expect(plateStuff.every((o) => t.disposed.has(o))).toBe(true);
    const t2 = trackDisposables(r.scene());
    r.viewer.setBuildVolume(null);
    expect([...t2.all].filter((o) => !t2.disposed.has(o) && !gradient.includes(o))).toEqual([]);
    expect(plateOf(r.scene())).toBeUndefined();
  });

  it('dispose frees the plate, shadow, maps and gradient', async () => {
    const r = await loaded();
    const t = trackDisposables(r.scene());
    r.viewer.dispose();
    expect(t.undisposed()).toEqual([]);
    expect(r.scene().getObjectByName('modelPlate')).toBeUndefined();
  });

  it('a context-loss restore rebuilds the plate and frees the old one', async () => {
    const r = await loaded();
    const t = trackDisposables(r.scene());
    const oldPlate = plateOf(r.scene());
    r.canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    r.canvas.dispatchEvent(new Event('webglcontextrestored'));
    const newPlate = plateOf(r.scene());
    expect(newPlate).toBeDefined();
    expect(newPlate).not.toBe(oldPlate);
    const gradient = [...t.all].filter((o) => o.constructor.name === 'DataTexture' && !t.disposed.has(o));
    // Everything the old plate owned is freed; the (CPU-side) gradient is still the live background.
    expect([...t.all].filter((o) => !t.disposed.has(o) && !gradient.includes(o))).toEqual([]);
    expect(shadowOf(r.scene())).toBeDefined();
    expect(drawnBounds(r.scene()).min[0]).toBeCloseTo(123, 4);
  });
});

describe('model viewer lens (cameraFov)', () => {
  it('rejects an out-of-range lens synchronously (option, setter), never clamping', () => {
    expect(() => rig({ cameraFov: 9.9 })).toThrow(RangeError);
    expect(() => rig({ cameraFov: 120.1 })).toThrow(RangeError);
    expect(() => rig({ cameraFov: NaN })).toThrow(RangeError);
    const r = rig();
    expect(() => r.viewer.setCameraFov(5)).toThrow(RangeError);
    expect(() => r.viewer.setCameraFov(10)).not.toThrow(); // inclusive
    expect(() => r.viewer.setCameraFov(120)).not.toThrow();
  });

  it.each([10, 32, 120])('the framed part stays inside the view at %s°', async (fov) => {
    const r = rig({ buildVolume: BED, cameraFov: fov });
    r.viewer.resize(800, 600);
    await r.viewer.setSource(stlScene());
    expect(r.camera().fov).toBe(fov);
    const e = ndcMax(r.camera(), { min: [123, 123, 0], max: [133, 133, 5] });
    expect(e).toBeLessThanOrEqual(1);
    expect(e).toBeGreaterThan(0.8);
  });

  it('setCameraFov while auto-framing re-fits exactly (equal to a fresh frame at that lens) and emits no camera-changed', async () => {
    const r = rig({ buildVolume: BED });
    r.viewer.resize(800, 600);
    await r.viewer.setSource(stlScene());
    const events: string[] = [];
    r.viewer.onEvent((e) => events.push(e.type));
    r.viewer.setCameraFov(32);
    const fresh = rig({ buildVolume: BED, cameraFov: 32 });
    fresh.viewer.resize(800, 600);
    await fresh.viewer.setSource(stlScene());
    const a = r.viewer.getCameraState()!;
    const b = fresh.viewer.getCameraState()!;
    for (const k of ['x', 'y', 'z'] as const) expect(a.position[k]).toBeCloseTo(b.position[k], 4);
    expect(events).not.toContain('camera-changed');
    // Auto-framing stays on: a resize still re-fits.
    r.viewer.resize(375, 700);
    expect(ndcMax(r.camera(), { min: [123, 123, 0], max: [133, 133, 5] })).toBeLessThanOrEqual(1);
  });

  it('after a user gesture the lens dollies (keeps the user view) instead of re-fitting', async () => {
    const r = rig({ buildVolume: BED });
    r.viewer.resize(800, 600);
    await r.viewer.setSource(stlScene());
    r.controls().fire('change');
    const before = r.viewer.getCameraState()!;
    r.viewer.setCameraFov(32);
    const after = r.viewer.getCameraState()!;
    expect(after.target).toEqual(before.target);
    expect(after.position).not.toEqual(before.position);
  });
});

describe('model preview controller — plate state, options and remembered look', () => {
  function sized(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, get: () => 600 });
    return canvas;
  }
  function ctl(options: Parameters<typeof createModelPreviewController>[0] = {}) {
    let scene: Scene | null = null;
    let camera: Camera | null = null;
    const c = createModelPreviewController({
      createRenderer: (canvas) => ({
        render: (s, cam) => {
          scene = s;
          camera = cam;
        },
        setSize: () => undefined,
        dispose: () => undefined,
        domElement: canvas
      }),
      createControls: (cam) => stubControls(cam as PerspectiveCamera),
      ...options
    });
    return { c, scene: () => scene!, camera: () => camera as unknown as PerspectiveCamera };
  }

  it('state carries placement / placementOffset, from ready and from later setters', async () => {
    const { c } = ctl({ buildVolume: BED });
    expect(c.getState().placement).toBeNull();
    c.bindCanvas(sized());
    await c.controls.setSource(stlScene());
    expect(c.getState().placement).toBe('approximated');
    expect(c.getState().placementOffset).toEqual({ x: 123, y: 123, z: 0 });
    expect(c.getState().bounds).toEqual({ min: [0, 0, 0], max: [10, 10, 5] });
    const seen: unknown[] = [];
    c.onStateChange((s) => seen.push(s.placementOffset));
    c.controls.setBuildVolume({ x: 100, y: 100, z: 50 });
    expect(c.getState().placementOffset).toEqual({ x: 45, y: 45, z: 0 });
    expect(seen).toHaveLength(1);
    c.controls.setBuildVolume({ x: 100, y: 100, z: 50 }); // unchanged placement → no extra state emission
    expect(seen).toHaveLength(1);
    c.controls.setBuildVolume(null);
    expect(c.getState().placement).toBeNull();
    expect(c.getState().placementOffset).toBeNull();
    c.dispose();
  });

  it('setRenderScope refreshes placement in state', async () => {
    const { c } = ctl({ buildVolume: BED });
    c.bindCanvas(sized());
    await c.controls.setSource(
      zip3mf(TWO_PLATE_MODEL, settingsEntry(BED256), {
        name: 'Metadata/model_settings.config',
        data: enc(TWO_PLATE_SETTINGS)
      })
    );
    expect(c.getState().placement).toBeNull(); // unscoped multi-plate
    c.controls.setRenderScope({ plateId: 2 });
    expect(c.getState().placement).toBe('inferred');
    c.dispose();
  });

  it('setCameraFov / setTheme throw RangeError synchronously even before a canvas binds; options validate at creation', () => {
    const { c } = ctl();
    expect(() => c.controls.setCameraFov(9)).toThrow(RangeError);
    expect(() => c.controls.setCameraFov(121)).toThrow(RangeError);
    expect(() => c.controls.setTheme({ gridMajor: { every: 0, opacity: 0.5 } })).toThrow(RangeError);
    expect(() => c.controls.setTheme({ contactShadow: { opacity: 1.5 } })).toThrow(RangeError);
    expect(() => createModelPreviewController({ cameraFov: 200 })).toThrow(RangeError);
    expect(() => createModelPreviewController({ theme: { gridOpacity: -1 } })).toThrow(RangeError);
    c.dispose();
  });

  it('remembers the lens, theme and plate across a canvas rebind (set before bind, and set live)', async () => {
    const { c, scene, camera } = ctl();
    c.controls.setCameraFov(32); // before any canvas
    c.controls.setTheme(studioTheme('dark'));
    c.controls.setBuildVolume(BED);
    c.bindCanvas(sized());
    await c.controls.setSource(stlScene());
    expect(camera().fov).toBe(32);
    expect(scene().background?.constructor.name).toBe('DataTexture');
    expect(plateOf(scene())).toBeDefined();
    c.controls.setCameraFov(60); // live, then the canvas is replaced
    c.controls.setTheme(studioTheme('light'));
    c.bindCanvas(sized());
    await new Promise((r) => setTimeout(r, 0));
    await c.controls.setSource(stlScene());
    expect(camera().fov).toBe(60);
    expect(plateOf(scene())).toBeDefined();
    c.dispose();
  });
});
