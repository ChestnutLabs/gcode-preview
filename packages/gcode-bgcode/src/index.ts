/**
 * @chestnutlabs/gcode-bgcode — Binary G-code (`.bgcode`) decode adapter (DD-011, epic #188).
 *
 * A license-clean, in-memory decoder for Prusa's binary G-code container. `.bgcode` is a container
 * of ordinary G-code, so decoding it (block walk → CRC verify → decompress → decode → concatenate)
 * yields plain G-code the existing parser/dialect/IR/renderer stack consumes unchanged. **Decode-only.**
 *
 * Clean-room from the published spec (RR-003) — no AGPL `libbgcode`/MeatPack code. Depends only on
 * `@chestnutlabs/toolpath-core` and `@chestnutlabs/gcode-containers` (for `crc32`/`ContainerError`);
 * no `three`, framework, filesystem, or network.
 *
 * All spec codecs are decoded (None/DEFLATE/heatshrink × None/MeatPack), validated against real Prusa
 * files (golden-equivalence). Phase 4c registers a **container adapter** so `.bgcode` flows through the
 * parser pipeline via `containers: 'auto'`, surfacing machine geometry + settings + thumbnails.
 */
export {
  BGCODE_MAGIC,
  BGCODE_VERSION,
  BgcodeBlockType,
  BgcodeCompression,
  BgcodeEncoding,
  sniffBgcode,
  openBgcode
} from './bgcode.js';
export type { BgcodeBlockInfo, BgcodeDecodeResult, BgcodeDecodeOptions, BgcodeThumbnail } from './bgcode.js';
export { meatpackDecode } from './meatpack.js';
export { heatshrinkDecode } from './heatshrink.js';
// Container-adapter integration (DD-005 §4.4, #188 phase 4c).
export { openBgcodeContainer } from './adapter.js';
export type { OpenedBgcode, BgcodeStreamLike } from './adapter.js';
