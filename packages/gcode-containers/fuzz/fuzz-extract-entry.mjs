/*
 * Jazzer.js target (Packet 2 sweep, G1): coverage-guided fuzzing of extractEntry, the whole-entry
 * path that model-3MF entries and the .gcode.3mf metadata read through. The input must first parse
 * as a directory (typed rejections return early), then EVERY entry is extracted under the fuzz cap.
 *
 * Properties:
 *   1. Only a ContainerError may escape, and its code must be one this stage can produce. A guard
 *      deleted and backstopped by an unrelated later throw shows up as an unexpected code.
 *   2. No silent wrong bytes: when extraction SUCCEEDS, the output must match the entry's declared
 *      CRC32 and uncompressed size, and stay within the cap.
 *
 *   npx jazzer packages/gcode-containers/fuzz/fuzz-extract-entry.mjs <corpusDir> \
 *     --sync=false -- -max_total_time=900
 */
import { crc32 as referenceCrc32 } from 'node:zlib';
import { readDirectory, extractEntry, ContainerError } from '../dist/index.js';
import { FUZZ_LIMITS, FUZZ_STREAM_CAP } from './limits.mjs';

/** Every code locatePayload / streamEntry / extractEntry can raise. */
const EXTRACT_CODES = new Set([
  'E_CONTAINER_FORMAT',
  'E_CONTAINER_ENCRYPTED',
  'E_CONTAINER_HEADER_MISMATCH',
  'E_CONTAINER_LIMIT_EXPANDED',
  'E_CONTAINER_METHOD',
  'E_CONTAINER_INFLATE',
  'E_CONTAINER_CRC'
]);

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
    let out;
    try {
      out = await extractEntry(bytes, entry, FUZZ_STREAM_CAP);
    } catch (e) {
      if (e instanceof ContainerError) {
        if (!EXTRACT_CODES.has(e.code)) {
          throw new Error(`unexpected extract-stage code ${e.code}: ${e.message}`, { cause: e });
        }
        continue;
      }
      throw e;
    }
    if (out.byteLength > FUZZ_STREAM_CAP) {
      throw new Error(`extractEntry returned ${out.byteLength} B past the cap ${FUZZ_STREAM_CAP}`);
    }
    if (out.byteLength !== entry.uncompressedSize) {
      throw new Error(`extractEntry returned ${out.byteLength} B, headers say ${entry.uncompressedSize}`);
    }
    // node:zlib CRC, not the module's own, so a broken reader CRC cannot vouch for itself.
    if (referenceCrc32(out) !== entry.crc32) {
      throw new Error(`extractEntry returned bytes whose CRC does not match the header for '${entry.name}'`);
    }
  }
}
