---
"@chestnutlabs/gcode-dialects": patch
---

fix(orca-bambu): capture real OrcaSlicer `;TYPE:` features and `; printing object` labels (DD-026 T1)

The Orca/Bambu adapter only matched Bambu Studio's `; FEATURE:` comments and a `; start printing
object, id:<n>` object marker. Real OrcaSlicer / AnycubicSlicerNext output (RR-007 §5.8) uses
`;TYPE:<vocab>` for features and `; printing object <name> id:<id>` (no "start", and the id can
exceed Uint32) — so those files got **no** feature roles and **no** object channel, which left
`frameContent:'object'` with an empty `objectBounds` (it framed all extrusion, including a bed-edge
prime line).

The adapter now accepts `;TYPE:` in addition to `; FEATURE:` (same Orca vocabulary), and matches the
object-start marker across all lineage formats (Bambu `start printing object, unique label id:` with a
trailing `name:`; OrcaSlicer `printing object <name> id:<big id>`; AnycubicSlicer/Prusa-lineage
`printing object "<name>" id:<n> copy <m>`). Each distinct object id maps to a sequential 1-based
channel value (raw ids can exceed Uint32), reused across per-layer re-bracketing. Real OrcaSlicer
files without `EXCLUDE_OBJECT` now resolve `featureRoles:'known'` + `objects:'known'`, restoring
object-aware framing. FDM geometry unchanged.
