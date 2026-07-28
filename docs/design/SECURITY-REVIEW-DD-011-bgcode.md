# Security Review Record — DD-011 §7 Binary G-code (`.bgcode`) Decode

**Scope:** `@chestnutlabs/gcode-bgcode` v1 (`.bgcode` decode, epic #188)
**Status:** **SIGNED OFF** (2026-07-28) — granted by the maintainer as part of the epic #188
acceptance (DD-011 §15 gate; epic closed 2026-07-28), as was done for DD-005 §7.3.
**Prepared:** 2026-07-27 · **Preparer:** Chestnut Labs · **Signed off:** 2026-07-28

Untrusted **binary** input is the entire threat model: a `.bgcode` file is attacker-controlled bytes
that must decode to G-code without a crash, an unbounded read/allocation, a hang, or any code /
filesystem / network effect. Every checklist item below has an implementation and evidence. Evidence
tests: [`packages/gcode-bgcode/src/__tests__/adversarial.test.ts`](../../packages/gcode-bgcode/src/__tests__/adversarial.test.ts)
(deterministic fuzz), the codec vectors (`meatpack.test.ts`, `heatshrink.test.ts`), the rejection cases
in `bgcode.test.ts`, and the real-file golden-equivalence (`golden-equivalence.test.ts`).

| # | §7 item | Implementation | Evidence | Status |
|---|---|---|---|---|
| 1 | **Adversarial/fuzz corpus** — random bytes, `GCDE`-prefixed random, bit-flip mutations of a real file, garbage compressed payloads through every codec | deterministic (seeded mulberry32) fuzz: ~1600 inputs × 3 entry points; only bounded `ContainerError`s may escape | `adversarial.test.ts`, all green | ☑ implemented |
| 2 | **Version / magic / enum pinning + honest rejection** | magic must be `GCDE`; version must be 1; checksum type ∈ {0,1}; unknown compression/encoding IDs → structured error, never a guess | `E_BGCODE_MAGIC`/`_VERSION`/`_CHECKSUM`/`_UNSUPPORTED_*` cases | ☑ implemented |
| 3 | **Per-block CRC32** | when the file declares CRC32, every block's header+params+data is verified (`crc32`/`crc32Final`); a mismatch is a hard failure | `E_BGCODE_CRC` unit + verified on the real 856-block XL file (all pass) | ☑ implemented |
| 4 | **Bounded output on EVERY decompressor** (None/DEFLATE/heatshrink/MeatPack) | each decode is clamped to the block's declared `uncompressedSize` **and** a global `maxOutputBytes` cap; exceeding either → `E_BGCODE_BOMB`; a size mismatch → `E_BGCODE_SIZE` | bomb tests per codec; oversized-declared-size test | ☑ implemented |
| 5 | **Strict offset/bounds in the block walker** | every field/data/CRC read is bounds-checked before access; any short read → `E_BGCODE_TRUNCATED`; the walker never reads past the buffer | truncation tests; fuzz corpus | ☑ implemented |
| 6 | **`DecompressionStream` unobserved-rejection guard** | the DEFLATE writer promise is captured, never floated — the exact #131 defect that crashed the process on corrupt deflate is pre-empted here | inflate implementation + fuzz (garbage deflate payloads) | ☑ implemented |
| 7 | **Metadata / thumbnail bounds** | metadata blocks decode through the same bounded decompressors then a linear INI parse (no growth); thumbnails are surfaced as **opaque bytes** (no image decode anywhere) | `adapter.test.ts` (metadata + thumbnails); fuzz with `metadata: true` | ☑ implemented |
| 8 | **No filesystem / process / network** | in-memory only; **lint-enforced** — `.eslintrc.js` forbids `fs`/`child_process`/`net`/`http` in `packages/gcode-bgcode/src` (tests exempt: they read committed fixtures) | lint rule + review | ☑ implemented |
| 9 | **Decode-only** (no write-side attack surface) | the package never encodes/writes `.bgcode`; the only writer (the test fixture assembler) is test-scoped | package surface review | ☑ by design |
| 10 | **Licensing hygiene** (no copyleft contamination) | clean-room from the spec; MeatPack ported from MIT `jamesgopsill/meatpack`, heatshrink from ISC `atomicobject/heatshrink` — attributions preserved; **no AGPL `libbgcode`/OctoPrint-MeatPack code** | RR-003; source headers | ☑ implemented |

**Residual risks / notes for the reviewer**
- The committed fuzz is **deterministic corpus + seeded random**, not coverage-guided. A Jazzer.js
  coverage-guided target over `openBgcode` — mirroring the `gcode-containers` fuzz harness
  (`packages/gcode-containers/fuzz/`, `.github/workflows/fuzz-containers.yml`) — is recommended before a
  public release, and would slot in beside the existing container fuzz job. **Follow-up, not a blocker.**
- `DecompressionStream` is platform code (browser/Node); DEFLATE bombs are bounded by our caps, not by
  trusting the platform. heatshrink/MeatPack are our own bounded ports.
- Real-file validation is done: a 21 MB Prusa XL ColorMix file (856 blocks, all CRC32 verified) and a
  cube golden pair (`decoded-.bgcode IR == plain-.gcode IR`, byte-identical) — see the epic PRs.

**Sign-off:** **Granted 2026-07-28** by the maintainer with the #188 epic acceptance (DD-011 §15); epic #188 closed.
