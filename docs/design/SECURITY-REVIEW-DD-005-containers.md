# Security Review Record — DD-005 §7.3 Container Extraction

**Scope:** `@chestnutlabs/gcode-containers` v1 (`.gcode.3mf`, issue #74)
**Status:** **Implementation complete — AWAITING MAINTAINER SIGN-OFF** (the E4 gate requires it)
**Prepared:** 2026-07-23 · **Reviewer:** _pending_

Checklist from DD-005 §7.3, with implementation + evidence for each item. Evidence tests live in
[`packages/gcode-containers/src/__tests__/gcode-3mf.test.ts`](../../packages/gcode-containers/src/__tests__/gcode-3mf.test.ts)
and [`packages/gcode-parser/src/__tests__/containers-integration.test.ts`](../../packages/gcode-parser/src/__tests__/containers-integration.test.ts);
the adversarial corpus is generated deterministically by
[`tools/fixtures/make-gcode-3mf.mjs`](../../tools/fixtures/make-gcode-3mf.mjs) and tracked in
`test-data/manifest.json` (sha256).

| # | §7.3 item | Implementation | Evidence | Status |
|---|---|---|---|---|
| 1 | Adversarial corpus: truncated CD, hostile names (`../`, absolute, drive letter, NUL), bomb-style lies, duplicates, encrypted | 8-fixture corpus (`test-data/fixtures/containers/adv-*`), each asserting its exact structured outcome | corpus tests, all green | ☑ implemented |
| 2 | Per-entry **CRC32** (streaming) | `crc32`/`crc32Final` accumulated per chunk; verified at end-of-stream and in `extractEntry` | `adv-bad-crc` → `E_CONTAINER_CRC` (unit + through the session) | ☑ implemented |
| 3 | **Central/local header agreement** (name, method, sizes, CRC) | `locatePayload()` compares every field; disagreement → entry treated as hostile | `adv-header-mismatch` → `E_CONTAINER_HEADER_MISMATCH`; `adv-size-lie` (patched size fields) caught at end-of-stream | ☑ implemented |
| 4 | **Encrypted-entry rejection** | flag bit 0 checked in both headers; no decryption path exists | `adv-encrypted` → `E_CONTAINER_ENCRYPTED` | ☑ implemented |
| 5 | **Duplicate canonical names** | case-folded/normalized names; payload duplicate → `E_CONTAINER_DUPLICATE`; metadata duplicate → first-CD-wins + warning | `adv-duplicate-plate` | ☑ implemented |
| 6 | Every §7.2 **limit enforced incrementally** | `maxEntries`/`maxEntryNameBytes` at directory parse; per-entry + total expanded caps enforced per inflate chunk (a lying header cannot balloon memory); `maxMetadataBytes` before metadata extraction | limits test (`maxEntries:1`, `maxExpandedBytesPerEntry:100`) | ☑ implemented |
| 7 | **Entry-name validation** even though extraction is in-memory | `canonicalName()` rejects NUL/traversal/absolute/drive-letter names; hostile names skipped with warnings, never dereferenced | `adv-traversal-names` | ☑ implemented |
| 8 | **No filesystem writes** anywhere in the package | in-memory design; **lint-enforced**: `.eslintrc.js` forbids `fs`/`child_process`/`net`/`http` imports in `packages/gcode-containers/src` (tests exempt — they read committed fixtures) | lint rule + review | ☑ implemented |
| 9 | Metadata parsers **bounded + exception-contained** | `project_settings.config` capped at `maxMetadataBytes`, JSON parse in try/catch → `container-metadata-invalid` warning, values whitelisted + length-clamped | discovery test; malformed-JSON path covered by containment code | ☑ implemented |
| 10 | Thumbnails surfaced as **opaque bytes only** | no decode anywhere; caps defined (`maxThumbnailBytes` in DD §7.2) — extraction itself deferred to phase 3 (Bambu thumbnails) | n/a in v1 payload | ☑ n/a-v1 |
| 11 | zip64 | detected → `E_CONTAINER_ZIP64` structured rejection (v1 scope per amendment 3) | directory-parse checks | ☑ rejected-by-design |

**Residual risks / notes for the reviewer**
- Fuzzing is corpus-based (crafted adversarial archives), not coverage-guided; a coverage-guided fuzz
  pass over `readDirectory`/`streamEntry` is recommended before any public release (E7 gate).
- `DecompressionStream` is platform code (browser/Node) — inflate bombs are bounded by our
  incremental caps, not by trusting the platform.
- Data-descriptor entries (flag bit 3) accept the central directory's sizes/CRC as authoritative;
  the local header carries zeros in that mode and is not treated as a mismatch.

**Sign-off:** _maintainer signature + date pending — required before E4 exit (DD-005 §15)._
