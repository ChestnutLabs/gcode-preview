/**
 * Deterministic cache key for a rendered still (DD-018 §4.3). A stable identity a consumer persists as
 * thumbnail provenance and regenerates only when it changes: a hash of the source bytes, the
 * output-affecting options, and an env id. The env id folds in the renderer/three version, because
 * render output can change across three versions — determinism is promised **per environment**, not
 * across GPUs/versions.
 *
 * The hash is FNV-1a (non-cryptographic): cache keys need determinism + change-sensitivity, not
 * collision resistance. No dependencies, no Web Crypto (works identically in a worker/OffscreenCanvas).
 */
import { REVISION } from 'three';

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1aBytes(bytes: Uint8Array, seed = FNV_OFFSET): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

function fnv1aString(s: string, seed = FNV_OFFSET): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, FNV_PRIME);
    h ^= (s.charCodeAt(i) >> 8) & 0xff;
    h = Math.imul(h, FNV_PRIME);
  }
  return h >>> 0;
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, '0');
}

/** The default environment id — the `three` revision, which gates render determinism. */
export function defaultEnvId(): string {
  return `three${REVISION}`;
}

/**
 * Compute a stable cache key. `optionsJson` should be a canonical serialization of the render options
 * that affect output (size, background, view, lighting) — the caller passes it so only output-affecting
 * fields are folded in. `envId` defaults to {@link defaultEnvId}.
 */
export function computeCacheKey(sourceBytes: Uint8Array, optionsJson: string, envId: string = defaultEnvId()): string {
  const src = fnv1aBytes(sourceBytes);
  const opt = fnv1aString(optionsJson, src); // chain so ordering matters
  const env = fnv1aString(envId, opt);
  return `mr1_${hex8(src)}${hex8(opt)}${hex8(env)}`;
}
