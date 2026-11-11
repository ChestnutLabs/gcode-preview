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
- **Validation.** `resolveTheme` throws a `RangeError` (the renderer's existing convention, `tubes.ts`) when:
  - any new opacity (`gridOpacity`, `gridMajor.opacity`, `bedOutline.opacity`, `contactShadow.opacity`) is
    non-finite or outside [0, 1];
  - `gridMajor.every` is non-finite or ≤ 0.

  Existing fields keep today's (unvalidated) behaviour. Nothing validates **across** `Theme` and
  `BuildVolumeDef`, so a valid `setBuildVolume` never throws because of an earlier theme.
- **Major grid.**
  - At build time the major step is `k = max(1, round(every / pitch))` minor lines. Majors are every k-th minor
    index counted from the bed minimum. A non-multiple `every` snaps to the nearest multiple of the pitch
    (documented). Dedupe is by **integer index**, never by float equality, so pitches like 0.1 behave.
  - A minor line at a major index is **not** drawn, so alphas never double-blend. The Round-2 numbers assume a
    single blend per line.
- **Outline.**
  - `bedOutline` draws the printable boundary loop for **every** shape, rectangular included.
  - Its material is always `transparent: true`, even at opacity 1. Its `renderOrder` is above the grid lines',
    so it blends last within the transparent list and is the strongest line. A small z offset alone would not
    guarantee this.
  - When `bedOutline` is set, grid lines (minor or major) that coincide with the bed edge are **not** emitted,
    and the cage omits its **floor** edges (its verticals and top stay). The outline replaces both, so the
    boundary is a single blend. This also gives rect beds whose size is not a multiple of the pitch their true
    edge, not a "250 on a 256 bed" grid edge.
  - Unset `bedOutline` keeps everything as today: rect beds have no loop, and non-rect beds keep today's loop
    (grid colour at `min(1, gridOpacity + 0.3)`, z = 0.01).
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
  - Its `renderOrder` is −0.5, between the top face (−1) and the grid (0). Both it and the grid are
    transparent, and three sorts that list by distance, so without an explicit order the grid would flip
    between darkened and not as the camera orbits.
  - **Not** shadow maps: deterministic, cheap, identical headless and interactive.
  - Hidden when there is no content.
  - **It belongs to the plate.** It is drawn only when a plate is drawn: absent with `includeBuildVolume:false`
    and with no `buildVolume`. Transparent cutouts never get a grey blob, and a plate-less model viewer stays
    byte-identical.
  - Builders live as pure functions in `gcode-renderer-three`, so the model viewer reuses them.
- **Disposal.** One shared `disposeBuildVolume(group)` frees geometry, materials **and each material's `.map`**
  (three's `material.dispose()` does not free maps). Both viewers use it at every volume rebuild and dispose.
  Today's walks free geometry and material only, so the bed texture already leaks on every rebuild; this fixes
  it as a by-product of touched code.

### 4.2 Camera lens

Both viewers get the same lens control:

- **Toolpath:** `cameraFov?: number` on the core controller options, plus `GcodePreviewControls.setCameraFov(deg)`.
- **Model viewer:** the same on `ModelPreviewControllerOptions` / `ModelPreviewControls`.

Rules:

- Perspective only. On orthographic it is remembered and applied when the camera returns to perspective.
- Range (0, 180), exclusive. Out of range throws `RangeError`; it is not clamped.
- Default 50, unchanged.
- **Framing must become lens-aware.** Today's auto-framing does not read the lens:
  - `framingFromCenterRadius` (`stage.ts`) places the camera at the fixed offset (−1.2, 1.6, 1.8)·r ≈ 2.69 r,
    with `viewHalfHeight` = 1.25 r = 2.69·tan 25°. That is tuned to 50°.
  - It drives `Scene.frame()`, core `renderStill` and `renderModelStill`. Only the interactive model viewer's
    `fitBox` reads `camera.fov`.
  - At 32° that offset shows a half-height of only 2.69·tan 16° ≈ 0.77 r, so the framed sphere is cropped.

  So `framingFromCenterRadius(center, r, fov = 50)` scales the perspective offset by tan 25° / tan(fov/2), with
  an **exact short-circuit at 50** so default positions are byte-identical. The orthographic `viewHalfHeight`
  stays 1.25 r, so toggling projection still keeps apparent size.
- **Changing the lens live** dolly-compensates: the target is kept and the camera distance is scaled by
  tan(old/2) / tan(new/2), so the part keeps its apparent size without a re-fit. This is an `InteractiveStage`
  primitive (Lane A), so both viewers share it.
- Stills already accept `pose.fov`. `renderStill` / `renderModelStill` also gain a top-level `cameraFov` so a
  preset applies without a pose, and their framing uses it.
- **`CameraState` has no lens field** (`{ position, target, zoom, cameraMode }`). A restored pose renders at the
  current lens. Adding `fov` to `CameraState` is a follow-up (§8).

### 4.3 Model-viewer plate

Additions:

- **Options:** `ModelPreviewControllerOptions.buildVolume?: BuildVolumeDef | null` and `theme?: Theme`.
- **Controls:** `ModelPreviewControls.setBuildVolume(def | null)`, `setTheme(theme)` and `setCameraFov(deg)`.
- **Stills:** the same on `renderModelStill`.

Rules:

- **Reuse.** The model viewer reuses `createBuildVolume` and the §4.1 builders through a shared
  theme→volume-style mapping. Today that mapping is a private `volumeStyle()` in `scene.ts`; Lane A extracts
  it.
- **Placement, honest** (`ModelPreviewState.placement`, the project's honesty vocabulary). Build-item transforms
  alone do not prove plate coordinates:
  - Bambu/Orca multi-plate projects author plate N > 1 in one shared workspace, offset by grid cells.
  - CAD exports (Fusion, Onshape) carry transforms that are not plate coordinates at all, often centred on the
    origin or below z = 0.

  So the rule fails honest by construction:

  | `placement` | When | What is drawn |
  |---|---|---|
  | `'known'` | The source is a **slicer project** (project/model settings present in the 3MF) **and** the selected scope's footprint lies on the bed within a tolerance | Parts where the file puts them |
  | `'inferred'` | A slicer project whose footprint is off the bed, where subtracting a whole workspace-cell offset per axis lands it on the bed | Parts with the offset subtracted. The cell is the bed size × (1 + 1/5), the slicers' plate gap |
  | `'approximated'` | Anything else: STL, CAD 3MF, or neither check passes | The footprint centred on the bed and dropped to z = 0 |
  | `null` | No plate is drawn: no `buildVolume`, or the render scope spans **more than one** declared plate | No plate. One bed under a multi-plate layout would misrepresent it |

  Notes:
  - Any offset is **presentation-only** (DD-025 D3): `ModelScene` and `getState().bounds` stay authored.
  - `placement` joins the model parity guard's required state keys.
- **Framing** is unchanged: the model, not the plate, is framed. The plate is context. A `frameTarget:'plate'`
  option is a follow-up if consumers ask.
- **Theme subset.** The model viewer honours only the plate and backdrop fields: `background`, `gridColor`,
  `gridOpacity`, `gridMajor`, `bedOutline`, `bedSurface`, `bedColor` (cage), `contactShadow`.
  - Lights and `materialPreset` are **intentionally not applicable**. The model rig (hemisphere
    `#ffffff`/`#9098a5` at 2.0, key 1.6, fill 0.5) differs from the toolpath defaults, and `materialPreset` is
    tube-only. Applying `Theme`'s replace semantics to it would silently darken every model, unmeasured.
  - This is a documented DD-031 deliberate difference.
- **Background precedence**, one rule for all four surfaces (toolpath live, `renderStill`, model live,
  `renderModelStill`). This is the toolpath's existing rule:
  - `capture({ background })` beats everything;
  - then `theme.background`;
  - then the `background` prop/option;
  - then the default (`'transparent'` for the model viewer).

  This makes it independent of adapter watch order. The documented cutout recipe is
  `{ ...studioTheme('dark'), background: null }` (`null` = omit), which falls through to `'transparent'`.

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
- **Tone mapping and output.** Neither viewer sets them, so three's defaults apply (no tone mapping, sRGB
  output). That is what the look needs. Review confirmed it; Lane B adds a test pinning it.
- **The cage.** Round 2 was measured with the cage **off**. The cage is a separate control
  (`setBuildVolumeCage` / `includeBuildVolume`), not a `Theme` field, so the preset cannot set it. The Feature
  Lab and showcases turn it off with the Studio look. With `bedOutline` set, the cage's floor edges are omitted
  anyway (§4.1), so a consumer who keeps the cage on doesn't get a triple-blended boundary.

### 4.5 Framework parity (DD-031 checklist)

| # | Question | Answer |
|---|---|---|
| 1 | Core | `Theme` fields pass through `setTheme` (no new control). New: `setCameraFov` + `cameraFov` option. |
| 2 | Adapters | Vue/React/Svelte/WC expose `theme` (already) and a declarative `cameraFov` prop/attribute. `/model` on all four gains `theme`, `buildVolume`, `cameraFov` declaratively and the three setters imperatively. WC: `camera-fov` attribute + `cameraFov` property; `theme` and `buildVolume` are properties only (object-valued, the documented split). |
| 3 | Lower-level APIs | Toolpath: `createGcodePreview` / `useGcodePreview` / `element`. Model: `createModelViewer` / `useModelViewer` / the `<gcode-model-viewer>` element. All covered via their controllers. |
| 4 | Events | None new. The model controller's `onStateChange` (the WC's state event) carries `placement`. |
| 5 | Parity suites | `setCameraFov` joins the `GcodePreviewControls` required list (`setTheme`/`setBuildVolume` are already there). `setBuildVolume`/`setTheme`/`setCameraFov` join the `ModelPreviewControls` list, and `placement` joins `REQUIRED_MODEL_STATE_KEYS`. Behavioural cases are in §6. |
| 6 | Feature Lab | A look switcher (Today / Studio dark / Studio light) + lens slider on both Preview and Prepare, with Studio as the Feature Lab's starting look. Showcases use Studio. |
| 7 | Docs | Adapter READMEs, `docs/manual/adapters.md`, a manual theming page, and `VISUAL_FEATURE_COVERAGE.md` row(s). |

2D renderer: not applicable (no 3D look), documented as intentional.

## 5. Compatibility

- **Additive** minor (v0.22.0). No default changes, no removals, no signature changes.
- "Byte-identical" means the **rendered scene and every existing field's value**. The new `ResolvedTheme`
  fields are optional and absent by default, so `DEFAULT_THEME` and `resolveTheme({})` stay key-for-key
  identical too.
- **One type widening, called out in the changeset:** `Theme.background` / `ResolvedTheme.background` widen
  to include the gradient object. A TypeScript reader that passes `ResolvedTheme.background` on as
  `ThemeColor | null` must narrow first. Constructing a `ResolvedTheme` literal (an output type) is
  unsupported.
- The model viewer with no `buildVolume` renders exactly as today.

## 6. Testing and validation

- **Unit tests** per new branch, asserting literal expected values, never the module's own constants (house
  rule):
  - **Grid:** tier dedupe by index, `every` snapping (incl. pitch 0.1), and the `RangeError` validations.
  - **Outline:** for rect/circular/polygon; edge grid lines and cage floor edges omitted only when it is set;
    always transparent; `renderOrder` values.
  - **Slab:** top-face height, unlit top and edge, walls −2 / top −1.
  - **Shadow:** −0.5 order, footprint precedence, hidden when empty and absent without a plate.
  - **Gradient:** texture sRGB, row orientation.
  - **Lens:** `framingFromCenterRadius` positions identical at 50 and the framed sphere inside the view at 32,
    for `frame()`, `renderStill` and `renderModelStill`. Also range errors, the ortho remember-and-apply, and
    dolly compensation keeping apparent size.
  - **Placement fixtures:** a slicer-project plate-1 part on the bed (`known`); a synthetic plate-2 part offset
    by one workspace cell (`inferred`); a CAD-style 3MF at the origin (`approximated`); an STL
    (`approximated`); and a multi-plate scope (`null`).
  - **Model viewer:** lighting is unchanged under `setTheme(studioTheme(…))`.
  - **Background precedence:** all four surfaces, plus a studio + transparent cutout with no gradient and no
    shadow.
  - **Leak matrix:** textures and geometries freed on `setTheme`, `setBuildVolume`, `dispose` and model-viewer
    context-loss restore, with a textured slab + shadow + gradient.
- **RED:** forward-only, one mutant per clause, 5–15 per lane + a GREEN control.
- **Regression gate:** existing visual baselines + all current renderer/model tests unmodified-green with no
  theme set.
- **Validation re-render (release gate).** Re-run the Round-2 measurement harness against the shipped `studioTheme('dark'|'light')`. Gates:
  - **Contrast:** must reproduce Round 2 within ±0.05 contrast ratio per tier. The boundary is re-measured as
    **outline-only** (edge grid lines and cage floor now omitted), so its target is Round 2's loop-only
    edges: 3.03 dark, 3.07 light. It must stay ≥ 3:1.
  - **Shadow:** the grid inside the shadow is re-measured, now that the shadow sits below the grid.
  - **Top face:** must still render exactly `#7c8086` with thickness 4.
  - **Grid:** must read in all 8 filament × theme cells.
  - **Black/white separation:** ≥ 2.9:1.
  - **If it misses:** adjust the preset values (not the decisions) and record them here.

## 7. Delivery plan

| Lane | Files (no two lanes share a file) | Depends on |
|---|---|---|
| **A** renderer primitives | `gcode-renderer-three`: `theme.ts`, `build-volume.ts`, `stage.ts` (lens-aware `framingFromCenterRadius`), `interactive-stage.ts` (the dolly-compensating fov setter), new `backdrop.ts`, new `contact-shadow.ts`, new `volume-style.ts`, `disposeBuildVolume`, `index.ts` exports, their tests. `studioTheme` + `STUDIO_CAMERA_FOV`. In `scene.ts`: only the `volumeStyle()` delegate and the three volume dispose walks. | — |
| **B** toolpath wiring | `gcode-renderer-three/scene.ts` (gradient background + its disposal, shadow, `cameraFov`, lens-aware `frame()`); `gcode-preview-core` controller/render-still/testing/re-exports; Vue/React/Svelte/WC toolpath adapter **source** | A |
| **C** model-viewer plate | `gcode-model-renderer` viewer/controller/still/model-testing/re-exports, placement; `/model` adapter **source** in all four adapters | A (parallel with B; both consume A's stage primitives, so neither waits on the other. If a shared adapter index must change, B owns it and C sends a seam warning) |
| **D** demo + docs + gate | Feature Lab, showcases, `docs/manual`, **all four adapter `README.md`s** (each documents both toolpath and `/model`, so a single lane owns them), `VISUAL_FEATURE_COVERAGE.md`, screenshot regeneration, the §6 validation re-render | B + C |

Release v0.22.0 per `docs/reference/release-process.md` after D, with the owner's release approval.

## 8. Follow-ups (not this DD)

- **P2:** per-filament plate auto-contrast (nudge plate tone when filament luminance is within a threshold).
- **P3:** thick lines (`Line2`/quads) so the boundary can dominate by width, not only alpha.
- **P3:** `frameTarget:'plate'` on the model viewer.
- **P3:** an optional `fov` on `CameraState`, so a pose saved under one lens restores identically under
  another. It touches every persisted state, and AnyBridge restores under the same preset lens.
- **P2:** a real Bambu/Orca 2-plate project 3MF in the corpus, minimised and with redistribution cleared, to
  back the synthetic `inferred` fixture.
- **P3:** resolve the model viewer's lights against its own rig if a consumer wants themed model lighting.
- **P3:** backfill the `docs/design/README.md` index for DD-023…DD-031 (rows missing).
- Flip the default to Studio: a separate owner decision in a later minor.

## 9. Revision log

- 2026-11-10: created and Accepted (owner decisions 1–4 above).
- 2026-11-10: Lane A footprint review. Backdrop and shadow use sRGB `DataTexture`, not `CanvasTexture`.
  Draw order is explicit (slab walls −2, top −1, outline above the grid). Shadow at z = −0.04, below the
  grid. New opacities and `gridMajor.every` are validated with `TypeError`. No decision changed.
- 2026-11-10: design review (2 P1, 5 P2, 3 P3, every claim checked against dev `be7a9dc`). No decision changed,
  no field renamed.
  - **P1 lens.** Framing was not lens-aware, so it would have cropped at 32°. It now is, byte-identical at 50,
    and a dolly-compensated lens setter moved into Lane A. `CameraState` has no lens field.
  - **P1 placement.** Placement is now `known`/`inferred`/`approximated`/`null`, gated on slicer project +
    on-bed checks, with `null` for multi-plate scopes.
  - **P2 model viewer.** It takes only the plate/backdrop subset of `Theme`.
  - **P2 outline.** It replaces coincident edge grid lines and cage floor edges, and is always transparent. The
    shadow is at `renderOrder` −0.5.
  - **P2 `every`.** It now snaps instead of throwing across objects. All numeric validation is `RangeError`.
  - **P2 background.** One precedence rule for all four surfaces; the shadow belongs to the plate.
  - **P2 disposal.** A shared `disposeBuildVolume` frees maps, with a full leak matrix.
  - **P3.** Parity rows 3/4/5 fixed, adapter READMEs moved to Lane D, and the `ResolvedTheme.background`
    widening is called out.
