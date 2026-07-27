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
 * Phase 1: block walker + CRC32 + None/DEFLATE compression + None encoding. Phase 2: **MeatPack**
 * encoding (both variants). Phase 3: **heatshrink** compression (windows 11 & 12). All spec codecs are
 * now decoded; container-adapter integration + real-file golden-equivalence follow in phase 4.
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
export type { BgcodeBlockInfo, BgcodeDecodeResult, BgcodeDecodeOptions } from './bgcode.js';
export { meatpackDecode } from './meatpack.js';
export { heatshrinkDecode } from './heatshrink.js';
