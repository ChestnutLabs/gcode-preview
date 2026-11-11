---
'@chestnutlabs/gcode-renderer-three': patch
---

Fix `interactionQuality: 'auto'` (reduced detail while orbiting), which is on by default in the model viewer:

- No more permanent resolution jump after the first orbit on HiDPI screens. The view used to return at
  the screen's full device pixel ratio after the first orbit, which can be 4× the pixels it started with.
  It now returns to the resolution it had before you moved the camera.
- A custom pixel ratio you set on your renderer (for example through `createRenderer`) is preserved
  through orbits and through `setInteractionQuality('off')`. Switching to `'off'` no longer resets it.
- Adaptation now follows the real frame rate. A slow GPU gets coarser detail while you orbit, and a fast
  one returns to full detail. Before, almost every frame measured as fast, so detail was back to full
  within a few mouse moves on any machine. A single slow frame does not change the detail level.
- The pixel ratio is no longer reset on every mouse move during a drag, only when the detail level
  actually changes.

At rest the image is unchanged: full detail at the renderer's own pixel ratio. `GLRendererLike` gains an
optional `getPixelRatio()` (three's `WebGLRenderer` already has it), and `InteractionQualityDeps` gains
optional `getPixelRatio`, `requestFrame` and `cancelFrame` for custom hosts.
