---
'@chestnutlabs/gcode-parser': patch
---

Three fixes to how the parser handles streams, workers and containers. When a streamed parse ends early (a limit is hit, it is cancelled, or the source fails), the parser now cancels the source stream instead of leaving it producing data nobody reads. A `GcodeParseSession` built around a single `Worker` instance (not a factory) used to hang forever on the next `parse()` after that worker was terminated by the cancel backstop, a crash or `dispose()`; it now rejects with `E_WORKER_TERMINATED`, and sessions built with a worker factory still start a fresh worker as before. A container `plate` that is not a whole number (`NaN`, `1.5`) is now refused with `E_CONTAINER_NO_PAYLOAD` instead of reaching the container. Parsed output of the bundled test corpus is unchanged.
