---
"@chestnutlabs/gcode-model-renderer": minor
---

ModelRenderer **Phase 2 — 3MF multi-object / material / color** (DD-018), completing the v1 renderer.

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
