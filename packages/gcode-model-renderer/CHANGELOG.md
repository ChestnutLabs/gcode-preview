# @chestnutlabs/gcode-model-renderer

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
