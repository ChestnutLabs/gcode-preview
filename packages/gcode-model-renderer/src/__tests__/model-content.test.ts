/**
 * ModelContent mutation sweep: framing numbers, mesh build (indices, normals, colours, material, instancing),
 * and disposal. Literal expected values; the scene graph is inspected directly.
 */
import { describe, expect, it, vi } from 'vitest';
import { Group, InstancedMesh, Mesh, MeshStandardMaterial, Scene } from 'three';
import { ModelContent } from '../model-content.js';
import { IDENTITY_MAT4, type Mat4, type ModelObject, type ModelScene } from '../scene-model.js';

const TRI = [0, 0, 0, 1, 0, 0, 0, 1, 0];
const CAPS = {
  materials: 'unavailable',
  transforms: 'unavailable',
  multiObject: 'unavailable',
  instanced: 'unavailable',
  plates: 'unavailable'
} as const;

function model(
  objects: Partial<ModelObject>[],
  min: [number, number, number] = [0, 0, 0],
  max: [number, number, number] = [1, 1, 0]
): ModelScene {
  return {
    objects: objects.map((o, i) => ({
      id: `o${i}`,
      geometry: { positions: new Float32Array(TRI) },
      transform: IDENTITY_MAT4,
      ...o
    })),
    bounds: { min, max },
    capabilities: { ...CAPS }
  };
}
function build(s: ModelScene): { scene: Scene; content: ModelContent; root: Group } {
  const scene = new Scene();
  const content = new ModelContent(scene);
  content.setScene(s);
  return { scene, content, root: scene.children[0] as Group };
}
const meshOf = (root: Group, i = 0): Mesh => root.children[i] as Mesh;
const matOf = (m: Mesh): MeshStandardMaterial => m.material as MeshStandardMaterial;

describe('framing', () => {
  it('is the bounds centre, the corner distance, and the Y-up scene box', () => {
    const { content } = build(model([{}], [0, 0, 0], [3, 4, 12]));
    const f = content.framing!;
    expect([f.center.x, f.center.y, f.center.z]).toEqual([1.5, 2, 6]);
    expect(f.radius).toBe(6.5);
    expect([f.sceneMin.x, f.sceneMin.y, f.sceneMin.z]).toEqual([0, 0, -4]);
    // +0 normalises -minY = -0
    expect([f.sceneMax.x, f.sceneMax.y, f.sceneMax.z + 0]).toEqual([3, 12, 0]);
  });

  it('centre uses each axis midpoint (offset box)', () => {
    const f = build(model([{}], [2, 4, 6], [4, 8, 14])).content.framing!;
    expect([f.center.x, f.center.y, f.center.z]).toEqual([3, 6, 10]);
  });

  it('a zero-size model has radius 0.001, not 0', () => {
    expect(build(model([{}], [5, 5, 5], [5, 5, 5])).content.framing!.radius).toBe(0.001);
  });

  it('the presentation offset moves centre and scene box in scene axes (x, z, -y)', () => {
    const { content } = build(model([{}], [0, 0, 0], [2, 2, 2]));
    content.setPresentationOffset({ x: 10, y: 20, z: 30 });
    const f = content.framing!;
    expect([f.center.x, f.center.y, f.center.z]).toEqual([11, 21, 31]);
    expect([f.sceneMin.x, f.sceneMin.y, f.sceneMin.z]).toEqual([10, 30, -22]);
    expect([f.sceneMax.x, f.sceneMax.y, f.sceneMax.z]).toEqual([12, 32, -20]);
    expect(f.radius).toBe(Math.sqrt(3));
  });

  it('is null before a scene is set, even with an offset', () => {
    const content = new ModelContent(new Scene());
    expect(content.framing).toBeNull();
    content.setPresentationOffset({ x: 1, y: 2, z: 3 });
    expect(content.framing).toBeNull();
  });

  it('moves the root by (x, z, -y) and null puts it back at the origin', () => {
    const { content, root } = build(model([{}]));
    content.setPresentationOffset({ x: 1, y: 2, z: 3 });
    expect([root.position.x, root.position.y, root.position.z]).toEqual([1, 3, -2]);
    content.setPresentationOffset(null);
    expect([root.position.x, root.position.y, root.position.z]).toEqual([0, 0, 0]);
    expect(root.rotation.x).toBe(-Math.PI / 2);
  });

  it('reports real per-object progress 1..n', () => {
    const done: number[] = [];
    new ModelContent(new Scene()).setScene(model([{}, {}, {}]), (n) => done.push(n));
    expect(done).toEqual([1, 2, 3]);
  });
});

describe('mesh build', () => {
  it('uses an index buffer when the geometry has one', () => {
    const m = meshOf(
      build(model([{ geometry: { positions: new Float32Array(TRI), indices: new Uint32Array([0, 1, 2]) } }])).root
    );
    expect(Array.from(m.geometry.index!.array)).toEqual([0, 1, 2]);
  });

  it('has no index buffer otherwise', () => {
    expect(meshOf(build(model([{}])).root).geometry.index).toBeNull();
  });

  it('computes vertex normals when none are supplied', () => {
    const n = meshOf(build(model([{}])).root).geometry.getAttribute('normal');
    expect(Array.from(n.array)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it('uses supplied normals as given', () => {
    const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const m = meshOf(build(model([{ geometry: { positions: new Float32Array(TRI), normals } }])).root);
    expect(Array.from(m.geometry.getAttribute('normal').array)).toEqual([0, 1, 0, 0, 1, 0, 0, 1, 0]);
  });

  it('per-vertex colours become a colour attribute and turn vertex colours on', () => {
    const colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const m = meshOf(build(model([{ geometry: { positions: new Float32Array(TRI), colors } }])).root);
    expect(Array.from(m.geometry.getAttribute('color').array)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(matOf(m).vertexColors).toBe(true);
  });

  it('without colours vertex colours stay off and there is no colour attribute', () => {
    const m = meshOf(build(model([{}])).root);
    expect(matOf(m).vertexColors).toBe(false);
    expect(m.geometry.getAttribute('color')).toBeUndefined();
  });

  it('a declared material colour is used', () => {
    const m = matOf(meshOf(build(model([{ material: { color: [1, 0, 0] } }])).root));
    expect([m.color.r, m.color.g, m.color.b]).toEqual([1, 0, 0]);
  });

  it('no material gives the neutral grey 0.8, 0.8, 0.82', () => {
    const m = matOf(meshOf(build(model([{}])).root));
    expect(m.color.r).toBeCloseTo(0.8, 6);
    expect(m.color.g).toBeCloseTo(0.8, 6);
    expect(m.color.b).toBeCloseTo(0.82, 6);
    expect(m.roughness).toBe(0.62);
    expect(m.metalness).toBe(0);
  });

  it('a single placement is a plain Mesh carrying the object transform', () => {
    const t: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 8, 9, 1];
    const m = meshOf(build(model([{ transform: t, instances: [t] }])).root);
    expect(m instanceof InstancedMesh).toBe(false);
    expect(m.matrixAutoUpdate).toBe(false);
    expect(Array.from(m.matrix.elements)).toEqual(t);
  });

  it('two or more placements are one InstancedMesh with each matrix, flagged for upload', () => {
    const a: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1];
    const b: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1];
    const m = meshOf(build(model([{ instances: [a, b] }])).root) as unknown as InstancedMesh;
    expect(m instanceof InstancedMesh).toBe(true);
    expect(m.count).toBe(2);
    const out = new (m.matrix.constructor as new () => typeof m.matrix)();
    m.getMatrixAt(0, out);
    expect(Array.from(out.elements)).toEqual(a);
    m.getMatrixAt(1, out);
    expect(Array.from(out.elements)).toEqual(b);
    expect(m.instanceMatrix.version).toBe(1);
  });
});

describe('replace and dispose', () => {
  it('a second setScene removes and disposes the first scene meshes', () => {
    const { content, root } = build(model([{}, {}]));
    const first = meshOf(root, 0);
    const geoDispose = vi.spyOn(first.geometry, 'dispose');
    content.setScene(model([{}]));
    expect(root.children).toHaveLength(1);
    expect(root.children[0]).not.toBe(first);
    expect(geoDispose).toHaveBeenCalledTimes(1);
  });

  it('dispose() frees geometry and material once, empties the root, and is idempotent', () => {
    const { content, root } = build(model([{}]));
    const m = meshOf(root);
    const geo = vi.spyOn(m.geometry, 'dispose');
    const mat = vi.spyOn(matOf(m), 'dispose');
    content.dispose();
    content.dispose();
    expect(geo).toHaveBeenCalledTimes(1);
    expect(mat).toHaveBeenCalledTimes(1);
    expect(root.children).toHaveLength(0);
  });

  it('dispose() also disposes an instanced mesh', () => {
    const a: Mat4 = IDENTITY_MAT4;
    const { content, root } = build(model([{ instances: [a, a] }]));
    const inst = vi.spyOn(meshOf(root), 'dispose' as never);
    content.dispose();
    expect(inst).toHaveBeenCalledTimes(1);
  });
});
