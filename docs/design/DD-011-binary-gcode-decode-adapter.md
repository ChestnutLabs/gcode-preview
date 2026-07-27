# DD-011 — Binary G-code (`.bgcode`) Decode Adapter

**Status:** Accepted <!-- Draft | Proposed | Accepted | Superseded | Rejected -->
**Authors/Owners:** Nathaniel Chestnut
**Date:** 2026-07-27 · **Last revised:** 2026-07-27
**Accepted:** 2026-07-27 — D1–D7 as recommended, with **D4 amended**: metadata/thumbnail surfacing is **in-scope, not deferred** (lands with the adapter, reusing the existing sink). Implementation unblocked per §14.
**Owning Epic:** E-bgcode (#188) · **Milestone:** Future
**Supersedes / Superseded by:** none
**Related:** [RR-003](../research/RR-003-bgcode-licensing-and-format-audit.md) (licensing + format audit — the gate this DD answers), DD-005 (dialect/container adapter contracts — `.bgcode` is a sibling of `.gcode.3mf`), DD-003 (worker parsing, streaming, resource limits — bounded decompression), DD-002 (package boundaries — a new lockstep package), DD-001 (capability model). Reserved number: DD-011 (#188).

---

## 1. Problem

Modern PrusaSlicer defaults to **binary G-code (`.bgcode`)** for Prusa printers, so a growing share of
real files — including 2026 ColorMix prints — are **undecodable** by our stack today. RR-003 established
that `.bgcode` is a *container/encoding* of ordinary G-code, not a new toolpath language: decode it to
plain G-code and the **entire existing pipeline works unchanged**. RR-003 also established the binding
constraint — the reference decoder (`libbgcode`) and MeatPack are **AGPL**, so decode must be built
license-clean. This DD specifies that adapter.

## 2. Scope

- A new **`@chestnutlabs/gcode-bgcode`** package implementing the DD-005 §4.4 container-adapter contract
  (`sniff` / `open`), registered in the parser worker beside `.gcode.3mf`.
- A **block walker** (spec v1), **CRC32 verification**, and **codec dispatch**: DEFLATE, heatshrink
  (windows 11 & 12, lookahead 4), MeatPack (± comment preservation), and the identity cases.
- Decoding all GCode blocks to a single plain-G-code stream consumed by the existing parser; optionally
  surfacing metadata (`MachineGeometry`) and thumbnails through the existing sink.
- Fixtures (self-generated), codec vectors, an adversarial corpus, the golden-equivalence killer test,
  and a §7.3 security review.

## 3. Non-goals

- **No `.bgcode` encoding/writing** — decode/read only.
- **No new toolpath model** — it decodes to G-code; downstream is untouched.
- **No AGPL code** — never copy/translate/vendor/WASM-bundle `libbgcode` or OctoPrint-MeatPack (§6, RR-003).
- **No multi-plate** — `.bgcode` is single-payload (simpler than `.gcode.3mf`).
- **No unpinned spec versions** — v1 only; unknown versions/codecs rejected honestly (§6).

## 4. Decisions

> **Accepted 2026-07-27 — D1–D7 as recommended, D4 AMENDED.** Metadata/thumbnail surfacing is
> **in-scope from the start** (not deferred to a late phase); it lands with the container-adapter
> integration, reusing the existing sink. All other decisions stand as drafted. Implementation
> proceeds on the §14 phasing.

### 4.1 D1 — Package & placement (DD-002)
A new lockstep package **`@chestnutlabs/gcode-bgcode`** (dependencies: `@chestnutlabs/toolpath-core` and
`@chestnutlabs/gcode-containers` — to reuse `crc32`/`crc32Final`, `ContainerLimits`/
`DEFAULT_CONTAINER_LIMITS`, and the `StreamLike` shape). No `three`, framework, fs, or net. Rationale: it
is a peer of `gcode-containers`, not part of it, keeping the ZIP/3mf surface and the bgcode surface (and
their fixtures/fuzzers) independently versioned and auditable.

### 4.2 D2 — Adapter shape (DD-005 §4.4)
Export `sniffBgcode(prefix, name?)` (magic `"GCDE"` in the first 4 bytes, or a `.bgcode` name) and
`openBgcode(bytes, limits?)` returning a single decoded plain-G-code payload via the existing `StreamLike`
/ container-adapter structural type — so the parser worker composes it exactly like `openGcode3mf`, with
`containers: 'auto'` sniffing it. **Single payload, no `openPlate`** (no multi-plate). Discovery vs. decode
may collapse into one call since there is only one payload (unlike 3mf's discover-then-openPlate).

### 4.3 D3 — Codec sourcing (the RR-003 constraint) [decision]
| Codec | Strategy | Basis |
|---|---|---|
| DEFLATE | reuse `DecompressionStream` | already used by the ZIP reader |
| CRC32 | reuse `crc32`/`crc32Final` | MIT, ours |
| **heatshrink** | **port the ISC decoder to TS, preserving the ISC notice** | ISC permits; safest for a fiddly LZSS bit-stream |
| **MeatPack** | **clean-room from the algorithm; source the nibble table cleanly** | AGPL forbids copying |
| block walker / sniff | new, clean-room from the spec | spec is an interface |

The DEFLATE flavor (`'deflate'` zlib vs `'deflate-raw'`) is **resolved empirically** in phase 1 against a
real file (the ZIP path uses `'deflate-raw'`; bgcode may differ). Recommended: **D3 as tabled.**

### 4.4 D4 — Decode model
Walk blocks in file order. For each **GCode block**: (compressed?) decompress `compressedSize`→
`uncompressedSize` via the block's compression ID; (encoded?) MeatPack-decode; append the ASCII G-code.
Concatenate all GCode blocks → one plain-G-code buffer → the **existing** parser/dialect/IR stack. **File/
Printer/Print/Slicer Metadata** (INI) and **Thumbnail** blocks feed the existing sink
(`MachineGeometry`, thumbnails) — same honesty/capability rules as the dialect adapters. Metadata/
thumbnail surfacing is **in-scope (maintainer amendment 2026-07-27), not deferred** — it lands with the
container-adapter integration (§14 phase 4), reusing the existing sink plumbing rather than as a later
optional add-on.

### 4.5 D5 — Security & honest rejection (DD-003 §7 + a §7.3 review)
- **Pin & reject:** file version ≠ 1, checksum type ∉ {0,1}, block type/compression/encoding outside the
  spec enums → a structured `ContainerError` (honest), never a guess.
- **CRC32 verify** every block when the header declares CRC32; a mismatch is a hard, structured failure.
- **Bounded output on EVERY decompressor** — heatshrink/DEFLATE/MeatPack all clamp to
  `uncompressedSize` and the `ContainerLimits` expanded-size cap (decompression-bomb defense); a stream
  that exceeds its declared size is truncated-and-errored, never allowed to balloon.
- **No fs / no net**, in-memory only (lint-enforced, as with `gcode-containers`).
- A **§7.3-style security review sign-off is a gate** (as DD-005 required for containers), covering the
  adversarial corpus below.

### 4.6 D6 — Testing strategy
- **Killer test (golden-equivalence):** slice one trivial model both ways; assert the **decoded-`.bgcode`
  IR equals the plain-`.gcode` IR** — decode correctness pinned against the trusted path, per
  compression×encoding combination.
- **Codec vectors:** heatshrink (from the ISC test vectors) and MeatPack (derived + validated) unit vectors.
- **Adversarial corpus:** truncated block, bad CRC, unknown compression/version, oversized/mislabeled sizes,
  decompression bomb — bounded failure, never a crash or unbounded allocation.
- **Benchmark:** decode throughput / time-to-first-parse.
- **Fixtures self-generated** from PrusaSlicer (plain + `.bgcode` pairs) — redistributable, no third-party
  copyright, no private corpus (RR-003 §4).

### 4.7 D7 — Worker registration (DD-003)
`gcode-bgcode` joins the **batteries** worker entry's container adapters (so `.bgcode` "just works"); an
**optional slim** entry omits it. `DecompressionStream` availability in the worker context is confirmed in
phase 1 (browsers + Node ≥ 18); any environment lacking it degrades to an honest `unavailable`, not a crash.

## 5. Lifecycle

`openBgcode` runs entirely in-memory during the parse: sniff → walk blocks → decode → emit plain G-code to
the existing parser session; nothing persists, no handles outlive the call. Decoders are pure functions of
`(input, declaredSizes, params)`; the block walker owns bounds/offset state and never reads past the buffer.

## 6. Errors & failure behavior

All failures are structured `ContainerError`s (reusing the `gcode-containers` error type), bounded and
non-throwing at the pipeline boundary: unknown version/codec/encoding, CRC mismatch, truncated/overflowing
block, or a decompressor exceeding its declared/limit size. Partial/streaming behavior follows DD-003 —
a corrupt tail yields a bounded partial preview + a warning, never a hang or an unbounded read.

## 7. Security & resource limits

Untrusted binary input is the whole threat model. Defenses (D5): magic/version/enum pinning; per-block
CRC32; **bounded output on every decompressor** clamped to `uncompressedSize` and `ContainerLimits`; strict
offset/bounds checks in the walker; no fs/net; in-memory only. The heatshrink port and MeatPack decoder get
dedicated fuzz targets (the Jazzer pattern from E7 #131). The §7.3 review signs off before epic exit.

## 8. Performance

Budget derived in implementation against a real `.bgcode` corpus: decode throughput and time-to-first-parse
vs. the equivalent plain `.gcode`. Decoding is a linear pass with per-block decompression; the target is
that `.bgcode` decode + parse stays within a small constant factor of plain-`.gcode` parse (it trades I/O
size for CPU). No new per-segment memory — output is plain G-code the existing parser already handles.

## 9. Testing

Per D6: the golden-equivalence killer test (per codec combo), heatshrink/MeatPack vectors, the adversarial
corpus + fuzz targets, and a decode benchmark. Fixture manifest additions: `test-data/fixtures/bgcode/*`
(plain+`.bgcode` pairs, one per compression×encoding; adversarial set), all self-generated and
redistributable. `pack:check`/boundary tests updated for the new package.

## 10. Migration

Purely additive — a new optional input format behind `containers: 'auto'`. No IR, renderer, adapter, or
public-API change to existing packages; consumers gain `.bgcode` support by upgrading. The new package is
lockstep-versioned; batteries worker gains an adapter, slim stays lean.

## 11. Observability / diagnostics

Bounded warnings: unknown-but-skippable metadata blocks, a CRC/type mismatch (with block index + offset,
no raw payload), decoder truncation. A `container` capability/metadata entry records that decode happened
and which codecs were seen — privacy-preserving (counts/enums only, no local paths).

## 12. Alternatives considered

- **Vendor / link / WASM-compile `libbgcode`.** Rejected — AGPL-3.0 relicenses our MIT stack (RR-003 §6).
  It stays a *verification* oracle only.
- **Copy/translate OctoPrint-MeatPack.** Rejected — AGPL. Clean-room the algorithm.
- **Clean-room heatshrink too.** Rejected as needless risk — ISC already permits a license-clean port, and
  hand-rolling LZSS invites subtle bit-stream bugs.
- **Fold bgcode into `gcode-containers`.** Rejected — keeps the ZIP/3mf and bgcode surfaces, fixtures, and
  fuzzers independently auditable/versioned; they share only small primitives (reused via dependency).
- **A dialect adapter instead of a container adapter.** Rejected — the DD-005 sink cannot restructure bytes;
  decoding a binary container is exactly the container-adapter role.

## 13. Risks

- **Licensing contamination (AGPL/GPL)** → clean-room mandate + the ISC-only port rule + a license line in
  the RR/DD; reviewer checks provenance of the heatshrink port and MeatPack table at DD/PR review.
- **heatshrink/MeatPack correctness** → published/derived vectors + the golden-equivalence killer test +
  bounded output; fuzz targets.
- **Spec/version drift** → pin v1, reject unknowns; revisit by amendment when Prusa bumps the format.
- **DEFLATE flavor mismatch** → resolved empirically in phase 1 before building on it.

## 14. Phased delivery (mirrors the #188 epic plan)

1. **Block walker + CRC + codec dispatch** — DEFLATE + None end-to-end → parser (resolves the DEFLATE
   flavor + `DecompressionStream`-in-worker unknowns).
2. **MeatPack decoder** (clean-room) + vectors.
3. **heatshrink decoder** (ISC port + attribution) + bounded-output guard + vectors.
4. **Container-adapter integration** + the **golden-equivalence killer test** + **metadata/thumbnail
   surfacing** (in-scope per the D4 amendment).
5. **Adversarial corpus + §7.3 security review** + decode benchmark + matrix/README.
6. **Epic exit.**

## 15. Acceptance criteria

- [ ] A real `.bgcode` (each of DEFLATE/heatshrink × None/MeatPack/MeatPack-comments) decodes to an IR
      **equal** to the plain-`.gcode` IR (golden-equivalence).
- [ ] heatshrink and MeatPack pass their unit vectors; the heatshrink port carries the **ISC notice**.
- [ ] **No AGPL/GPL code** is present in any `@chestnutlabs/*` package (provenance reviewed).
- [ ] Unknown version/compression/encoding, bad CRC, truncated, and decompression-bomb inputs fail as
      **bounded structured errors** — no crash, no unbounded allocation; fuzz targets green.
- [ ] `containers: 'auto'` sniffs and decodes `.bgcode` in the batteries worker; the slim worker omits it.
- [ ] A **§7.3 security review is signed off**; decode benchmark recorded.
- [ ] No core package depends on AnyBridge; the decoder is in-memory, no fs/net.

## Decision log

| Date | Note | Source |
|---|---|---|
| 2026-07-27 | DD-011 drafted as **Draft**; D1–D7 open. Follows [RR-003](../research/RR-003-bgcode-licensing-and-format-audit.md): `.bgcode` v1 is a container of plain G-code; `libbgcode`/MeatPack are **AGPL** (reference/verify only), heatshrink is **ISC** (port + attribution). Proposes a new `@chestnutlabs/gcode-bgcode` container adapter (sniff/open beside `.gcode.3mf`), reusing DEFLATE/CRC32/limits, porting heatshrink, clean-rooming MeatPack + the block walker; gated by bounded-output guards, version/codec pinning, the plain-vs-`.bgcode` golden-equivalence killer test, and a §7.3 security review. Numbered DD-011 (reserved for #188 by the DD-010 sibling triage). | Chestnut Labs |
| 2026-07-27 | **Accepted — D1–D7 as recommended, D4 amended.** Metadata/thumbnail surfacing is **in-scope, not deferred** (lands with the container-adapter integration, reusing the sink). All other decisions stand. Implementation unblocked on the §14 phasing (1: walker + CRC + DEFLATE/None → parser; 2: MeatPack; 3: heatshrink ISC port; 4: integration + golden-equivalence + metadata/thumbnails; 5: adversarial corpus + §7.3 review + benchmark; 6: exit). | Maintainer (Chestnut Labs) |
