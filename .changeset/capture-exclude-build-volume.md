---
"@chestnutlabs/gcode-renderer-three": minor
---

`CaptureOptions` gains `includeBuildVolume?: boolean` (default `true`). Set it to `false` to exclude
the whole build-volume group (grid + bed surface + origin + cage) from the off-screen capture render
only — so `capture({ background: 'transparent', includeBuildVolume: false })` produces a clean
toolpath-only cutout, matching `ModelRenderer` thumbnails. The live view is untouched (visibility is
restored synchronously, no intermediate frame is painted). The option flows through
`GcodePreviewControls.capture` to every adapter; it is a no-op where there is no build volume
(`ModelViewer`) or no capture (the 2D renderer).
