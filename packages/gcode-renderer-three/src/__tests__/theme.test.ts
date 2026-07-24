// @vitest-environment happy-dom
/**
 * Bounded declarative theming (#153, DD-009 D4). Defaults reproduce the current
 * look exactly; a theme option / setTheme restyles lights, background, the build
 * volume, and the tube material preset without disturbing draw ranges. Semantic
 * colors (origin tripod) stay fixed. Stub GL + manual scheduler.
 */
import { describe, expect, it } from 'vitest';
import { DirectionalLight, HemisphereLight, Mesh, MeshLambertMaterial, MeshStandardMaterial } from 'three';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import { ToolpathRenderer, type GLRendererLike, type Theme } from '../index.js';

function makeIR(): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  for (let s = 0; s < 6; s++) {
    b.addSegment({
      x0: 10 + s,
      y0: 10,
      z0: 0.2,
      x1: 11 + s,
      y1: 10,
      z1: 0.2,
      e: 1,
      kind: MoveKind.Extrude,
      layer: 0,
      srcByte: s * 10
    });
  }
  return b.finalize();
}

function makeRenderer(theme?: Theme) {
  const canvas = document.createElement('canvas');
  const stub: GLRendererLike = {
    render: () => undefined,
    setSize: () => undefined,
    dispose: () => undefined,
    domElement: canvas
  };
  const ticks: (() => void)[] = [];
  const renderer = new ToolpathRenderer({
    canvas,
    chunksPerTick: 8,
    quality: 'tubes',
    buildVolume: { x: 100, y: 100, z: 100 },
    ...(theme ? { theme } : {}),
    createRenderer: () => stub,
    scheduleFrame: (cb) => ticks.push(cb)
  });
  return {
    renderer,
    runTicks: () => {
      while (ticks.length > 0) ticks.shift()?.();
    }
  };
}

type Internals = {
  scene: { background: { getHex(): number } | null };
  hemiLight: HemisphereLight;
  dirLight: DirectionalLight;
  volumeGroup: { children: { material: { color: { getHex(): number } } }[] };
};
const peek = (r: ToolpathRenderer): Internals => r as unknown as Internals;

/** The extrude (tube) Mesh among the built chunks. */
function tubeMesh(r: ToolpathRenderer): Mesh {
  const mesh = r.chunkMeshes.find((m) => m.userData.vertexSegment !== undefined);
  if (!(mesh instanceof Mesh)) throw new Error('expected a tube Mesh');
  return mesh;
}

describe('theming (#153)', () => {
  it('defaults reproduce the current look', () => {
    const { renderer, runTicks } = makeRenderer();
    renderer.setIR(makeIR());
    runTicks();
    const p = peek(renderer);
    expect(p.hemiLight.intensity).toBe(1.6);
    expect(p.dirLight.intensity).toBe(1.1);
    expect(p.scene.background).toBeNull(); // never set today
    expect(p.volumeGroup.children[0].material.color.getHex()).toBe(0x448844); // grid
    expect(p.volumeGroup.children[1].material.color.getHex()).toBe(0x888888); // box/bed
    expect(tubeMesh(renderer).material).toBeInstanceOf(MeshLambertMaterial);
    renderer.dispose();
  });

  it('honors a theme option at construction', () => {
    const { renderer, runTicks } = makeRenderer({
      background: 0x101018,
      gridColor: 0x223344,
      bedColor: 0x334455,
      hemisphereIntensity: 3,
      directionalIntensity: 2,
      materialPreset: 'glossy'
    });
    renderer.setIR(makeIR());
    runTicks();
    const p = peek(renderer);
    expect(p.hemiLight.intensity).toBe(3);
    expect(p.dirLight.intensity).toBe(2);
    expect(p.scene.background?.getHex()).toBe(0x101018);
    expect(p.volumeGroup.children[0].material.color.getHex()).toBe(0x223344);
    expect(p.volumeGroup.children[1].material.color.getHex()).toBe(0x334455);
    expect(tubeMesh(renderer).material).toBeInstanceOf(MeshStandardMaterial);
    renderer.dispose();
  });

  it('setTheme restyles live without disturbing draw ranges', () => {
    const { renderer, runTicks } = makeRenderer();
    renderer.setIR(makeIR());
    runTicks();
    const drawBefore = (tubeMesh(renderer).geometry as { drawRange: { count: number } }).drawRange.count;

    renderer.setTheme({
      background: '#202030',
      gridColor: 0xff00ff,
      hemisphereIntensity: 0.5,
      materialPreset: 'glossy'
    });
    const p = peek(renderer);
    expect(p.hemiLight.intensity).toBe(0.5);
    expect(p.scene.background?.getHex()).toBe(0x202030);
    expect(p.volumeGroup.children[0].material.color.getHex()).toBe(0xff00ff);
    expect(tubeMesh(renderer).material).toBeInstanceOf(MeshStandardMaterial);
    // Presentation-only: geometry draw range is untouched.
    expect((tubeMesh(renderer).geometry as { drawRange: { count: number } }).drawRange.count).toBe(drawBefore);
    renderer.dispose();
  });

  it('resets omitted fields to defaults (replace semantics) and keeps the origin tripod fixed', () => {
    const { renderer, runTicks } = makeRenderer({ gridColor: 0x123456, hemisphereIntensity: 4 });
    renderer.setIR(makeIR());
    runTicks();
    // setTheme with only a background: grid + intensity fall back to defaults.
    renderer.setTheme({ background: 0x000000 });
    const p = peek(renderer);
    expect(p.hemiLight.intensity).toBe(1.6); // reset to default
    expect(p.volumeGroup.children[0].material.color.getHex()).toBe(0x448844); // reset to default grid
    // Origin tripod (children[2..4]) stays the semantic RGB axes regardless of theme.
    expect(p.volumeGroup.children[2].material.color.getHex()).toBe(0xcc4444);
    renderer.dispose();
  });
});
