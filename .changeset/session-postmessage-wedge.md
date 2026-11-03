---
"@chestnutlabs/gcode-parser": patch
---

Fix the preview getting stuck after re-parsing the same bytes. Parsing a `Uint8Array` hands its buffer to the worker, which leaves it empty. Parsing that same array again (for example to show a different plate) made the send to the worker fail, and the session never cleared its in-progress parse, so every later parse, even of a new file, failed with `E_BUSY` until the preview was disposed. That parse now fails cleanly with `E_POST_FAILED` and the preview keeps working. To parse the same file again, pass a copy (`bytes.slice()`).
