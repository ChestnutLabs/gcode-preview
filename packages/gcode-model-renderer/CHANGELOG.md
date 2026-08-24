# @chestnutlabs/gcode-model-renderer

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
