/* worker_threads worker for the DD-028 geometry-pool measurement — runs the shipped kernel. */
import { parentPort } from 'node:worker_threads';
import { handleGeometryRequest } from '../../packages/gcode-renderer-three/dist/geometry-worker-core.js';

parentPort.on('message', (req) => {
  const { response, transfer } = handleGeometryRequest(req);
  parentPort.postMessage(response, transfer);
});
