---
'@chestnutlabs/gcode-renderer-three': patch
---

A consumer image draped on the build plate (`bedSurface.texture`) now renders in its true colours. It
was sampled as linear instead of sRGB, so every textured plate looked lighter and flatter than
authored (a `#404040` image rendered as `#898989`). This applies to rectangular and non-rectangular
(circular/polygon) beds; untextured plates were already correct.
