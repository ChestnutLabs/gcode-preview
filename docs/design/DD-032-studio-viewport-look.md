# DD-032 — Studio viewport look: plate, grid, backdrop, lens, and a model-viewer plate

**Status:** Accepted
**Authors/Owners:** Nathaniel Chestnut (owner), Claude Code (lead)
**Date:** 2026-11-10 · **Last revised:** 2026-11-10

> **Owner decisions (2026-11-10):**
> 1. **Look.** From the Round-1 comparison board (5 looks × light/dark × 4 filaments), the owner picked
>    **look C ("Studio") with look B's plate grid**, both themes. Round 2 rendered that combination through
>    the real `createBuildVolume` path and the owner gave the final OK on it.
> 2. **Grey-on-grey filament is accepted** (option a). A mid-tone plate always sits close to a mid-tone part.
>    The part still reads through shading, the contact shadow and its silhouette. Per-filament plate
>    auto-contrast is a later follow-up, not this DD.
> 3. **Opt-in preset, not a default flip** (decision 1, option a). Ship the look as a named `studio` preset.
>    `DEFAULT_THEME` stays byte-identical. Flipping the default is a later, separately-decided minor with
>    notice.
>    **+ One step further, adopted:** the Feature Lab, framework showcases and docs screenshots use the
>    Studio look from day one, so the public face matches the pick.
> 4. **The model viewer gets a plate in this release** (decision 2, option a), in all four adapters' `/model`
>    surfaces.
>    **+ One step further, adopted:** the model plate takes the **full** `BuildVolumeDef` (non-rectangular
>    `shape`, `min` offset, `excludedRegions`), not just a size, and also appears in **stills**
>    (`renderModelStill`, `capture()`), so a consumer's matched printer plate and its saved thumbnails match
>    the live view.
>
> Field names below are lead-proposed. They may be refined in lane review **without** changing the decisions
> above. Any rename is recorded in this DD's revision line.

**Owning Epic:** Viewport look + printer plates (AnyBridge discovery `viewport-environment-plates`) ·
**Milestone:** v0.22.0
**Supersedes / Superseded by:** none
**Related:** DD-004 (rendering), DD-009 D4 (bounded declarative theming, #153), #185 (bed surface), DD-018/021
(model renderer/viewer), DD-030 D3 (non-rect beds), DD-031 (framework parity), #462/#465 (sRGB bed texture)

---

## 1. Problem

The default viewport plate is nearly the same colour as the default dark background (`#2a2f3a` plate on a
`#2b3038`-ish page). On a light page it inverts into a dark hole. AnyBridge reproduced this in the real app:
with **"Build plate" ticked, no plate is visible** against the light canvas
(`viewer-plates-1280-en-after-back.png`, AnyBridge dev `8fd08f3ef`). The source-model viewer has **no plate at
all**, so a part floats in empty space. A consumer cannot fix any of this through the public theme. Today's
`Theme` has:

- **One grid tier only:** a single pitch and colour, and **no public opacity** (`gridOpacity` is a fixed
  `0.35`).
- **No outline on rectangular beds:** the bed outline loop is emitted only for non-rect `shape` beds.
- **A paper-thin plate:** a flat unlit plane, with no thickness or edge.
- **A solid background only:** no gradient.
- **No contact shadow.**
- **A fixed 50° lens** on the interactive viewers.

## 2. Scope and non-goals

**In scope (all additive):**

- The `Theme` additions in §4.1:
  - grid opacity and a major-grid tier
  - an outline on any bed shape
  - plate thickness and edge
  - a gradient backdrop
  - a contact shadow
- A camera lens option on both viewers, interactive and still.
- A plate on the source-model viewer, its controller and its stills.
- The `studioTheme(mode)` preset and `STUDIO_CAMERA_FOV`.
- Four-adapter parity, the Feature Lab, showcases, docs and screenshots.

**Non-goals:**

- Changing `DEFAULT_THEME`.
- Plate auto-contrast against filament colour (follow-up).
- Thick (> 1 px) lines: `Line2` or quads (follow-up).
- Vendor plate textures (trademark/copyright, #185 stance stands; a consumer may drape its own via
  `BedSurface.texture`).
- Printer-plate *matching*. That is consumer-side, and the renderer never fetches. AnyBridge owns the
  exact-name + printable-area rule validated in Round 1. The renderer only draws the geometry it is given.
- The 2D renderer: no 3D look concept. Parity answer: **not applicable**, documented.

## 3. Evidence

All evidence is lead-private scratch; this DD records the numbers.

**Round 1** (`round1-board/`, 46 cells): looks A (today) and B (sketch) fail the black+white × light+dark
test. C (Studio) holds every corner.

**Round 2** (`round2-cbgrid/`): C + B-grid, rendered through the real `createBuildVolume` at dev `be7a9dc`.

- **Tuning.** B's exact alphas lost about half their perceived strength (ΔL\*) on the `#7c8086` plate. They
  were re-solved to restore it, with colours unchanged.
- **Measured results:**

  | Measure | Dark | Light |
  |---|---|---|
  | Boundary vs plate | 3.18:1 | 3.35:1 |
  | Black/white filament vs plate | 2.9–4.0:1 | 2.9–4.0:1 |
  | Plate vs backdrop | 3.74:1 | 3.02:1 |

- **Grid:** reads in all 8 cells, including inside the contact shadow.
- **Weak filaments:** neutral `#8c94a3` is the weak cell (1.09:1, ΔE 5.2). Saturated `#e8631a` separates by
  hue only (decision 2).

## 4. Design

### 4.1 `Theme` additions (`gcode-renderer-three`, three-free, all optional)

```ts
type ThemeBackground = ThemeColor | null | { top: ThemeColor; bottom: ThemeColor };

interface Theme {
  // existing: background, gridColor, bedColor, hemisphereIntensity, directionalIntensity,
  //           materialPreset, bedSurface
  background?: ThemeBackground;        // + vertical gradient form
  gridOpacity?: number;                // [0,1]; was internal-only (fixed 0.35)
  gridMajor?: { every: number; opacity: number; color?: ThemeColor }; // mm; color defaults to gridColor
  bedOutline?: { opacity: number; color?: ThemeColor };               // any bed shape, rect included
  contactShadow?: { opacity: number };                                // soft footprint shadow at plate level
}

interface BedSurface {
  // existing: mode, color, opacity, texture
  thickness?: number;                  // mm; default 0 = today's flat plane
  edgeColor?: ThemeColor;              // slab side faces; default = color
}
```

Rules:

- **Unset ⇒ byte-identical.** Every new field unset reproduces today's scene exactly. The existing visual
  baselines and `scene.test.ts` expectations must stay green unmodified. This is the regression gate for every
  lane.
- **Validation.** Every new opacity (`gridOpacity`, `gridMajor.opacity`, `bedOutline.opacity`,
  `contactShadow.opacity`) must be finite and within [0, 1]. Otherwise `resolveTheme` throws a `TypeError`. Existing
  fields keep today's (unvalidated) behaviour.
- **Major grid.**
  - Lines are drawn at multiples of `every` from the bed minimum.
  - A minor line that coincides with a major line is **not** drawn, so alphas never double-blend. The Round-2
    numbers assume a single blend per line.
  - `every` must be a positive multiple of the minor pitch. Otherwise it is rejected with a clear `TypeError`,
    matching the repo's option-validation style.
- **Outline.**
  - `bedOutline` draws the printable boundary loop for **every** shape, rectangular included.
  - Its `renderOrder` is above the grid lines', so it always blends last and is the strongest line. This
    does not rely on its small z offset.
  - Rect beds whose size is not a multiple of the pitch get their true edge, not a "250 on a 256 bed" grid
    edge.
  - For non-rect beds, unset `bedOutline` keeps today's loop: grid colour, opacity +0.3.
- **Slab.**
  - With `thickness > 0` the plate becomes a slab whose **top face keeps today's height (z = −0.05) and stays
    unlit**, so the top renders exactly `BedSurface.color` and the measured contrasts hold.
  - The side faces are a sibling mesh (`bedSurfaceEdge`), unlit, in `edgeColor`. The top face stays the
    existing `bedSurface` mesh.
  - Both keep `depthWrite:false`, so toolpath at z≈0 is never occluded. Draw order is explicit: walls at
    `renderOrder:-2`, top face at `-1`. three sorts opaque objects by `renderOrder` then distance, so
    insertion order is not relied on.
  - Non-rect beds extrude their shape.
  - A texture applies to the top face only, sRGB per #465.
- **Gradient.**
  - Implemented as an sRGB `DataTexture` scene background: a 1×256 vertical ramp computed in JS and
    interpolated in sRGB, like a CSS gradient. Row 0 is the bottom. It needs no DOM or OffscreenCanvas, so it
    works in workers and headless and is testable as literal bytes. It is disposed on theme change; a
    texture-leak test is mandatory (A4 defect #2 in discovery).
  - `capture({ background:'transparent' })` still yields a cutout, unchanged.
- **Contact shadow.**
  - A single soft radial blob decal (an sRGB 64×64 radial-alpha `DataTexture`), sized from the content
    footprint (`modelBounds` → `objectBounds` → all-extrusion precedence, as DD-026 framing does).
  - It sits at z = −0.04: above the plate's top face, **below** the grid and the first layer, so it can never
    darken toolpath. Round 2 had it above the grid (z = +0.05), so §6's re-render re-measures the grid inside
    the shadow.
  - **Not** shadow maps: deterministic, cheap, identical headless and interactive.
  - Hidden when there is no content.
  - Builders live as pure functions in `gcode-renderer-three`, so the model viewer reuses them.

### 4.2 Camera lens

Both viewers get the same lens control:

- **Toolpath:** `cameraFov?: number` on the core controller options, plus `GcodePreviewControls.setCameraFov(deg)`.
- **Model viewer:** the same on `ModelPreviewControllerOptions` / `ModelPreviewControls`.

Rules:

- Perspective only, ignored on orthographic.
- Range (0, 180).
- Default 50, unchanged.
- Framing already reads `camera.fov` (`interactive-stage.ts`), so fit stays correct.
- Stills already accept `pose.fov`. `renderStill` / `renderModelStill` also gain a top-level `cameraFov` so a
  preset applies without a pose.
- `CameraState` save/restore keeps carrying `fov`. An explicit `setCameraState` wins over `cameraFov` until the
  next `setCameraFov`.

### 4.3 Model-viewer plate

Additions:

- **Options:** `ModelPreviewControllerOptions.buildVolume?: BuildVolumeDef | null` and `theme?: Theme`.
- **Controls:** `ModelPreviewControls.setBuildVolume(def | null)`, `setTheme(theme)` and `setCameraFov(deg)`.
- **Stills:** the same on `renderModelStill`.

Rules:

- **Reuse.** The model viewer reuses `createBuildVolume` and the §4.1 builders through a shared
  theme→volume-style mapping. Today that mapping is a private `volumeStyle()` in `scene.ts`; Lane A extracts
  it.
- **Placement, honest.**
  - When the source carries plate coordinates (3MF build-item transforms on the active/selected plate), the
    part is drawn where the file puts it. `placement: 'known'`.
  - Otherwise (STL, or a 3MF with no build placement), the footprint is centred on the bed and dropped to
    z = 0. `placement: 'approximated'`.
  - With no plate, `placement: null`.
  - `ModelPreviewState.placement` exposes this. It joins the model parity guard's required state list.
- **Framing** is unchanged: the model, not the plate, is framed. The plate is context. A `frameTarget:'plate'`
  option is a follow-up if consumers ask.
- **`background` / `setBackground`** stay as today (back-compat).
  - If `theme.background` is set, it governs the scene.
  - The last write wins, documented.
  - `capture()` keeps its own `background` override.

### 4.4 The preset

`studioTheme(mode: 'dark' | 'light'): Theme` and `STUDIO_CAMERA_FOV = 32` are exported from
`gcode-renderer-three` and re-exported by `gcode-preview-core` and `gcode-model-renderer`. Values are from
Round 2:

| Field | dark | light |
|---|---|---|
| `background` | `{ top:'#23272e', bottom:'#2b3038' }` | `{ top:'#dfe3e8', bottom:'#c9ced5' }` |
| `bedSurface` | `{ mode:'solid', color:'#7c8086', thickness:4, edgeColor:'#585c61' }` | same |
| `gridColor` / `gridOpacity` (10 mm) | `#ffffff` / 0.11 | `#1b2430` / 0.16 |
| `gridMajor` | `{ every:50, opacity:0.31 }` | `{ every:50, opacity:0.47 }` |
| `bedOutline` | `{ color:'#ffffff', opacity:0.76 }` | `{ color:'#1b2430', opacity:0.80 }` |
| `contactShadow` | `{ opacity:0.4 }` | `{ opacity:0.3 }` |
| lights, `materialPreset`, `bedColor` (cage) | defaults | defaults |

Notes:

- **Minor-grid pitch.** The 10 mm pitch is the build volume's `grid` (default 10). The preset relies on it and
  documents it.
- **Thickness/edge** (4 mm, `#585c61`) come from Round-1 C and were **not** in the Round-2 measurement. They
  need the validation re-render in §6 before release.
- **Tone mapping and output.** Tone mapping is already none and output is already sRGB in both viewers, so no
  change is needed. Lane B verifies this rather than assuming it.

### 4.5 Framework parity (DD-031 checklist)

| # | Question | Answer |
|---|---|---|
| 1 | Core | `Theme` fields pass through `setTheme` (no new control). New: `setCameraFov` + `cameraFov` option. |
| 2 | Adapters | Vue/React/Svelte/WC expose `theme` (already) and a declarative `cameraFov` prop/attribute. `/model` on all four gains `theme`, `buildVolume`, `cameraFov` declaratively and the three setters imperatively. WC: `camera-fov` attribute + `cameraFov` property; `theme` and `buildVolume` are properties only (object-valued, the documented split). |
| 3 | Lower-level APIs | `createGcodePreview` / `useGcodePreview` / `element` covered via the controller. |
| 4 | Events | None new. `state-change` carries `placement`. |
| 5 | Parity suites | `setCameraFov` joins `GcodePreviewControls` required list. `setBuildVolume`/`setTheme`/`setCameraFov` + `placement` join the `ModelPreviewControls` / state lists. Behavioural cases are in §6. |
| 6 | Feature Lab | A look switcher (Today / Studio dark / Studio light) + lens slider on both Preview and Prepare, with Studio as the Feature Lab's starting look. Showcases use Studio. |
| 7 | Docs | Adapter READMEs, `docs/manual/adapters.md`, a manual theming page, and `VISUAL_FEATURE_COVERAGE.md` row(s). |

2D renderer: not applicable (no 3D look), documented as intentional.

## 5. Compatibility

- **Additive** minor (v0.22.0). No default changes, no removals, no signature changes.
- `DEFAULT_THEME` and `resolveTheme({})` stay byte-identical. `ResolvedTheme` gains fields, which is additive
  for readers. Any consumer constructing a `ResolvedTheme` literal is unsupported (it is an output type);
  noted in the changeset.
- The model viewer with no `buildVolume` renders exactly as today.

## 6. Testing and validation

- **Unit tests** per new branch: tier dedupe, multiple-of validation, outline for rect/circular/polygon, slab
  top-face height + unlit top + edge, gradient texture sRGB + disposal on theme change (leak test), shadow
  footprint precedence + hidden-when-empty, `cameraFov` range + ortho no-op + `setCameraState`
  interplay, placement known/approximated/null.
  - Assert literal expected values, never the module's own constants (house rule).
- **RED:** forward-only, one mutant per clause, 5–15 per lane + a GREEN control.
- **Regression gate:** existing visual baselines + all current renderer/model tests unmodified-green with no
  theme set.
- **Validation re-render (release gate).** Re-run the Round-2 measurement harness against the shipped `studioTheme('dark'|'light')`. Gates:
  - **Contrast:** must reproduce Round 2 within ±0.05 contrast ratio per tier.
  - **Top face:** must still render exactly `#7c8086` with thickness 4.
  - **Grid:** must read in all 8 filament × theme cells.
  - **Black/white separation:** ≥ 2.9:1.
  - **If it misses:** adjust the preset values (not the decisions) and record them here.

## 7. Delivery plan

| Lane | Files (no two lanes share a file) | Depends on |
|---|---|---|
| **A** renderer primitives | `gcode-renderer-three`: `theme.ts`, `build-volume.ts`, new `backdrop.ts`, new `contact-shadow.ts`, new `volume-style.ts` (extracted `volumeStyle`; the one-line `scene.ts` call-site swap is in this lane), `index.ts` exports, their tests. `studioTheme` + `STUDIO_CAMERA_FOV`. | — |
| **B** toolpath wiring | `gcode-renderer-three/scene.ts` (gradient + shadow wiring, fov) + `interactive-stage.ts` if needed; `gcode-preview-core` controller/render-still/testing/re-exports; Vue/React/Svelte/WC toolpath adapters + READMEs | A |
| **C** model-viewer plate | `gcode-model-renderer` viewer/controller/still/model-testing/re-exports; `/model` in all four adapters + READMEs | A (parallel with B; adapter files are disjoint by subpath. If a shared adapter index must change, B owns it and C sends a seam warning) |
| **D** demo + docs + gate | Feature Lab, showcases, `docs/manual`, `VISUAL_FEATURE_COVERAGE.md`, screenshot regeneration, the §6 validation re-render | B + C |

Release v0.22.0 per `docs/reference/release-process.md` after D, with the owner's release approval.

## 8. Follow-ups (not this DD)

- **P2:** per-filament plate auto-contrast (nudge plate tone when filament luminance is within a threshold).
- **P3:** thick lines (`Line2`/quads) so the boundary can dominate by width, not only alpha.
- **P3:** `frameTarget:'plate'` on the model viewer.
- **P3:** backfill the `docs/design/README.md` index for DD-023…DD-031 (rows missing).
- Flip the default to Studio: a separate owner decision in a later minor.

## 9. Revision log

- 2026-11-10: created and Accepted (owner decisions 1–4 above).
- 2026-11-10: Lane A footprint review. Backdrop and shadow use sRGB `DataTexture`, not `CanvasTexture`.
  Draw order is explicit (slab walls −2, top −1, outline above the grid). Shadow at z = −0.04, below the
  grid. New opacities and `gridMajor.every` are validated with `TypeError`. No decision changed.
