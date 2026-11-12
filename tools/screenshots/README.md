# Documentation media capture

Regenerates the screenshots in `docs/media/` used by the root README, the GitHub Pages site, and
the manual. **Every image is a real render of a real file from the tracked MIT demo corpus**,
produced by driving the actual `tools/demo` Feature Lab with a headless browser — nothing is mocked or
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
their own theme. The harness simply applies the doc theme via the public `controls.setTheme(...)`
before each capture. Intentional exceptions (transparency, dark/light themes, custom or independent
capture backgrounds) are captured deliberately as their own shots.

## The shot manifest

Every image is one entry in [`shots.manifest.json`](shots.manifest.json) — its source file,
render parameters, output class (`showcase` vs `feature-proof`), caption, and alt text, all in one
place. Add or adjust a shot there; keep the caption/alt honest about what the image shows.

| Field | Meaning |
|---|---|
| `page` | `toolpath` (Feature Lab), `canvas2d` (`2d.html`), `model` (`model.html`) |
| `class` | `showcase` (clean, README/homepage) or `feature-proof` (controls/legends/comparisons) |
| `file` | corpus path under `test-data/`, served by the demo (`gcodes/…`, `fixtures/…`); checked before the browser launches |
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

## App-UI shots (the application surface)

`capture.mjs` captures mid-grey capability **renders** (what the toolpath/model looks like).
[`capture-app.mjs`](capture-app.mjs) is its sibling for the actual **application surface** — the
Feature Lab's control/inspector rail, color-mode selector, tabs, diagnostics, and the Preview/Prepare
modes — in the shipped **studio-dark** chrome. These are the README/homepage/gallery images that must
show the *current* UI (e.g. `docs/media/app-control-panel.png`, `app-appearance`, `app-diagnostics`,
`app-prepare`). Manifest: [`app-shots.manifest.json`](app-shots.manifest.json).

```sh
npm run docs:shots        # all capability renders (capture.mjs)
npm run docs:shots:app    # all app-UI shots (capture-app.mjs)
node tools/screenshots/capture-app.mjs app-diagnostics   # one app shot
```

It composites the real render into the DOM (copy the live canvas → dataURL → viewport background →
screenshot), since `page.screenshot` can't grab a WebGL canvas without `preserveDrawingBuffer`. It
copies the **live** canvas rather than `controls.capture()`: capture()'s render-to-target readback is
in linear colour space (no sRGB output encoding), which would darken the mid-grey documentation
workspace to its linear value. So the viewport reads as the same mid-grey as the capability renders.
Run it against the
Feature Lab dev server (`:5199`) or the built static site (`DEMO_URL=http://localhost:5098/demos/feature-lab`
after `npm run docs:demos` + `node tools/docs/serve-site.mjs`).

## Live demos on Pages

[`tools/docs/build-demos.mjs`](../docs/build-demos.mjs) (`npm run docs:demos`) builds the Feature Lab
and the four framework examples and stages them into the Pages artifact under `docs-site/demos/*` with
a product-facing landing. It runs after `docs:build` in `docs-pages.yml`. Verify the built artifact
locally with `node tools/docs/serve-site.mjs` (`:5098`).

## How it works (and why)

- Toolpath shots use only the published controller the Feature Lab itself uses
  (`window.viewer.preview`): it fetches the corpus file and `parse()`s it, applies the shot's parameters
  with `controls.*`, and frames the camera through `getCameraState()` / `setCameraState()`. There are no
  renderer or simulator reach-ins.
- **Readiness** is the controller's own signal, not status text: `getState()` reports not parsing with
  segments and `getRenderStats()` is populated, and no `buildComplete` / `stage` event has fired for
  0.8 s. The quiet window restarts whenever the harness applies settings, because a rebuild they trigger is
  asynchronous.
- **Settings are applied until stable, then proven.** The Lab re-applies its own colour mode, theme and full
  layer range on every `buildComplete`, and the harness's own calls can trigger that rebuild. So the harness
  applies every setting, settles, and repeats until a whole round fires no further build (bounded at 6 rounds,
  then the shot fails). Geometry-rebuilding calls (quality, travel, bed, retractions…) run once per shot so the
  loop can converge. `getState()` does not expose colour mode or layer range, so the harness records the last
  value any caller wrote through the public controls and fails the shot if it differs from the shot's (colour,
  theme, lens, cage, travel, layer range) before capturing. Lab-default look (Studio) is replaced by the SDK
  default look: 50° lens, cage on.
- **Duplicate guard:** if two different shots produce byte-identical PNGs the run exits non-zero, because a
  setting was lost. Any failed shot also exits non-zero. The loop, the check and the duplicate finder live in
  `lib/stabilize.mjs` (unit-tested by `tools/screenshots-stabilize.test.mjs`).
- The image is `controls.capture()` at 2x the viewport's CSS size, so no canvas copy is needed.
  Animated shots capture each frame the same way. The full-page and diagnostics recipes are gone: the
  app-UI shots belong to `capture-app.mjs`.
- CNC/laser files have no extrusion, so their extrude-only bounds are empty — the harness frames
  them from travel-inclusive bounds instead.

Keep framing, viewport, and filenames stable when adding shots so the set reads as one system.

## Animation (temporal captures)

For features where the interaction *is* the point (scrub, progressive reveal), a shot with
`"output": "webm"` and an `"anim"` spec sweeps a temporal control across frames and encodes a small,
looping, muted **WebM** — embedded on the docs site as `<video autoplay loop muted playsinline>`.

```json
{ "name": "scrub-sweep", "output": "webm",
  "anim": { "kind": "scrub", "frames": 48, "fps": 16, "holdFrames": 10 } }
```

`kind` is `scrub` (segment draw-range) or `layers` (layer-range build-up); `holdFrames` repeats the
final frame so the loop pauses on the finished model. Encoding uses the Playwright-bundled ffmpeg
(auto-located; override with `FFMPEG_PATH`), which is a stripped `--disable-everything` build: it can
only **decode mjpeg/vp8** and **mux webm**, so frames are captured as **JPEG** and piped through
`image2pipe` → VP8 (no PNG decode, palette filters, or gif muxer exist — see `lib/browser.mjs`
`encodeWebm`). Reach for animation only when a static frame genuinely can't carry the feature.
