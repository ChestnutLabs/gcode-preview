# @chestnutlabs/gcode-model-renderer

## 0.15.0

### Patch Changes

- Updated dependencies [[`8229075`](https://github.com/ChestnutLabs/gcode-preview/commit/8229075e2737c360c5d255e438ce140f4fbb13da)]:
  - @chestnutlabs/gcode-renderer-three@0.15.0
  - @chestnutlabs/gcode-containers@0.15.0
  - @chestnutlabs/toolpath-core@0.15.0

## 0.14.0

### Patch Changes

- Updated dependencies [[`60e24e1`](https://github.com/ChestnutLabs/gcode-preview/commit/60e24e15b6b72e9aa097f4d2fd22b0c91a480cea), [`c99b221`](https://github.com/ChestnutLabs/gcode-preview/commit/c99b2219566b6427c3d11d37be04876415db3bea)]:
  - @chestnutlabs/gcode-renderer-three@0.14.0
  - @chestnutlabs/gcode-containers@0.14.0
  - @chestnutlabs/toolpath-core@0.14.0

## 0.13.0

### Minor Changes

- [#363](https://github.com/ChestnutLabs/gcode-preview/pull/363) [`56ed874`](https://github.com/ChestnutLabs/gcode-preview/commit/56ed874f20ef590908f03229f5a40f53f8956da9) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model): decode Bambu/Orca per-object extruder colours (source-model colour convention)

  `parse3mf` now renders the colour a Bambu/Orca source `.3mf` carries via its **project convention**:
  per-object / per-part `<metadata key="extruder">` in `Metadata/model_settings.config` (1-based) indexing the
  `filament_colour` palette in `Metadata/project_settings.config`. Each object/part with no
  basematerials/colorgroup/`paint_color` colour of its own is solid-coloured by its assigned filament, and
  `capabilities.materials` becomes `'known'`. A part's own extruder overrides its parent object's default.

  Honesty preserved: colour is applied **only** when the source actually declares the extruder mapping AND the
  palette resolves the slot — otherwise the object stays neutral (`materials: 'unavailable'`); nothing is
  guessed. This fixes the "No colour data / neutral render" result on multi-part Bambu source models (e.g. the
  Baby_Opossum sheet) whose colour lives in the project metadata rather than in basematerials or `paint_color`.
  Validated against a real production multi-part Bambu `.3mf` (per-part extruder colours resolved correctly,
  alongside parts that carry their own basematerials).

- [#360](https://github.com/ChestnutLabs/gcode-preview/pull/360) [`a75e5cd`](https://github.com/ChestnutLabs/gcode-preview/commit/a75e5cdd075676924eb65ae20df50b1ad39c1264) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model): multi-plate model structure — plate identity as first-class API (DD-025 Phase A)

  `parse3mf` now reads Bambu/Orca `Metadata/model_settings.config` and exposes declared plate structure on
  `ModelScene`: a new `plates: { list: ModelPlateSummary[]; active? }`, a placement-level `plateIds` on each
  `ModelObject` (aligned with `instances` — a reused master can appear on multiple plates, so membership lives
  on the placement, not the master), and a `capabilities.plates` confidence tier (`'known'` only when the
  source **explicitly** declares plates, incl. an explicit single plate; `'unavailable'` for
  undeclared/implicit). `ModelReadyInfo` and `RenderModelStillResult` surface `plates` too, so a consumer can
  build a plate selector. Plate grouping is derived from the source's own declaration (never geometric
  guessing); a plate-less file is honestly one implicit plate. No render change yet — per-plate / all-plates
  presentation is a later phase.

- [#361](https://github.com/ChestnutLabs/gcode-preview/pull/361) [`b8dd6a7`](https://github.com/ChestnutLabs/gcode-preview/commit/b8dd6a7ce05add28f922a7f71641eebe0778a146) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model): staged loading progress on createModelViewer (DD-024 Phase A)

  Adds the shared, typed, consumer-neutral loading-progress contract (`LoadStage` / `LoadUnit` / `LoadProgress`
  in `gcode-renderer-three`) and wires it into `createModelViewer` via a new `onProgress` option — closing the
  gap where the model renderer emitted no progress at all (large models "felt hung"). Events carry typed
  `stage` / `done` / `total` / `unit` (or an honest `indeterminate`) and **no human-facing copy** — the
  consumer owns all wording/i18n. `setSource` emits `parsing` (indeterminate) → `building-geometry` with real
  per-object counts → `ready`. Every event is **generation-scoped**: a superseded/cancelled `setSource` can
  never advance the next load's progress. No render behavior changes.

### Patch Changes

- Updated dependencies [[`377fc70`](https://github.com/ChestnutLabs/gcode-preview/commit/377fc7076e42a6044a9e10f2d4b27bd99fa133f3), [`b8dd6a7`](https://github.com/ChestnutLabs/gcode-preview/commit/b8dd6a7ce05add28f922a7f71641eebe0778a146), [`3be5312`](https://github.com/ChestnutLabs/gcode-preview/commit/3be531219cede19168ddf042ee7954c14d73d74c)]:
  - @chestnutlabs/gcode-renderer-three@0.13.0
  - @chestnutlabs/gcode-containers@0.13.0
  - @chestnutlabs/toolpath-core@0.13.0

## 0.12.0

### Patch Changes

- [#353](https://github.com/ChestnutLabs/gcode-preview/pull/353) [`b710fa1`](https://github.com/ChestnutLabs/gcode-preview/commit/b710fa15b42be22277af4b733bf90bccdc2e1413) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - fix(model-renderer): the fast-reject estimate counts UNIQUE triangles, not baked-per-placement (DD-022)

  The Phase 0 structural estimate summed an external master's triangle estimate **once per placement**, so a
  full-sheet instanced plate (e.g. Baby_Opossum, ~40 reused copies) estimated ~26 M "baked" triangles and was
  **wrongly rejected** with `E_MODEL_TOO_MANY_TRIANGLES` — even though Phase 1 instancing renders it from its
  ~1.5 M **unique** triangles. The still path only escaped it by running with raised limits; the interactive
  `createModelViewer` used defaults and rejected.

  The estimate now counts each unique master (by objectid / external path) **once**, matching the instanced
  render. The placement count still guards an instance bomb via `maxInstances`. So an instanced plate parses
  and renders (interactive and headless) at default limits instead of falsely rejecting; a genuinely huge
  _unique_ mesh is still bounded by the triangle limit. Fixes the "too large to show interactively" regression
  on instanced source `.3mf` plates.

- Updated dependencies [[`8bd6bbd`](https://github.com/ChestnutLabs/gcode-preview/commit/8bd6bbd1dfe7539ee4e3357f84de74c2eb703462)]:
  - @chestnutlabs/gcode-renderer-three@0.12.0
  - @chestnutlabs/gcode-containers@0.12.0
  - @chestnutlabs/toolpath-core@0.12.0

## 0.11.0

### Minor Changes

- [#346](https://github.com/ChestnutLabs/gcode-preview/pull/346) [`c5bfae9`](https://github.com/ChestnutLabs/gcode-preview/commit/c5bfae9254c85519a439e200303cde5b859bfae5) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): fast structural reject for oversize / instance-bomb source 3MFs (DD-022 Phase 0)

  Before decompressing any large external geometry part, `parse3mf` now runs a cheap structural estimate from
  the main part's build-item/component tree plus the ZIP directory's uncompressed sizes, and rejects a clear
  instance-bomb or oversize plate in **sub-second** time instead of ~10 s of decompress-and-bake. New
  `ModelLimits.maxInstances` (default 50,000) bounds total instance placements → `E_MODEL_TOO_MANY_INSTANCES`;
  an over-budget triangle estimate → `E_MODEL_TOO_MANY_TRIANGLES` from the estimate rather than mid-bake. The
  estimate under-counts external geometry and applies a ×2 safety margin, so it never false-rejects a file
  that would actually fit — borderline files fall through to the exact per-triangle parse.

  First phase of the instance-aware source-model work ([DD-022](../docs/design/DD-022-model-instancing-and-lod.md)):
  a standalone latency/DoS win. Phase 1 (GPU instancing) will make these plates _render_ instead of reject.
  Additive; existing files and limits are unchanged.

- [#347](https://github.com/ChestnutLabs/gcode-preview/pull/347) [`c7002a6`](https://github.com/ChestnutLabs/gcode-preview/commit/c7002a64ad07f817773d70bba1a7b5a0aafebfcd) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): render reused 3MF geometry via GPU instancing instead of baking copies (DD-022 Phase 1a)

  A source `.3mf` that reuses a master mesh via production-extension `<component>` references or repeated
  `<build>` items no longer **bakes** a full world-space copy per placement. `parse3mf` now folds the
  transform chain into per-placement matrices and keeps each master's geometry **once** in local space, and
  `ModelContent` draws it as a single three `InstancedMesh` (one geometry upload, one draw call across all
  placements). So memory and the triangle budget scale with **unique** geometry, not copy count — a
  full-sheet plate of ~40 instanced copies measures as its ~1 master, not ~40× baked.

  New: `ModelObject.instances?: Mat4[]` (present only when a master is reused, length ≥ 2; a single-placement
  object keeps its `transform`) and `ModelScene.capabilities.instanced` (`'known'` when instancing was
  preserved). Additive and render-equivalent for existing files (STL and single-placement 3MF are unchanged;
  the existing suite passes). This is the farm-scale fix behind DD-022; the consumption-boundary disclosure
  (`instancedCount` on `ready`/result) follows in Phase 1b.

- [#348](https://github.com/ChestnutLabs/gcode-preview/pull/348) [`4755198`](https://github.com/ChestnutLabs/gcode-preview/commit/4755198e1bf924690067f37143bc58539e503839) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): disclose `instancedCount` + `decimationApplied` on the model ready/still result (DD-022 Phase 1b)

  `RenderModelStillResult` and `createModelViewer`'s `ready.info` (`ModelReadyInfo`) now report
  `instancedCount` (total placements drawn — greater than `objectCount` when the source reused geometry, for
  an "N copies" badge) and a flat `decimationApplied` (1 = none), named identically to the toolpath
  `RenderStillResult.decimationApplied` so a consumer badges "simplified for size" the same way for model and
  toolpath cards. `decimationApplied` is always 1 until model LOD lands (DD-022 Phase 2); it is reserved now
  so the field is stable for consumers wiring the badge against the instancing boundary. Additive.

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-containers@0.11.0
  - @chestnutlabs/gcode-renderer-three@0.11.0
  - @chestnutlabs/toolpath-core@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies [[`a6ae736`](https://github.com/ChestnutLabs/gcode-preview/commit/a6ae736dab468960939b477964790c6ce9130572)]:
  - @chestnutlabs/gcode-renderer-three@0.10.0
  - @chestnutlabs/gcode-containers@0.10.0
  - @chestnutlabs/toolpath-core@0.10.0

## 0.9.0

### Minor Changes

- [#330](https://github.com/ChestnutLabs/gcode-preview/pull/330) [`7b7541d`](https://github.com/ChestnutLabs/gcode-preview/commit/7b7541d52c506af040130604d0fb628d3af94b58) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): add the generic open-`kind` model-source loader registry (DD-021 Phase 1)

  Adds a loader registry so the model-source input is a **generic** `{ kind: string; bytes } | ModelScene`
  rather than a baked-in `STL | 3MF` union — new formats (OBJ/STEP/PLY/…) become loadable by registering a
  `ModelLoader`, with no change to the public input type. New exports: `ModelLoader`, `ModelLoadOptions`,
  `ModelSourceInput`, `stlLoader`, `threeMfLoader`, `DEFAULT_MODEL_LOADERS`, `isModelScene`, and
  `resolveModelScene` (which throws `E_MODEL_UNSUPPORTED_KIND` for an unregistered `kind`). The 3MF
  `filament_colour` palette override flows through as a format-agnostic option that non-consuming loaders
  ignore.

  `renderModelStill` is unchanged in signature and output — its internal source dispatch now flows through
  this shared registry (the existing `{kind:'stl'} | {kind:'3mf'} | ModelScene` input stays valid). This is
  the seam the interactive `createModelViewer` (next PR) consumes.

- [#331](https://github.com/ChestnutLabs/gcode-preview/pull/331) [`81f3fc9`](https://github.com/ChestnutLabs/gcode-preview/commit/81f3fc907fedc991fde21664a8726cf706b3ae95) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): add `createModelViewer` — the interactive source-model viewer (DD-021 Phase 1)

  Adds `createModelViewer(canvas, options?)` → `ModelViewer`, the **interactive** analogue of
  `renderModelStill`: orbit / zoom / pan a source model (STL / 3MF, including production `paint_color`
  multicolor) in the browser. It composes the pieces that already exist rather than duplicating a renderer —
  the shared `InteractiveStage` (GL + dual camera + orbit/zoom/pan + context-loss recovery + DD-020
  interaction quality) from `@chestnutlabs/gcode-renderer-three`, the shared `ModelContent` scene core, and
  the open-`kind` loader registry.

  Handle: `setSource` (async parse→build→frame, last-wins on overlap), `setView`, `get/setCameraState`,
  `setBackground`, `setInteractionQuality`, `resize`, `frame`, `onEvent`, `dispose`. Events: `ready`
  (`objectCount` / `materials` tier / `bounds`), `camera-changed`, `error` (structured code — e.g.
  `E_MODEL_UNSUPPORTED_KIND`), `renderer-unsupported` (WebGL missing → the consumer can fall back to a
  `renderModelStill` image), and `context-lost` / `context-restored`.

  Capability honesty is passed through from the parsed `ModelScene`, never recomputed (neutral render +
  `materials:'unavailable'` when the source carries no colour). It is a **distinct surface** from
  `ToolpathRenderer` / `<GcodePreview>` — no toolpath concepts (layers/travel/scrub/IR). `renderModelStill`
  is unchanged. New source formats become viewable by registering a `ModelLoader`, with no change to the
  `ModelViewer` / `createModelViewer` signatures.

### Patch Changes

- [#329](https://github.com/ChestnutLabs/gcode-preview/pull/329) [`9c461ef`](https://github.com/ChestnutLabs/gcode-preview/commit/9c461efe6b49ab516724110e84bd9b4b3789a29c) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - refactor(model-renderer): extract the shared presentation scene core into `ModelContent` (DD-021 Phase 1)

  Pulls the model root, studio-light rig, and capability-honest mesh building (including per-triangle
  `paint_color` vertex colours) out of `ModelRenderer` into a new `ModelContent` class that fills a
  provided three.js `Scene`. `ModelRenderer` (and therefore `renderModelStill`) keeps its own headless GL
  - camera and now composes `ModelContent` for scene content — output is unchanged (the renderer suite
    passes byte-for-byte). This gives the upcoming interactive `createModelViewer` (DD-021 Phase 1) one
    shared mesh/lighting/paint path instead of a parallel copy.

- Updated dependencies [[`cc6e1f6`](https://github.com/ChestnutLabs/gcode-preview/commit/cc6e1f6b48e531bc991cb1c7c53846ccbf7ca522), [`dd535d6`](https://github.com/ChestnutLabs/gcode-preview/commit/dd535d64ac71bbd876e83e81dccc6dbb046bf689), [`3299760`](https://github.com/ChestnutLabs/gcode-preview/commit/32997607dbd30db79c91d14d2d8383d99be933af)]:
  - @chestnutlabs/gcode-renderer-three@0.9.0
  - @chestnutlabs/gcode-containers@0.9.0
  - @chestnutlabs/toolpath-core@0.9.0

## 0.8.1

### Patch Changes

- Updated dependencies []:
  - @chestnutlabs/gcode-containers@0.8.1
  - @chestnutlabs/gcode-renderer-three@0.8.1
  - @chestnutlabs/toolpath-core@0.8.1

## 0.8.0

### Minor Changes

- [#318](https://github.com/ChestnutLabs/gcode-preview/pull/318) [`959e507`](https://github.com/ChestnutLabs/gcode-preview/commit/959e50779f3e2f84672a10e0e9ec0bfc5174f691) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): decode Bambu/Orca 3MF `paint_color` for production multicolor

  Real designer-authored Bambu Studio / OrcaSlicer 3MF files paint per-region colour with a proprietary
  `paint_color` facet attribute and keep the palette in `project_settings.config` — not in standard 3MF
  materials. `parse3mf` / `renderModelStill` now decode that facet-paint format (clean-room from the
  observed encoding, see RR-005) and read the `filament_colour` palette themselves, so a multicolor
  source model renders in its true colours without slicing. Capability-honest: `materials: 'known'`
  (or `'approximated'` when a few multi-colour facets are flattened), and still `'unavailable'` — neutral
  default, never a fabricated colour — when no palette is present.

  `@chestnutlabs/gcode-containers` gains an exported `filamentColoursFromSettings(settings)` helper so the
  "which key is the palette" semantics live in one place, shared by the toolpath and model paths.

- [#320](https://github.com/ChestnutLabs/gcode-preview/pull/320) [`2c9cdcb`](https://github.com/ChestnutLabs/gcode-preview/commit/2c9cdcb84f9fc8d5b80024a1f8da9e1f61137b8d) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - feat(model-renderer): optional `filamentPalette` override on `renderModelStill` / `parse3mf`

  Consumers that already hold a corrected or richer filament palette (e.g. re-rendering a sliced
  `.gcode.3mf`) can pass `filamentPalette` (hex `#RRGGBB` per 0-based slot) to override the palette read
  from the file's `project_settings.config` when colouring `paint_color` facets. Additive and optional —
  the renderer stays self-sufficient and reads the file's own palette without it. Mirrors the toolpath
  renderer's `mode: 'tool'` colour seam.

### Patch Changes

- Updated dependencies [[`959e507`](https://github.com/ChestnutLabs/gcode-preview/commit/959e50779f3e2f84672a10e0e9ec0bfc5174f691)]:
  - @chestnutlabs/gcode-containers@0.8.0
  - @chestnutlabs/gcode-renderer-three@0.8.0
  - @chestnutlabs/toolpath-core@0.8.0

## 0.7.0

### Minor Changes

- [#311](https://github.com/ChestnutLabs/gcode-preview/pull/311) [`5e156ec`](https://github.com/ChestnutLabs/gcode-preview/commit/5e156ec62d813691cbca2a939c97fb695c7ccd5f) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - 3MF **Production Extension** support in `parse3mf` (the Bambu Studio / MakerWorld default layout). A
  production-extension file has a small `3D/3dmodel.model` shell whose `<build><item>` points at a
  `<components>` object that references the real mesh in an **external** part (`<component
p:path="/3D/Objects/*.model" objectid=… transform=…/>`). Previously this parsed as "no renderable
  geometry"; now the parser follows `p:path` into the referenced part, resolves the object, and composes
  the component transform with the build-item transform — resolving nested components across parts (depth-
  guarded). The inline-mesh case is unchanged; materials resolve from whichever part defines the mesh's
  colors.

  Note: some vendors (e.g. Bambu) encode multicolor via a proprietary per-triangle `paint_color` attribute
  plus filament colors in `project_settings.config`, not standard 3MF materials. Those still render with
  correct geometry and honest `materials: 'unavailable'` (a neutral model, never a fabricated color) —
  decoding vendor paint into true colors is a separate follow-up.

### Patch Changes

- Updated dependencies [[`bbdef97`](https://github.com/ChestnutLabs/gcode-preview/commit/bbdef97d8a1eb77a3864291918f7f5aace559ff2), [`39ede6e`](https://github.com/ChestnutLabs/gcode-preview/commit/39ede6ebc0a1ba594a391f1b33db2bdf3445d414), [`caaa0fa`](https://github.com/ChestnutLabs/gcode-preview/commit/caaa0fad0938bfa3ac1cd9f312f9cd2355c722d1), [`1c15c5e`](https://github.com/ChestnutLabs/gcode-preview/commit/1c15c5ea38f69aba99478cec60e4a0af28b9cae4)]:
  - @chestnutlabs/gcode-renderer-three@0.7.0
  - @chestnutlabs/toolpath-core@0.7.0
  - @chestnutlabs/gcode-containers@0.7.0

## 0.6.0

### Minor Changes

- [#304](https://github.com/ChestnutLabs/gcode-preview/pull/304) [`380b96e`](https://github.com/ChestnutLabs/gcode-preview/commit/380b96e5e4434e0e7d974cf8853fb6fd21d4dd0b) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - ModelRenderer **Phase 2 — 3MF multi-object / material / color** (DD-018), completing the v1 renderer.
  - `parse3mf(bytes)` and `renderModelStill({ kind: '3mf', bytes }, …)` — a multicolor 3MF renders to a
    **multicolor thumbnail without slicing**. Multiple objects, per-object build-item transforms, and
    **per-object or per-triangle solid colors** (`<basematerials displaycolor>` / `<m:colorgroup>`); sRGB
    → linear. Capability-honest: `materials`/`transforms`/`multiObject` report `'known'` only when the
    source actually carried them, else `'unavailable'` (neutral render, never fabricated).
  - The 3MF ZIP is opened with the hardened, zero-dep reader from `@chestnutlabs/gcode-containers`
    (zip-bomb / traversal / size caps reused, DD-005 §7); the model XML is parsed with a minimal,
    worker-safe scan (no `DOMParser`). Textures / non-color material properties are ignored, never fetched.
  - **`renderModelStill` is now async** (`Promise<RenderModelStillResult>`), because 3MF unzip uses
    `DecompressionStream` — matching the async `renderStill` on the toolpath side.
  - `MeshGeometry` gains an optional per-vertex `colors` buffer (for a single mesh carrying multiple
    colors); the renderer uses vertex colors when present.

- [#303](https://github.com/ChestnutLabs/gcode-preview/pull/303) [`7b8a29d`](https://github.com/ChestnutLabs/gcode-preview/commit/7b8a29d738d696e397a9f23e5f2bd3a8625ed29e) Thanks [@sobechestnut-dev](https://github.com/sobechestnut-dev)! - New package **`@chestnutlabs/gcode-model-renderer`** — a Three.js **presentation** renderer for source
  models, distinct from toolpath inspection (DD-018, Phase 1: the STL proving slice).
  - `renderModelStill(source, options)` — headless single-frame thumbnail preset (OffscreenCanvas /
    ANGLE→SwiftShader), mirroring `renderStill`; **transparent** or themed-solid background; deterministic
    export + a stable `(sourceHash, options, envId)` cache key.
  - `ModelRenderer` — sits on the shared render "stage" from `gcode-renderer-three` (framing pose, GL
    builder with `alpha`, GL type contracts); its own presentation studio lighting.
  - Three-free, **multi-object + material-capable** `ModelScene` from day one (STL is the degenerate
    single-object/no-material case; 3MF multi-object/material lands next). Capability-honest color: a model
    with no declared material renders neutral and reports `materials: 'unavailable'` — never fabricated.
  - STL binary + ASCII via three's `STLLoader`; bounded (`maxTriangles`/`maxSourceBytes`) with structured
    `ModelParseError`s. `three` is a peer dependency.

### Patch Changes

- Updated dependencies [[`277e148`](https://github.com/ChestnutLabs/gcode-preview/commit/277e1481ba015d6d0fa8d5b4e5ff6c7e014d494b), [`ac1e1f9`](https://github.com/ChestnutLabs/gcode-preview/commit/ac1e1f984305071db1a16fd8bbd7f1166b877d9d)]:
  - @chestnutlabs/gcode-renderer-three@0.6.0
  - @chestnutlabs/gcode-containers@0.6.0
  - @chestnutlabs/toolpath-core@0.6.0
