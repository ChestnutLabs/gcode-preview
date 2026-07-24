# E6 Multi-Framework Integration — DD-007 exit evidence (2026-07-23)

Evidence for the DD-007 §15 acceptance criteria across the eight delivered phases
(#104–#108, #112–#114; PRs #110, #116, #117, #119–#122), including the D1 amendment
(first-class Vue/React/Svelte adapters over the shared engine).

## Capability-parity table (D1 amendment: equivalent capabilities, no drift)

| Capability | Vue (`-vue`) | React (`-react`) | Svelte (`-svelte`) |
|---|---|---|---|
| Ready-to-use component (`:source`-only thin path, D4) | `<GcodePreview>` (render-fn TS) | `<GcodePreview>` (forwardRef TS) | `GcodePreview.svelte` (raw-shipped, consumer-compiled) |
| Lower-level surface | `useGcodePreview` composable | `useGcodePreview` hook (`useSyncExternalStore`) | `createGcodePreview` store/action (`$`-auto-subscription) |
| Full defaulted prop surface (source/parseOptions/buildVolume/quality/colorMode/tube/layerRange/scrub/showTravel/progress/createWorker) | ✔ | ✔ | ✔ |
| Events/callbacks (ready, parse-*, build-complete, quality-fallback, machine-geometry-*, progress-presentation-changed, disclosure, error) | Vue emits | `onX` callbacks | dispatched events |
| Worker config (D2: batteries default + `createWorker`) | ✔ | ✔ | ✔ |
| DD-005 consumer-wins bed precedence | ✔ | ✔ | ✔ |
| DD-006 progress chain (observe/tick/clear → presentation) | ✔ | ✔ | ✔ |
| Shared TS contracts **re-exported** (never redeclared) | ✔ | ✔ | ✔ |
| **Shared behavioral suite** (6 parity tests via `gcode-preview-core/testing`) | **pass** | **pass** | **pass** |
| Separate example application (Vite; D2 default worker; live-verified in-browser) | `tools/demo/vue.html` | `tools/example-react` (`<StrictMode>`) | `tools/example-svelte` |
| Framework-specific safety | scope dispose/HMR, SSR-import | StrictMode dispose/recreate + canvas rebind (test-locked) | store contract (immediate emission) test |

Structural guarantee: all three adapters are reactivity bridges over
`@chestnutlabs/gcode-preview-core`'s `createPreviewController` (immutable-snapshot state model);
per-package boundary lint forbids framework cross-imports, direct three, dialects/containers,
node modules, and AnyBridge.

## §8 evidence

**Bundle size (budget: wrapper ≤ 10 kB min+gz each; deps/engine externalized):**

| Package | min | min+gz | Verdict |
|---|---|---|---|
| gcode-preview-core (controller) | 4.4 kB | **1.8 kB** | PASS |
| gcode-preview-vue (composable + component) | 3.6 kB | **1.4 kB** | PASS |
| gcode-preview-react (hook + component) | 3.4 kB | **1.4 kB** | PASS |
| gcode-preview-svelte (store/action TS surface) | 0.5 kB | **0.3 kB** | PASS |
| `GcodePreview.svelte` (raw, consumer-compiled) | 4.7 kB source | 1.8 kB gz | (compiled in-app) |

The entire multi-framework glue layer is < 5 kB min+gz combined — the wrapper adds no
meaningful weight over the engine (three/parser/renderer dominate, unchanged).

**Leak/mount-cycle stability (test-locked, not one-off):** Vue 50-cycle HMR test; the shared
suite's 10-cycle dispose test runs in core + all three adapters; React StrictMode
double-mount asserts created == terminated AND a live renderer; the consumer fixture repeats
the 10-cycle check against the packed tarballs in CI.

**No per-frame wrapper overhead:** adapters subscribe to snapshot replacements only (summaries
of numbers/strings); typed arrays never enter any framework's reactivity (asserted in Vue via
`isReactive`, structurally elsewhere — snapshots simply do not contain them).

## Reproducible consumer resolution (D3)

`tools/consumer-vue` in CI: packs all 7 tarballs fresh, installs into the committed-lockfile app,
asserts every `@chestnutlabs` package resolved from local tarballs (never a registry), then runs
contract tests incl. a REAL worker parse (dialect annotation + bed discovery + DD-006 mapping)
through the installed artifacts. Two real packaging bugs were caught by this gate before any
consumer could hit them (alphabetical workspace build order; tarball-integrity lockfile pinning).

## Real bugs caught by the parity machinery (why the D1 amendment paid for itself)

1. React handle identity churn → ref detach/reattach → renderer rebuild loop (behavioral suite).
2. React StrictMode recreate left the controller canvas-less → black canvas (live example;
   now a locked renderer assertion).
3. The renderer package's index had never exported the phase-3 overlay types — found by the
   first out-of-repo consumer (the Vue package build).

## Test totals

Root 288 · toolpath-core 55+ · parser/renderer/dialects/containers unchanged · preview-core 8 ·
vue 24 · react 8 · svelte 7 · consumer fixture 3 (CI). All suites green; CI green on every phase
merge.

## Deferred (accumulating reference-machine list, non-blocking)

Unchanged from E5: E3 orbit-fps `perfRun()`, E4 adapter-overhead figure, E5 GPU ghost-overdraw.
No new GPU-dependent items from E6 (the adapters add no rendering).
