---
title: Workers, streaming & performance
group: Concepts
category: Concepts
---

# Workers, streaming & performance

## Off the main thread by default

Parsing runs in a **Web Worker** so a large file never blocks the UI. The adapters create the
worker for you; the low-level entry point is **`GcodeParseSession`** (`@chestnutlabs/gcode-parser`),
a session client that speaks a small versioned protocol to the worker.

## Streaming & progressive preview

Input is **streamed** into the parser, and the renderer can append geometry as it arrives — so a
large print shows a growing preview (time-to-first-paint) rather than a spinner until the whole file
is parsed. The session reports progress as it goes.

The **`progressivePreview`** prop chooses how that stream is presented (3D):

- **`'lines'`** (default) — show the growing line preview as it parses, then swap in the final build.
  Fast visual feedback; best when a quick "it's working" signal matters more than a single reveal.
- **`'hold'`** — keep reporting progress (drive your own bar from the `parse-progress` bytes), but
  show nothing until the finished, correctly-coloured model is ready, then reveal it in one pass. Use
  this when the streamed preview would render before the file's own colours are known and read as
  "rendering twice."
- **`'off'`** — no built-in preview at all; you supply your own loading treatment until the model is
  ready.

`progressivePreview` only affects what shows *while parsing* — it never changes the final image or its
quality.

## Bounded by design

Untrusted input is treated as untrusted. The parser enforces **resource limits** — maximum input
bytes, maximum segments, and a cumulative allocation budget — and returns a **structured, bounded
partial result** when a limit is hit (with a `stopReason`) instead of hanging or crashing. An
adversarial-input corpus exercises these paths in CI. Container extraction (`.gcode.3mf`) is
likewise hardened against zip-bombs and path traversal.

## The batteries worker, and the escape hatch

- **Default (zero setup):** the adapters build the *batteries* worker — every supported dialect
  adapter plus `.gcode.3mf` support — via the bundler-native `new Worker(new URL(...))` pattern.
  Vite resolves it out of the box.
- **Custom:** pass **`createWorker`** for a slim build, custom dialect adapters, other bundlers, or
  strict-CSP environments. Both paths are first-class.

## Rendering performance

The Three.js renderer keeps interactions cheap: **layer chunks** with decimation disclosure, layer
clip and segment scrub as **draw-range** updates (no geometry rebuilds), tube-or-line geometry with
automatic quality fallback, per-file build plates, and WebGL context-loss recovery. Pair a bounded
parse with draw-range navigation and even very large toolpaths stay responsive.

| Tubes | Lines |
|---|---|
| ![The calicat as lit 3D extrusion tubes](../media/render-tubes.png) | ![The calicat as flat single-pixel toolpath lines](../media/render-lines.png) |
| Lit 3D cross-sections — the default for models that fit the geometry budget. | Flat one-pixel paths — lighter, for very large files or low-GPU devices. |

A **parallel geometry worker pool** builds the tubes off the main thread (byte-identical to serial,
degrading pool → serial → lines under a memory budget, all disclosed), and **`getRenderStats()`**
reports exactly what happened — backend, hardware-vs-software GPU, draw calls, and timings — so "why
is this slow / what am I running on" is answerable, never guessed.
