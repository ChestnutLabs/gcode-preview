---
"@chestnutlabs/gcode-renderer-three": patch
---

fix(renderer): geometry-pool failure degrades to serial tubes, never an unhandled rejection (DD-028)

A tube build that engaged the worker pool could fail two ways that weren't both handled: a **runtime**
worker error fell back to *lines*, and a **synchronous construction** failure — `new Worker(new
URL('./geometry-worker.js', import.meta.url), { type: 'module' })` throwing when a bundler leaves
`import.meta.url` undefined (e.g. an esbuild `format: 'iife'` bundle) — escaped the build's try/catch on
a fire-and-forget call and surfaced as an **unhandled promise rejection**, with no fallback at all.

Both failure modes now degrade to a **serial main-thread tube build** via the new internal
`fallbackToSerialTubes`, not to lines: the pool was sized against the memory budget, so the tubes
already fit — only the worker couldn't run — so the quality is preserved (identical scene to
`geometryConcurrency: 'off'`). A genuine memory/budget limit still degrades to lines downstream through
the serial build's own tube-budget path. The degradation is recorded as a `RenderStats` disclosure
(`pool→serial-tubes: …`) and `buildParallelism` flips to `'main'` — never silent. A defensive `.catch`
at the call site guarantees no unhandled rejection can escape.

This makes the DD-028 pool safe to enable in headless bundlers that can't construct the module-worker
URL: a failed/absent worker now costs single-threaded tube quality, not a broken render.
