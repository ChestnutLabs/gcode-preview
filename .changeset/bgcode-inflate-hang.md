---
'@chestnutlabs/gcode-bgcode': patch
---

A hostile `.bgcode` whose DEFLATE block inflates past the output cap (or past its own declared size) now
fails promptly with `E_BGCODE_BOMB`. Before, the decoder threw internally but then waited forever on
the platform inflater, so loading such a file froze instead of erroring. Same fix as the
`.gcode.3mf` / 3MF stream fix in `@chestnutlabs/gcode-containers`.
