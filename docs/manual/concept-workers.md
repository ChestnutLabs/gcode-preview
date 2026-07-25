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
