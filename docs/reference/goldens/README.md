# `capture()` colour-space golden — v0.20.1

Validation reference for the **v0.20.1** fix to `controls.capture()` / `ModelViewer.capture()`
(issue: interactive capture read back **linear** pixels instead of sRGB, so captured thumbnails were
too dark). This is the artifact AnyBridge (and any consumer using `capture()` for thumbnails) should
validate a regenerated thumbnail against.

## What changed

The interactive capture path rendered the scene into an off-screen `WebGLRenderTarget` whose texture
did not declare sRGB, so `readRenderTargetPixels` returned **linear-space** bytes — no sRGB output
encoding, unlike the canvas and unlike `renderStill`. v0.20.1 sets the capture target's texture to
`SRGBColorSpace`, so a captured image now matches the on-screen view.

Fix: `packages/gcode-renderer-three/src/interactive-stage.ts` (`capture()` → `target.texture.colorSpace = SRGBColorSpace`).

## Validation values (GPU-independent)

Validate **by sampling a flat interior region and comparing the colour value** — not by hashing the
PNG. A pixel-exact hash is not portable: these reference images were rendered on SwiftShader (software
WebGL), so edge antialiasing differs from a hardware GPU (e.g. AnyBridge's RTX 4070). Flat interior
regions and the background are colour-stable across GPUs.

| Region | Input (sRGB) | After fix (v0.20.1) | Before fix (buggy, linear) |
|---|---|---|---|
| Scene background | `#6d7176` | **`#6d7176`** ✅ (round-trips) | `#272a2e` ❌ (too dark) |

General mapping (per 8-bit channel) for any solid colour `C` that was affected before the fix:

```
before = round( sRGB_to_linear(C/255) * 255 )
  where sRGB_to_linear(s) = s <= 0.04045 ? s/12.92 : ((s + 0.055)/1.055) ^ 2.4
```

So after the fix, a flat region whose source colour is sRGB `C` reads back as `C` (was the darker
`before(C)`). AnyBridge's sidecar calls `capture({ background: 'transparent' })`: the background alpha
was always correct (a clean cutout); it was the **geometry/feature colours** that were darkened, and
those are now sRGB-correct.

## The reference captures

Both were produced through the real render-to-target `capture()` path via
[`tools/screenshots/capture-golden.mjs`](../../../tools/screenshots/capture-golden.mjs) (run against
the Feature Lab on `:5199`), on its default fixture in feature-role colour mode:

- **`capture-golden-grey.png`** — `capture({ background: '#6d7176' })`. The background samples exactly
  `#6d7176`; use it to confirm the background round-trips.
- **`capture-golden-transparent.png`** — `capture({ background: 'transparent' })`, AnyBridge's exact
  call. Transparent background; the toolpath/feature colours are the sRGB-correct values.

Regenerate with `node tools/screenshots/capture-golden.mjs` (Feature Lab running on `:5199`).
