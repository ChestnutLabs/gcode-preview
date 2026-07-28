# E8 Low-Resource 2D Renderer Benchmark — DD-014 §8 (issue #215)

**Date:** 2026-07-26 · **Package:** [`@chestnutlabs/gcode-renderer-2d`](../../../packages/gcode-renderer-2d)
· **Harness:** [`tools/demo/bench.html`](../../demo/bench.html) + [`tools/demo/src/bench.js`](../../demo/src/bench.js)
driven by the headless-Chrome recipe in §4 below.

**Machine (measured target):** Linux test host — Ubuntu 24.04 (kernel 6.8), **Intel Core i5-6500**
(4 cores @ 3.2 GHz), 15 GiB RAM, **Google Chrome 150** headless. This is a **desktop-class** host, not
a low-end embedded device; to approximate the low-resource class the redraw budget is also measured
with Chrome's CPU throttling at **4×** and **6×** (≈ SBC / embedded-touchscreen class). The §8 budgets
are met with wide margin at every tier — a genuinely low-end AnyBridge target can be pinned later by
re-running the same harness on that device.

**Fixture:** `test-data/gcodes/calicat.gcode` (635 KB) → **174 layers, 16,778 segments**, parsed in
**155 ms** (worker parser). Color mode: color-by-speed with 1 dimmed adjacent "ghost" layer.

## 1. §8 budget results

| §8 budget | Target | Measured | Verdict |
|---|---|---|---|
| **Layer-change redraw** (interaction) | ≤ 16 ms (60 fps) | **0.2 ms median / 0.4 ms p95 / 1.8 ms max** (1×, +ghost) | **PASS** |
| Layer-change redraw @ **4× CPU throttle** | ≤ 16 ms | **0.7 ms median / 1.5 ms p95 / 2.6 ms max** | **PASS** |
| Layer-change redraw @ **6× CPU throttle** (SBC-class) | ≤ 16 ms | **0.9 ms median / 2.5 ms p95 / 3.6 ms max** | **PASS** |
| **Renderer memory ceiling** (bounded to active ± adjacent layer) | no per-layer growth | **+0.02 MB** heap over **870 renders** (5 full 174-layer sweeps): 3.77 → 3.79 MB used | **PASS** |

Redraw times are per `setLayer` + `render` across **all 174 layers** (sorted); "+ghost" = the default
`adjacentLayers: 1` (draws the active layer over one dimmed preceding layer). Without ghosts the median
is 0.1 ms. Even at 6× CPU throttle the p95 is ~6× under the 60 fps interaction budget.

## 2. Memory: bounded to the active layer (DD-014 §6/§7)

The 2D renderer draws **straight from the IR's structure-of-arrays** — unlike the 3D renderer it builds
**no per-layer geometry buffers**. The probe renders the whole 174-layer model **5 times (870 draws)**
and the JS heap moves **3.77 → 3.79 MB (+0.02 MB)** — i.e. no accumulation with layer count or redraw
count. Peak working set stays near one layer's segments regardless of model size, which is the point of
the low-resource mode. (The parsed `ToolpathIR` itself is the whole-model cost, shared with the 3D
renderer and produced once by the worker parser — not attributable to the 2D view.)

## 3. Capability honesty (DD-014 §6/§11)

The flat top-down view cannot represent non-XY/CNC toolpaths or 3D-only options. It **discloses** rather
than fabricates: `describe2DDisclosures(ir)` (surfaced by `LayerView2DRenderer` on the controller's
`renderer-unsupported` channel) emits a note when `capabilities.layers` is `unavailable` (non-planar /
CNC — the parser puts every move on layer 0, so the 2D view shows them all in one flat frame) or
`inferred`. 3D-only requests (camera projection, quality modes) on the 2D view are likewise disclosed,
never faked. Covered by unit tests in `gcode-renderer-2d` and `gcode-preview-core`.

## 4. Reproducing (headless recipe)

`bench.html` exposes `window.__meta`, `window.__bench(adjacentLayers)`, `window.__memProbe()`, and
`window.__setLayer(i)`. Serve the demo (`npm run dev --prefix tools/demo`, port 5199) and drive
`http://localhost:5199/bench.html` with any headless browser. The numbers above were collected with
`puppeteer-core` against the system Google Chrome; precise memory needs Chrome launched with
`--enable-precise-memory-info --js-flags=--expose-gc`. CPU-throttle tiers use the CDP command
`Emulation.setCPUThrottlingRate({ rate })`.

## 5. Verdict

**All DD-014 §8 budgets PASS** on the measured target, with 4×/6× CPU-throttle passes approximating the
low-resource class (all comfortably within the 16 ms interaction budget). The memory-ceiling claim —
bounded to the active layer, no per-layer geometry — is demonstrated (near-zero heap growth over 870
redraws). E8's low-resource promise holds; pinning a specific low-end AnyBridge device is a re-run of
this harness, not new work.
