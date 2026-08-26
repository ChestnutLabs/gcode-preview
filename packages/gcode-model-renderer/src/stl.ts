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

function toArrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) return bytes;
  // Copy out the exact view (a Uint8Array may be a partial window over a larger buffer).
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Binary-STL triangle count from its header (bytes 80..84, little-endian), or null if not binary-shaped. */
function binaryTriangleCount(buf: ArrayBuffer): number | null {
  if (buf.byteLength < 84) return null;
  const n = new DataView(buf).getUint32(80, true);
  // Binary STL is exactly 84 + 50·n bytes. If that doesn't hold, it's ASCII (or malformed).
  return 84 + n * 50 === buf.byteLength ? n : null;
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
  // Pre-check binary triangle count before the loader allocates buffers for it.
  const preTris = binaryTriangleCount(buf);
  if (preTris !== null && preTris > lim.maxTriangles) {
    throw new ModelParseError(
      'E_MODEL_TOO_MANY_TRIANGLES',
      `STL declares ${preTris} triangles, exceeds limit ${lim.maxTriangles}`
    );
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
  const normAttr = geom.getAttribute('normal');
  const normals = normAttr !== undefined ? new Float32Array(normAttr.array as ArrayLike<number>) : undefined;
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
