/*
 * Jazzer.js target (DD-008 D7, #131): coverage-guided fuzzing of entry
 * streaming/inflation. The input must first parse as a directory (typed
 * rejections return early), then EVERY entry is fully drained through
 * streamEntry under the fuzz cap. Property: only ContainerError may escape.
 *
 *   npx jazzer packages/gcode-containers/fuzz/fuzz-stream-entry.mjs <corpusDir> \
 *     --sync=false -- -max_total_time=900
 */
import { readDirectory, streamEntry, ContainerError } from '../dist/index.js';
import { FUZZ_LIMITS, FUZZ_STREAM_CAP } from './limits.mjs';

export async function fuzz(data) {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let dir;
  try {
    dir = readDirectory(bytes, FUZZ_LIMITS);
  } catch (e) {
    if (e instanceof ContainerError) return;
    throw e;
  }
  for (const entry of dir.entries) {
    try {
      let drained = 0;
      for await (const chunk of streamEntry(bytes, entry, FUZZ_STREAM_CAP)) {
        drained += chunk.byteLength;
        if (drained > FUZZ_STREAM_CAP * 2) {
          throw new Error(`stream produced ${drained} B past the cap — limit enforcement failed`);
        }
      }
    } catch (e) {
      if (e instanceof ContainerError) continue;
      throw e;
    }
  }
}
