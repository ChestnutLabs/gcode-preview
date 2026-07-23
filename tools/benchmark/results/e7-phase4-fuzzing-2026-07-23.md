# E7 phase 4 — container fuzzing evidence (2026-07-23, #131)

Discharges the DD-005 §7.3 residual-risk item (coverage-guided fuzzing before public release).

## Setup

- **Engine:** Jazzer.js (libFuzzer for Node, genuinely coverage-guided). Installed on demand
  (`--no-save` locally, `npm install --no-save` in the scheduled workflow) — not a committed
  dependency, so it never enters a published tarball.
- **Targets** (`packages/gcode-containers/fuzz/`): `readDirectory` (sync) and `streamEntry`
  (async, every entry fully drained under a 1 MiB cap). Both run under tight `FUZZ_LIMITS` so
  the fuzzer reaches limit-enforcement paths fast and no input can allocate meaningfully.
- **Property:** attacker bytes may only ever produce a typed `ContainerError`; any other throw
  or a process crash is a finding.

## Result

| Target | Local smoke | Outcome |
|---|---|---|
| readDirectory | ~101k runs / 21 s | no finding |
| streamEntry | seeded run | **1 finding (fixed)** |

**Finding (fixed this phase):** on corrupt deflate data, `DecompressionStream` errors both ends of
the stream; the reader path converted its copy to `E_CONTAINER_INFLATE`, but the writer-side
promise was unawaited and surfaced as an **unhandled rejection that crashed the process**. Fix:
capture the writer promise instead of floating it, and re-raise it as `E_CONTAINER_INFLATE`
(`zip.ts` `streamEntry`). Minimized to a 119-byte deterministic ZIP
(`test-data/fixtures/fuzz-regressions/deflate-corrupt-stream.zip`), proven to crash pre-fix and
raise a typed error post-fix.

## Cadence

- **Per PR:** `fuzz-corpus.test.ts` replays the whole regression corpus in the containers unit
  suite (fast, deterministic) — every input handled with only typed errors, process never crashes.
- **Weekly:** `.github/workflows/fuzz-containers.yml` (Mondays + manual dispatch) runs each target
  for 900 s over the seeded corpus and uploads any new crash artifact for private triage.

## Fallback (recorded per DD-008 §4.7)

If Jazzer proves unworkable on CI runners, `fast-check` property-based harnesses are the documented
fallback; the corpus-replay gate is engine-independent and works either way.
