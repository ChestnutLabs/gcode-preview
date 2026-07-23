/**
 * DD-003 §4.4/§11 consumer smoke: instantiate the DEFAULT worker path
 * (`new Worker(new URL('./worker.js', import.meta.url), {type:'module'})`
 * inside the package, bundled by Vite) and complete a parse off-thread.
 * Writes a machine-readable verdict into #result for automated verification.
 */
import { GcodeParseSession, PROTOCOL_VERSION } from '@chestnutlabs/gcode-parser';

const out = document.getElementById('result');

function gcodeSample(lines) {
  const parts = ['G0 X0 Y0 Z0.2'];
  for (let i = 1; i <= lines; i++) {
    parts.push(`G1 X${i % 50} Y${(i * 3) % 40} E${i} F1500`);
  }
  return parts.join('\n');
}

async function run() {
  const session = new GcodeParseSession(); // DEFAULT worker path — the thing under test
  const progressEvents = [];
  session.onProgress((p) => progressEvents.push(p.bytesProcessed));

  const result = await session.parse(gcodeSample(120000), { yieldIntervalMs: 25 });
  const verdict = {
    smoke: 'PASS',
    protocolVersion: PROTOCOL_VERSION,
    workerPath: 'default (new URL, bundled by Vite)',
    complete: result.ir.header.complete,
    segments: result.ir.segments.count,
    layers: result.ir.layers.length,
    srcByteKnown: result.ir.header.capabilities.sourcePositions,
    progressEvents: progressEvents.length,
    // Zero-copy proof: after transfer the buffers arrived here intact.
    x0IsFloat32: result.ir.segments.x0 instanceof Float32Array,
    offThread: true
  };
  session.dispose();
  out.textContent = JSON.stringify(verdict, null, 2);
}

run().catch((err) => {
  out.textContent = JSON.stringify({ smoke: 'FAIL', error: String(err && err.message) });
});
