/*
 * Jazzer.js target (DD-008 D7, #131): coverage-guided fuzzing of the ZIP
 * central-directory parser. Property: attacker bytes may only ever produce a
 * typed ContainerError — any other throw (TypeError, RangeError, OOM-path
 * assertion) is a finding libFuzzer records as a crash.
 *
 *   npx jazzer packages/gcode-containers/fuzz/fuzz-read-directory.mjs <corpusDir> \
 *     -- -max_total_time=900
 *
 * Requires the package to be built (imports ../dist). Findings are triaged per
 * SECURITY.md and land as minimized, legal, redistributable fixtures in
 * test-data/fixtures/fuzz-regressions/ — never as raw crash blobs.
 */
import { readDirectory, ContainerError } from '../dist/index.js';
import { FUZZ_LIMITS } from './limits.mjs';

export function fuzz(data) {
  try {
    readDirectory(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), FUZZ_LIMITS);
  } catch (e) {
    if (e instanceof ContainerError) return; // typed rejection — the contract
    throw e;
  }
}
