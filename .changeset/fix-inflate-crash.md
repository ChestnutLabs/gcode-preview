---
'@chestnutlabs/gcode-containers': patch
---

Fix a process crash on corrupt deflate data in `streamEntry`: an unobserved
`DecompressionStream` writer-side rejection surfaced as an unhandled rejection even though the
reader path already produced `E_CONTAINER_INFLATE`. The writer promise is now captured and
re-raised as a typed `ContainerError`. Found by the new coverage-guided container fuzzing (#131);
a minimized regression fixture is committed.
