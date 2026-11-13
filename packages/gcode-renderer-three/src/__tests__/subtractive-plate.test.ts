// @vitest-environment happy-dom
/**
 * Files with no Extrude (CNC, laser, plotter) work at or below Z 0 (#580): the plate turns see-through and
 * the contact shadow is dropped. A file with any Extrude (FDM, or a laser-head printer's Extrude + Cut)
 * keeps the opaque plate and the shadow. MoveKind is a bit set: an extruding arc is stored as
 * Extrude | ArcSegment (33), and that still counts as extrusion.
 */
import { describe, expect, it } from 'vitest';
import { MoveKind, ToolpathIRBuilder, type ToolpathIR } from '@chestnutlabs/toolpath-core';
import type { Mesh, MeshBasicMaterial, Object3D } from 'three';
import { ToolpathRenderer, type GLRendererLike } from '../index.js';

const VOLUME = { x: 200, y: 100, z: 50 };
const THEME = {
  bedSurface: { mode: 'solid' as const, color: 0x222222, thickness: 4, edgeColor: 0x111111 },
  contactShadow: { opacity: 0.4 }
};

function ir(kinds: MoveKind[], z = -0.8): ToolpathIR {
  const b = new ToolpathIRBuilder({ parserVersion: 'test', units: 'mm', unitsSource: 'known' });
  kinds.forEach((kind, i) => {
    b.addSegment({
      x0: 10 + i * 10,
      y0: 10,
      z0: z,
      x1: 20 + i * 10,
      y1: 30,
      z1: z,
      e: (kind & MoveKind.Extrude) !== 0 ? 1 : 0,
      tool: 0,
      layer: 0,
      kind,
      srcByte: i * 10
    });
  });
  return b.finalize();
}

function make() {
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
    quality: 'lines',
    buildVolume: VOLUME,
    theme: THEME,
    createRenderer: () => stub,
    scheduleFrame: (cb) => ticks.push(cb)
  });
  const run = () => {
    while (ticks.length > 0) ticks.shift()?.();
  };
  const group = (): Object3D => renderer.scene.getObjectByName('buildVolume')!;
  const mat = (name: string) => (group().getObjectByName(name) as Mesh).material as MeshBasicMaterial;
  return { renderer, run, group, mat };
}

describe('subtractive plate look (#580)', () => {
  it('FDM (Extrude + Travel): opaque plate and slab, contact shadow present', () => {
    const { renderer, run, group, mat } = make();
    renderer.setIR(ir([MoveKind.Extrude, MoveKind.Travel], 0.2));
    run();
    expect([mat('bedSurface').opacity, mat('bedSurface').transparent]).toEqual([1, false]);
    expect([mat('bedSurfaceEdge').opacity, mat('bedSurfaceEdge').transparent]).toEqual([1, false]);
    expect(group().getObjectByName('contactShadow')).toBeDefined();
    renderer.dispose();
  });

  it('cut-only: plate and slab at opacity 0.35, transparent, no contact shadow', () => {
    const { renderer, run, group, mat } = make();
    renderer.setIR(ir([MoveKind.Cut, MoveKind.Cut]));
    run();
    expect([mat('bedSurface').opacity, mat('bedSurface').transparent]).toEqual([0.35, true]);
    expect([mat('bedSurfaceEdge').opacity, mat('bedSurfaceEdge').transparent]).toEqual([0.35, true]);
    expect(group().getObjectByName('contactShadow')).toBeUndefined();
    renderer.dispose();
  });

  it('Extrude + Cut (laser-head printer): unchanged, opaque plate and shadow', () => {
    const { renderer, run, group, mat } = make();
    renderer.setIR(ir([MoveKind.Cut, MoveKind.Extrude]));
    run();
    expect([mat('bedSurface').opacity, mat('bedSurface').transparent]).toEqual([1, false]);
    expect(group().getObjectByName('contactShadow')).toBeDefined();
    renderer.dispose();
  });

  it('an FDM file whose extrusions are all arcs (kinds [2, 33]) keeps the opaque plate and shadow', () => {
    const { renderer, run, group, mat } = make();
    renderer.setIR(ir([2 as MoveKind, 33 as MoveKind], 0.2)); // Travel, then Extrude | ArcSegment
    run();
    expect([mat('bedSurface').opacity, mat('bedSurface').transparent]).toEqual([1, false]);
    expect(group().getObjectByName('contactShadow')).toBeDefined();
    renderer.dispose();
  });

  it('a CNC file whose cuts are all arcs (kinds [2, 160]) gets the see-through plate and no shadow', () => {
    const { renderer, run, group, mat } = make();
    renderer.setIR(ir([2 as MoveKind, 160 as MoveKind])); // Travel, then Cut | ArcSegment
    run();
    expect([mat('bedSurface').opacity, mat('bedSurface').transparent]).toEqual([0.35, true]);
    expect(group().getObjectByName('contactShadow')).toBeUndefined();
    renderer.dispose();
  });

  it('an FDM file whose only extrusion is a seam move (kinds [2, 65]) keeps the opaque plate and shadow', () => {
    const { renderer, run, group, mat } = make();
    renderer.setIR(ir([2 as MoveKind, 65 as MoveKind], 0.2)); // Travel, then Extrude | Seam
    run();
    expect([mat('bedSurface').opacity, mat('bedSurface').transparent]).toEqual([1, false]);
    expect(group().getObjectByName('contactShadow')).toBeDefined();
    renderer.dispose();
  });

  it('keeps the grid and the depth settings that stop sorting artifacts', () => {
    const { renderer, run, group, mat } = make();
    renderer.setIR(ir([MoveKind.Cut]));
    run();
    expect(mat('bedSurface').depthWrite).toBe(false);
    expect((group().getObjectByName('bedSurface') as Mesh).renderOrder).toBe(-1);
    expect((group().getObjectByName('bedSurfaceEdge') as Mesh).renderOrder).toBe(-2);
    expect(group().children.some((c) => c.type === 'LineSegments' && c.visible)).toBe(true);
    renderer.dispose();
  });

  it('restores the opaque plate and shadow when an FDM file follows a CNC file', () => {
    const { renderer, run, group, mat } = make();
    renderer.setIR(ir([MoveKind.Cut]));
    run();
    renderer.setIR(ir([MoveKind.Extrude], 0.2));
    run();
    expect([mat('bedSurface').opacity, mat('bedSurface').transparent]).toEqual([1, false]);
    expect(group().getObjectByName('contactShadow')).toBeDefined();
    renderer.dispose();
  });

  it('a theme whose plate is already translucent comes back as [0.6, true] after CNC then FDM', () => {
    const { renderer, run, mat } = make();
    renderer.setTheme({ ...THEME, bedSurface: { ...THEME.bedSurface, opacity: 0.6 } });
    renderer.setIR(ir([MoveKind.Cut]));
    run();
    expect([mat('bedSurface').opacity, mat('bedSurface').transparent]).toEqual([0.35, true]);
    renderer.setIR(ir([MoveKind.Extrude], 0.2));
    run();
    expect([mat('bedSurface').opacity, mat('bedSurface').transparent]).toEqual([0.6, true]);
    renderer.dispose();
  });

  it('asks three to recompile the plate material only when `transparent` actually flips', () => {
    const { renderer, run, mat } = make();
    renderer.setIR(ir([MoveKind.Extrude], 0.2));
    run();
    const v0 = mat('bedSurface').version;
    renderer.setIR(ir([MoveKind.Cut]));
    run();
    expect(mat('bedSurface').version).toBe(v0 + 1); // opaque -> see-through
    renderer.setIR(ir([MoveKind.Cut, MoveKind.Cut]));
    run();
    expect(mat('bedSurface').version).toBe(v0 + 1); // still see-through: no recompile
    renderer.setIR(ir([MoveKind.Extrude], 0.2));
    run();
    expect(mat('bedSurface').version).toBe(v0 + 2); // back to opaque
    renderer.dispose();
  });

  it('survives a theme change: the rebuilt plate is see-through again for a cut-only file', () => {
    const { renderer, run, group, mat } = make();
    renderer.setIR(ir([MoveKind.Cut]));
    run();
    renderer.setTheme({ ...THEME, bedSurface: { ...THEME.bedSurface, opacity: 0.8 } });
    expect(mat('bedSurface').opacity).toBe(0.35);
    expect(group().getObjectByName('contactShadow')).toBeUndefined();
    renderer.setTheme({ ...THEME, bedSurface: { ...THEME.bedSurface, opacity: 0.2 } });
    expect(mat('bedSurface').opacity).toBe(0.2); // never made MORE opaque than the theme
    renderer.dispose();
  });

  it('an empty IR keeps the opaque plate', () => {
    const { renderer, mat } = make();
    renderer.setIR(ir([]));
    expect([mat('bedSurface').opacity, mat('bedSurface').transparent]).toEqual([1, false]);
    renderer.dispose();
  });
});
