/**
 * Browser Web Worker entry for the geometry pool (DD-028). Bundlers pick this up via
 * `new Worker(new URL('./geometry-worker.js', import.meta.url), { type: 'module' })` — the same
 * batteries-included pattern the parser worker uses. All logic is the host-agnostic
 * `handleGeometryRequest`; this entry only wires the message transport + transfer list.
 */
import { handleGeometryRequest, type GeometryBuildRequest } from './geometry-worker-core.js';

declare const self: {
  postMessage(msg: unknown, transfer?: ArrayBuffer[]): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
};

self.onmessage = (ev) => {
  const { response, transfer } = handleGeometryRequest(ev.data as GeometryBuildRequest);
  self.postMessage(response, transfer);
};
