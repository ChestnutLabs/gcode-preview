/**
 * STL → {@link ModelScene} (DD-018 Phase 1). Binary and ASCII, via three's `STLLoader`.
 *
 * STL carries no color/material and no object structure, so it is the degenerate single-object,
 * no-material case: one object, identity transform, `materials: 'unavailable'`,
 * `transforms: 'unavailable'`, `multiObject: 'unavailable'` — honest, never fabricated.
 */
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { IDENTITY_MAT4, type MeshGeometry, type ModelBounds, type ModelScene } from './scene-model.js';
import { ModelParseError, resolveLimits, type ModelLimits } from './limits.js';
import { inFloat32Range } from './finite.js';

function toArrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  // Copy out the exact view (a Uint8Array may be a partial window over a larger buffer).
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** The facet count a binary STL header claims (bytes 80..84, little-endian); null when there is no header. */
function declaredTriangleCount(buf: ArrayBuffer): number | null {
  return buf.byteLength < 84 ? null : new DataView(buf).getUint32(80, true);
}

/**
 * Mirrors three's `STLLoader` ASCII-vs-binary choice for a file that is not exact-size binary: it is ASCII
 * only if "solid" starts at one of the first five byte offsets (a BOM may precede it); anything else is
 * parsed as binary. Pinned by tests, so a three upgrade that changes the rule fails them.
 */
function startsWithSolid(buf: ArrayBuffer): boolean {
  const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, 10));
  const solid = [115, 111, 108, 105, 100]; // "solid"
  for (let off = 0; off < 5; off++) {
    if (solid.every((c, i) => head[off + i] === c)) return true;
  }
  return false;
}

/** Parse STL bytes into a single-object {@link ModelScene}. Throws {@link ModelParseError} on failure. */
export function parseStl(source: Uint8Array | ArrayBuffer, limits?: ModelLimits): ModelScene {
  const lim = resolveLimits(limits);
  const buf = toArrayBuffer(source);
  if (buf.byteLength === 0) throw new ModelParseError('E_MODEL_EMPTY', 'STL source is empty');
  if (buf.byteLength > lim.maxSourceBytes) {
    throw new ModelParseError(
      'E_MODEL_TOO_LARGE',
      `STL source ${buf.byteLength} bytes exceeds limit ${lim.maxSourceBytes}`
    );
  }
  // Bound the header's claim BEFORE the loader runs: on its binary path it allocates 2 × 36 bytes per claimed
  // facet up front, so a tiny file with a huge count would otherwise cost gigabytes before any limit applies.
  const declared = declaredTriangleCount(buf);
  if (declared !== null) {
    const exactBinary = 84 + declared * 50 === buf.byteLength;
    if (exactBinary || !startsWithSolid(buf)) {
      // The loader will take its binary path.
      if (declared > lim.maxTriangles) {
        throw new ModelParseError(
          'E_MODEL_TOO_MANY_TRIANGLES',
          `STL declares ${declared} triangles, exceeds limit ${lim.maxTriangles}`
        );
      }
      if (84 + declared * 50 > buf.byteLength) {
        throw new ModelParseError(
          'E_MODEL_PARSE',
          `STL declares ${declared} triangles but holds ${Math.floor((buf.byteLength - 84) / 50)}`
        );
      }
    }
  }

  let geom;
  try {
    geom = new STLLoader().parse(buf);
  } catch (e) {
    throw new ModelParseError('E_MODEL_PARSE', `STL parse failed: ${(e as Error).message}`);
  }

  const posAttr = geom.getAttribute('position');
  if (posAttr === undefined || posAttr.count === 0) {
    throw new ModelParseError('E_MODEL_EMPTY', 'STL contains no triangles');
  }
  const triangles = Math.floor(posAttr.count / 3);
  if (triangles > lim.maxTriangles) {
    geom.dispose();
    throw new ModelParseError(
      'E_MODEL_TOO_MANY_TRIANGLES',
      `STL has ${triangles} triangles, exceeds limit ${lim.maxTriangles}`
    );
  }

  const positions = new Float32Array(posAttr.array as ArrayLike<number>);
  for (let i = 0; i < positions.length; i++) {
    if (!inFloat32Range(positions[i])) {
      geom.dispose();
      throw new ModelParseError(
        'E_MODEL_PARSE',
        `STL vertex ${Math.floor(i / 3)} has a non-finite coordinate (${String(positions[i])})`
      );
    }
  }
  const normAttr = geom.getAttribute('normal');
  const normals =
    normAttr !== undefined
      ? repairFacetNormals(positions, new Float32Array(normAttr.array as ArrayLike<number>))
      : undefined;
  const bounds = boundsOf(positions);
  geom.dispose();

  const geometry: MeshGeometry = normals !== undefined ? { positions, normals } : { positions };
  return {
    objects: [{ id: 'stl', geometry, transform: IDENTITY_MAT4 }],
    bounds,
    capabilities: {
      materials: 'unavailable',
      transforms: 'unavailable',
      multiObject: 'unavailable',
      instanced: 'unavailable',
      plates: 'unavailable'
    }
  };
}

/**
 * STL facet normals are advisory and many exporters write `0 0 0` (or garbage). A zero/non-finite normal
 * lights the facet black, so replace each degenerate one with the face normal from its winding; valid
 * file normals are kept. A triangle with no area keeps a zero normal (it covers no pixels).
 */
export function repairFacetNormals(positions: Float32Array, normals: Float32Array): Float32Array {
  for (let t = 0; t + 8 < normals.length && t + 8 < positions.length; t += 9) {
    const nx = normals[t];
    const ny = normals[t + 1];
    const nz = normals[t + 2];
    const len = Math.hypot(nx, ny, nz);
    if (Number.isFinite(len) && len > 1e-6) continue;
    const ax = positions[t + 3] - positions[t];
    const ay = positions[t + 4] - positions[t + 1];
    const az = positions[t + 5] - positions[t + 2];
    const bx = positions[t + 6] - positions[t];
    const by = positions[t + 7] - positions[t + 1];
    const bz = positions[t + 8] - positions[t + 2];
    let cx = ay * bz - az * by;
    let cy = az * bx - ax * bz;
    let cz = ax * by - ay * bx;
    const cl = Math.hypot(cx, cy, cz);
    if (cl > 0) {
      cx /= cl;
      cy /= cl;
      cz /= cl;
    } else {
      cx = cy = cz = 0;
    }
    for (let v = 0; v < 9; v += 3) {
      normals[t + v] = cx;
      normals[t + v + 1] = cy;
      normals[t + v + 2] = cz;
    }
  }
  return normals;
}

function boundsOf(positions: Float32Array): ModelBounds {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
