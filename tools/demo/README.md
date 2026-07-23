# G-code viewer demo (DD-004 phase 3, issue #58)

The first end-to-end demo of the Chestnut pipeline: **`GcodeParseSession`** parses off-thread in the
package's default module worker (zero-copy IR transfer) and hands the `ToolpathIR` to
**`ToolpathRenderer`** (incremental chunk upload, draw-range layer clipping and scrub, capability-honest
color modes, decimation disclosure). Built on the consumer-smoke Vite harness pattern
(`tools/consumer-smoke/vite-app`) — the packages are consumed via `file:` installs exactly as an
external consumer would.

![The showcase rendering 3DBenchy as tubes with feature coloring](../../docs/media/viewer-benchy-tubes.png)

```sh
cd tools/demo
npm install
npm run dev     # http://localhost:5199
```

The fixture picker serves the inherited MIT demo corpus (`test-data/gcodes/`, tracked in
`test-data/manifest.json`) via Vite's `publicDir` — nothing is copied or duplicated. Any local
G-code file can be loaded through the file input (parsed as a `Blob` through the same worker path).

## Keyboard operability (master plan §9.5)

Every control is labeled and tab-reachable; the sliders take arrow and page keys natively.
App-level shortcuts (active when focus is not inside a form control):

| Key | Action |
|---|---|
| `[` / `]` | last visible layer − / + |
| `,` / `.` | scrub − / + (1% steps) |
| `t` | toggle travel moves |
| `f` | frame the model |

## Visual regression + GL benchmarks (`vr.html`, issue #61)

`http://localhost:5199/vr.html` hosts the E3 harness (governance §10.2): deterministic corpus renders
at a fixed camera in both quality modes, compared against `src/vr-baseline.json` (16×16 grayscale grid
+ lit-ratio, tolerances: grid ≤ 10/255, lit ± 0.05); baseline PNGs live in
`test-data/visual-baselines/`. Run `vrRun()` in the console for the compare, `perfRun()` for the
GL-side §8 measurements (orbit fps, real build-tick stalls) — **the two §8 fps budgets are ratified on
a reference machine with hardware GL**, not in virtualized panes. To regenerate baselines after an
intentional visual change: run `vrRun()`, then save `window.vrResults.captures` (metrics → the JSON,
PNG dataURLs → the baseline directory) and commit both with the change that caused them.

## Honesty behaviors to look for

- **Decimation disclosure:** on IRs over the §4.4 thresholds a yellow notice states the exact
  reduction factor and that travel is hidden — degradation is never silent.
- **Capability gating:** the "By feature role" color mode is disabled (with the reason) when the IR
  reports `featureRoles: unavailable` — the current parser does, so the option shows *why* rather
  than rendering fabricated colors.
- **Partial results:** a limit-bounded parse renders what was produced and labels it
  `INCOMPLETE` with the structured `stopReason`.
