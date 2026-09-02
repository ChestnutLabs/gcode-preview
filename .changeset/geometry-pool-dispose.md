---
"@chestnutlabs/gcode-renderer-three": patch
---

Fix `GeometryWorkerPool.dispose()` hanging an in-flight build. Disposing the pool mid-build (e.g. on canvas rebind or renderer teardown) dropped the parked build requests without settling them, so the streaming build's `Promise.all` never resolved and the build coroutine leaked. Dispose now rejects in-flight requests and the build stops cleanly.
