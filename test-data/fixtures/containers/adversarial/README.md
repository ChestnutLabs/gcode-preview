# Adversarial container inputs (Packet 2 sweep, G1)

Tiny `.gcode.3mf` archives that each break exactly one guard in `packages/gcode-containers`
(`zip.ts`, `gcode-3mf.ts`). Generated deterministically by `node tools/fixtures/make-gcode-3mf.mjs`
and tracked in `test-data/manifest.json`. The unit tests in
`packages/gcode-containers/src/__tests__/` assert each outcome below, and the weekly fuzz job
(`.github/workflows/fuzz-containers.yml`) seeds its corpus from this folder.

| Fixture | What it breaks | Expected outcome |
|---|---|---|
| `adv-metadata-bad-crc.gcode.3mf` | `project_settings.config` CRC does not match its bytes | opens; `container-metadata-invalid` warning (CRC mismatch) |
| `adv-metadata-size-lie.gcode.3mf` | `project_settings.config` headers claim 1 B fewer than it inflates to | opens; `container-metadata-invalid` warning (size differs) |
| `adv-zip64-eocd.gcode.3mf` | EOCD central-directory offset = `0xFFFFFFFF` | `E_CONTAINER_ZIP64` |
| `adv-cd-past-eof.gcode.3mf` | EOCD central-directory offset = end of file | `E_CONTAINER_FORMAT` |
| `adv-nul-name.gcode.3mf` | an entry name containing NUL | NUL entry dropped (`container-entry-hostile-name`); plate opens |
| `adv-method-12.gcode.3mf` | plate stored with method 12 (bzip2) | `E_CONTAINER_METHOD` when the plate is streamed |
