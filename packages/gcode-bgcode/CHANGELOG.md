# @chestnutlabs/gcode-bgcode

## 0.5.2

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-containers@0.5.2
  - @chestnutlabs/toolpath-core@0.5.2

## 0.5.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-containers@0.5.1
  - @chestnutlabs/toolpath-core@0.5.1

## 0.5.0

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-containers@0.5.0
  - @chestnutlabs/toolpath-core@0.5.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`1029580`](https://github.com/ChestnutLabs/gcode-preview/commit/10295803839816adaed224c48eba1f74374c0c2a), [`8fec7c3`](https://github.com/ChestnutLabs/gcode-preview/commit/8fec7c3622cd2a6d6d57b43d7866cfea1cb71e09)]:
  - @chestnutlabs/toolpath-core@0.4.0
  - @chestnutlabs/gcode-containers@0.4.0

## 0.3.0

### Minor Changes

- [#238](https://github.com/ChestnutLabs/gcode-preview/pull/238) [`75f9f2b`](https://github.com/ChestnutLabs/gcode-preview/commit/75f9f2b2c758ef15b26a4b0f8dd955c89c9c5fb1) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Register `.bgcode` as a **container adapter** so it flows through the existing parser pipeline
  (DD-011 phase 4c, [#188](https://github.com/ChestnutLabs/gcode-preview/issues/188)). A `.bgcode` file now "just works" through `GcodeParseSession` with
  `containers: 'auto'` — sniffed by magic, decoded to plain G-code, and parsed to the same IR as the
  plain `.gcode` (proven by the golden-equivalence test).
  - `gcode-bgcode`: `openBgcodeContainer(bytes)` implements the DD-005 §4.4 `{ id, sniff, open }` shape
    (single plate; `openPlate(0)` streams the decoded G-code). `openBgcode(bytes, { metadata: true })`
    now also decodes the metadata (INI) and thumbnail blocks, so the adapter surfaces **machine geometry
    from `bed_shape`**, whitelisted slicer settings (feeding dialect detection + provenance), and
    thumbnails.
  - `gcode-parser`: the batteries worker registers the `bgcode` adapter beside `gcode-3mf`.

  Verified end-to-end: a real Prusa XL cube `.bgcode` parses through the session to 11,417 segments with
  a 360×360 bed and `printer_model` metadata.

- [#233](https://github.com/ChestnutLabs/gcode-preview/pull/233) [`83f0336`](https://github.com/ChestnutLabs/gcode-preview/commit/83f033676522620ef9d57010a44d044f5f75c99d) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - New package **`@chestnutlabs/gcode-bgcode`** — binary G-code (`.bgcode`) decode, phase 1 (DD-011,
  epic [#188](https://github.com/ChestnutLabs/gcode-preview/issues/188)). A license-clean, in-memory block walker that decodes Prusa `.bgcode` to plain G-code for
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

- [#235](https://github.com/ChestnutLabs/gcode-preview/pull/235) [`bb3085a`](https://github.com/ChestnutLabs/gcode-preview/commit/bb3085a03a4ce60b12789d0339c5c1a7bb8c7d5a) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Binary G-code decode **phase 3** (DD-011, [#188](https://github.com/ChestnutLabs/gcode-preview/issues/188)): **heatshrink** decompression (windows 11 & 12,
  lookahead 4). With this, **all four `.bgcode` compression codecs and all encodings the spec defines
  are decoded** — a `.bgcode` GCode block compressed with heatshrink now decodes end-to-end to plain
  G-code.

  The decoder is a TypeScript port of the LZSS decoder from the **ISC** `atomicobject/heatshrink`
  (© 2013–2015 Scott Vokes) — attribution preserved, no AGPL `libbgcode` (RR-003 §8). It is validated
  against vectors built by an **independent MSB-first bit-packer** from the wire format (literal, single
  and multi-byte back-references, self-referential runs, window 11 & 12, a realistic repeated G-code
  fragment) plus block-level integration through `openBgcode`. Output is bounded (decompression-bomb
  defense). Container-adapter integration + real PrusaSlicer-file golden-equivalence follow in phase 4.

- [#234](https://github.com/ChestnutLabs/gcode-preview/pull/234) [`8c0ee6e`](https://github.com/ChestnutLabs/gcode-preview/commit/8c0ee6e2d5aec4d3b9c835ae92aa032ae619da34) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Binary G-code decode **phase 2** (DD-011, [#188](https://github.com/ChestnutLabs/gcode-preview/issues/188)): the **MeatPack** G-code encoding (both variants —
  `MeatPack` and `MeatPack (comments preserved)`). A `.bgcode` GCode block encoded with MeatPack now
  decodes end-to-end (optionally after DEFLATE) to plain G-code.

  The decoder is a faithful TypeScript port of the **MIT** `jamesgopsill/meatpack` unpacker (© 2025
  James Gopsill), which is itself derived from the published Prusa spec — attribution preserved, and no
  AGPL `libbgcode`/OctoPrint-MeatPack code (RR-003 §8). It is validated against **hand-computed vectors**
  (the nibble table applied by hand as an independent oracle: packing, left/right/double full-width
  escapes, the newline special case, and the no-spaces + disable-packing commands), plus block-level
  integration through `openBgcode`. Output is bounded (decompression-bomb defense) and invalid command
  bytes are structured errors. heatshrink compression remains phase 3.

### Patch Changes

- [#236](https://github.com/ChestnutLabs/gcode-preview/pull/236) [`852db93`](https://github.com/ChestnutLabs/gcode-preview/commit/852db9315ac3983c337508460575b4299ddacdfa) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Fix the `.bgcode` DEFLATE flavor: it is **zlib-wrapped**, not raw (DD-011 phase 4 confirmation, [#188](https://github.com/ChestnutLabs/gcode-preview/issues/188)).
  Verified against a real Prusa XL `.bgcode` file — its DEFLATE-compressed Slicer/Print **metadata**
  blocks decode only with the zlib header and fail as raw. (GCode blocks use heatshrink, so this was
  invisible until a real file's metadata was exercised.) The decoder now uses `DecompressionStream('deflate')`,
  and a flavor-lock test asserts a raw-DEFLATE block is rejected so this can't regress.

- [#237](https://github.com/ChestnutLabs/gcode-preview/pull/237) [`f2e79e4`](https://github.com/ChestnutLabs/gcode-preview/commit/f2e79e4da2bff2d6fb8222a94f04669128efc5d8) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - Add the `.bgcode` **golden-equivalence killer test** (DD-011 §D6, [#188](https://github.com/ChestnutLabs/gcode-preview/issues/188)): a PrusaSlicer 2.9.6 primitive
  cube, committed in both `.gcode` and `.bgcode`, is decoded and parsed, and its IR is asserted
  **byte-identical** to the IR of the plain `.gcode` across every geometry channel (positions, extrusion,
  kind, tool, layer). This pins decode correctness against the already-trusted plain-G-code path and
  exercises the real Prusa codec stack end-to-end (heatshrink-12 + MeatPack comments/no-spaces, DEFLATE
  metadata, thumbnails, per-block CRC32). Test/fixtures only — no code or public-API change.

- [#239](https://github.com/ChestnutLabs/gcode-preview/pull/239) [`b0ef69f`](https://github.com/ChestnutLabs/gcode-preview/commit/b0ef69f9ac2184c697f4df04c4c4c22ac709d0ee) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - `.bgcode` security hardening (DD-011 §7 + phase 5, [#188](https://github.com/ChestnutLabs/gcode-preview/issues/188)): a deterministic **adversarial fuzz corpus**
  (`adversarial.test.ts`) — ~1600 inputs across pure-random bytes, `GCDE`-prefixed random, bit-flip
  mutations of a real file, and garbage payloads through every codec — asserting that only bounded,
  structured `ContainerError`s ever escape (never a crash, unbounded allocation, or hang). Plus edge
  cases: an oversized declared size can't balloon memory, and unknown block types are walked past.

  Adds the **§7 security-review record** (`docs/design/SECURITY-REVIEW-DD-011-bgcode.md`, prepared for
  maintainer sign-off) and a **decode benchmark** (`tools/benchmark/results/`) with real numbers (cube:
  15.7 ms; 21 MB Prusa XL ColorMix: 3.3 s decode → 51 MB, all 856 CRC32s verified). Tests + docs only.

- Updated dependencies [[`39348de`](https://github.com/ChestnutLabs/gcode-preview/commit/39348de9ce68717e71516f9acaccd475139983ba), [`d161e80`](https://github.com/ChestnutLabs/gcode-preview/commit/d161e802e36cc87fa27848ceef9d68cd45628760), [`82bd7ae`](https://github.com/ChestnutLabs/gcode-preview/commit/82bd7ae7f76e742767719d8efa11173a6548fc03)]:
  - @chestnutlabs/toolpath-core@0.3.0
  - @chestnutlabs/gcode-containers@0.3.0
