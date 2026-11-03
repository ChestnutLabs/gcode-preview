---
"@chestnutlabs/gcode-containers": patch
---

Fix a hostile `.gcode.3mf` / 3MF file freezing the load instead of failing with an error. When a compressed entry's headers claimed a small size but the data expanded past the size limit, `streamEntry` (and `extractEntry`, `openGcode3mf` plate streaming, and 3MF model loading on top of it) stopped reading and then waited forever for the decompressor, so the load never finished. It now rejects with `E_CONTAINER_LIMIT_EXPANDED` as intended. Leaving a `streamEntry` loop early (`break` / `return()`) also releases the decompressor now, where it previously stayed pending.
