---
'@chestnutlabs/gcode-model-renderer': patch
---

A model 3MF with a single part over the per-entry size cap (`maxExpandedBytesPerEntry`, 512 MiB) is now
reported as `E_MODEL_TOO_LARGE`, the same as an archive over the total cap. It used to surface as
`E_MODEL_PARSE` with the container library's raw text. Corrupt or CRC-failing parts still report
`E_MODEL_PARSE`.
