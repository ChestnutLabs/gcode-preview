/**
 * heatshrink LZSS decoder (DD-011 phase 3, #188).
 *
 * A TypeScript port of the decoder from **atomicobject/heatshrink** (ISC, © 2013–2015 Scott Vokes —
 * https://github.com/atomicobject/heatshrink). ISC is permissive and MIT-compatible; porting with the
 * attribution preserved is the sanctioned path (RR-003 §8) — the AGPL `libbgcode` is never copied.
 *
 * Wire format (whole-buffer form of the reference's streaming state machine): a big-endian (MSB-first)
 * bit stream of tokens. Each token starts with a tag bit — `1` = an 8-bit literal byte; `0` = a
 * back-reference: `windowBits` of index then `lookaheadBits` of count (both stored as value−1). A
 * back-reference copies `count+1` bytes from `index+1` bytes back in a circular window, re-emitting
 * each into the window (so runs can reference themselves). bgcode uses window 11 or 12, lookahead 4.
 */
import { ContainerError } from '@chestnutlabs/gcode-containers';
import { checkDecoderLimit } from './meatpack.js';

/**
 * Decode a heatshrink stream. `windowBits`/`lookaheadBits` come from the bgcode compression id.
 *
 * Accepted parameters (all validated before any allocation; anything else throws `ContainerError`
 * `E_BGCODE_OPTION`): `windowBits` an integer in 4..15, `lookaheadBits` an integer in 3..`windowBits − 1`, `limit`
 * a non-negative safe integer. Output past `limit` throws `E_BGCODE_BOMB`. bgcode itself uses window 11 or 12,
 * lookahead 4.
 */
export function heatshrinkDecode(
  data: Uint8Array,
  windowBits: number,
  lookaheadBits: number,
  limit: number
): Uint8Array {
  if (!(Number.isInteger(windowBits) && windowBits >= 4 && windowBits <= 15)) {
    throw new ContainerError('E_BGCODE_OPTION', `windowBits must be an integer in 4..15 (got ${String(windowBits)})`);
  }
  if (!(Number.isInteger(lookaheadBits) && lookaheadBits >= 3 && lookaheadBits <= windowBits - 1)) {
    throw new ContainerError(
      'E_BGCODE_OPTION',
      `lookaheadBits must be an integer in 3..${windowBits - 1} (got ${String(lookaheadBits)})`
    );
  }
  checkDecoderLimit(limit);
  const windowSize = 1 << windowBits;
  const mask = windowSize - 1;
  const window = new Uint8Array(windowSize);
  let head = 0; // write cursor into the circular window (monotonic; masked on access)

  let out = new Uint8Array(Math.max(64, Math.min(limit, data.length * 4)));
  let pos = 0;
  const emit = (c: number): void => {
    if (pos >= limit) throw new ContainerError('E_BGCODE_BOMB', `heatshrink output exceeds the limit (${pos})`);
    if (pos >= out.length) {
      const bigger = new Uint8Array(Math.min(limit, out.length * 2));
      bigger.set(out.subarray(0, pos));
      out = bigger;
    }
    out[pos++] = c;
    window[head++ & mask] = c;
  };

  // MSB-first bit reader over `data`. Returns null when fewer than `count` bits remain (end of input).
  let bytePos = 0;
  let bitIndex = 0; // 0 means "load next byte"; otherwise a single-bit mask (0x80..0x01)
  let currentByte = 0;
  const getBits = (count: number): number | null => {
    let acc = 0;
    for (let i = 0; i < count; i++) {
      if (bitIndex === 0) {
        if (bytePos >= data.length) return null;
        currentByte = data[bytePos++];
        bitIndex = 0x80;
      }
      acc = (acc << 1) | (currentByte & bitIndex ? 1 : 0);
      bitIndex >>= 1;
    }
    return acc;
  };

  for (;;) {
    const tag = getBits(1);
    if (tag === null) break; // end of input (trailing byte-padding can never form a full token)
    if (tag === 1) {
      const byte = getBits(8);
      if (byte === null) break;
      emit(byte & 0xff);
    } else {
      // Index and count are read as ONE field (windowBits + lookaheadBits <= 29 bits, so it fits an int32): a
      // token cut off anywhere inside it is a single truncation, never a half-token.
      const field = getBits(windowBits + lookaheadBits);
      if (field === null) break;
      const negOffset = (field >>> lookaheadBits) + 1;
      const copyCount = (field & ((1 << lookaheadBits) - 1)) + 1;
      for (let i = 0; i < copyCount; i++) {
        emit(window[(head - negOffset) & mask]);
      }
    }
  }
  return out.subarray(0, pos);
}
