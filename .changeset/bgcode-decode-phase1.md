---
'@chestnutlabs/gcode-bgcode': minor
---

New package **`@chestnutlabs/gcode-bgcode`** — binary G-code (`.bgcode`) decode, phase 1 (DD-011,
epic #188). A license-clean, in-memory block walker that decodes Prusa `.bgcode` to plain G-code for
the existing parser/dialect/IR/renderer pipeline. **Decode-only.**

Phase 1 ships the block walker + per-block CRC32 verification + `sniffBgcode`/`openBgcode`, with
**None** and **DEFLATE** compression and **None** encoding decoded end-to-end. MeatPack (phase 2) and
heatshrink (phase 3) return honest, structured `ContainerError`s (`E_BGCODE_UNSUPPORTED_ENCODING` /
`E_BGCODE_UNSUPPORTED_COMPRESSION`) until then. All failures — bad magic/version, CRC mismatch,
truncation, decompression bomb — are bounded structured errors.

Clean-room from the published spec (RR-003): no AGPL `libbgcode`/MeatPack code. Depends only on
`@chestnutlabs/toolpath-core` and `@chestnutlabs/gcode-containers` (for `crc32`/`ContainerError`); no
`three`, framework, filesystem, or network. Container-adapter + worker registration + metadata/
thumbnail surfacing + the plain-vs-`.bgcode` golden-equivalence test land in phase 4.
