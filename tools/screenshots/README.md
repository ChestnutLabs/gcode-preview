# Documentation media capture

Regenerates the screenshots in `docs/media/` used by the root README, the GitHub Pages site, and
the manual. **Every image is a real render of a real file from the tracked MIT demo corpus**,
produced by driving the actual `tools/demo` app with a headless browser — nothing is mocked or
hand-edited. Regenerate whenever visible rendering behavior changes (see
[`docs/USER_FACING_DOCS_STYLE.md`](../../docs/USER_FACING_DOCS_STYLE.md) §8 and the
[Visual Feature Coverage Matrix](../../docs/VISUAL_FEATURE_COVERAGE.md)).

## The shared documentation presentation (mid-grey)

All renders use one canonical look defined in [`lib/presentation.mjs`](lib/presentation.mjs): a
neutral, medium-value **grey slicer/CAD-style viewport** (`DOC_BACKGROUND`), a subtle neutral grid,
and tuned palettes. It reads well against both bright and dark toolpaths and looks like the
environment people associate with slicers/CAM tools.

This is a **documentation/showcase setting, not a library default.** The renderer still ships a
transparent/unset background (`DEFAULT_THEME.background === null`) and consumers keep full control of
their own theme. The harness simply applies the doc theme via the public `renderer.setTheme(...)`
before each capture. Intentional exceptions (transparency, dark/light themes, custom or independent
capture backgrounds) are captured deliberately as their own shots.

## The shot manifest

Every image is one entry in [`shots.manifest.json`](shots.manifest.json) — its source file,
render parameters, output class (`showcase` vs `feature-proof`), caption, and alt text, all in one
place. Add or adjust a shot there; keep the caption/alt honest about what the image shows.

| Field | Meaning |
|---|---|
| `page` | `toolpath` (main demo), `canvas2d` (`2d.html`), `model` (`model.html`) |
| `class` | `showcase` (clean, README/homepage) or `feature-proof` (controls/legends/comparisons) |
| `file` | corpus path served by the demo (`gcodes/…`, `fixtures/…`) |
| `quality`, `color`, `layerRange`, `camera`, `view`, `progress`, `retractions`, `travel`, `frameContent`, `bedShape`, `withBed` | render parameters (see the runner for the full set) |
| `caption`, `alt` | documentation text — must pass the §8 "recognize the feature without the caption" test |

`color` is a compact spec (`{ "mode": "feature", "fallback": [...] }`); the runner expands palettes
from `lib/presentation.mjs`.

## Prerequisites

1. **Build the workspace packages** in dependency order so the demo can resolve them:

   ```sh
   for p in toolpath-core gcode-colors gcode-containers gcode-dialects gcode-bgcode \
            gcode-parser gcode-renderer-2d gcode-renderer-three gcode-model-renderer \
            gcode-preview-core gcode-preview-vue gcode-preview-react gcode-preview-svelte \
            gcode-preview-element; do
     npm run build -w @chestnutlabs/$p
   done
   ```

2. **Start the demo** (leave it running):

   ```sh
   cd tools/demo && npm install && npm run dev     # http://localhost:5199
   ```

3. **Install the capture dependency** (kept out of the repo dependency tree — this directory's
   `node_modules` is git-ignored):

   ```sh
   cd tools/screenshots && npm i playwright-core
   ```

4. **A Chromium.** The harness auto-locates a launchable Chromium from the Playwright browser cache
   (`%LOCALAPPDATA%/ms-playwright` on Windows, `~/.cache/ms-playwright` on Linux) and tries
   candidates in order, so a revision your OS won't execute falls through to the next one. Override
   with `CHROME_PATH` to force a specific binary.

## Run

```sh
node tools/screenshots/capture.mjs                          # every shot in the manifest
node tools/screenshots/capture.mjs viewer-benchy-tubes      # a subset by name
node tools/screenshots/capture.mjs cnc-cut-vs-rapid color-speed-calicat
```

Override the demo URL with `DEMO_URL` (default `http://localhost:5199`).

## How it works (and why)

- For each shot it navigates to the right page, selects the corpus file, parses, applies the shot's
  parameters via the demo's debug handle (`window.viewer.renderer`), applies the doc theme **last**
  so it wins, waits for `buildComplete` so it never captures a half-built model, frames with a
  consistent slightly-lower 3/4 camera, and renders.
- For canvas shots it copies the WebGL backing store into a 2D canvas and reads a PNG — the same
  deterministic technique as the repo's VR harness (`tools/demo/src/vr.js`), which avoids the
  compositor stall a live rAF loop causes for a full-page screenshot under headless SwiftShader. The
  one full-page shot (`app-control-panel`) freezes the GL frame into a static `<img>` first, then
  screenshots the DOM (real sidebar + frozen render).
- CNC/laser files have no extrusion, so their extrude-only bounds are empty — the harness frames
  them from travel-inclusive bounds instead.

Keep framing, viewport, and filenames stable when adding shots so the set reads as one system.

## Animation (temporal captures)

For features where the interaction *is* the point (scrub, progressive reveal), the harness can
capture a frame sequence and encode it with the Playwright-bundled ffmpeg (auto-located; override
with `FFMPEG_PATH`). See `lib/browser.mjs` `resolveFfmpeg()`. Reach for animation only when a static
frame genuinely can't carry the feature — a single well-composed frame or a before/after pair is
usually clearer and cheaper.
