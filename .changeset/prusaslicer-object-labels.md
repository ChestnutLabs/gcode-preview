---
"@chestnutlabs/gcode-dialects": patch
---

fix(prusaslicer): capture `; printing object` labels; share the object-marker parser (DD-026 T1)

The PrusaSlicer adapter captured feature roles but **no** object channel, so a Prusa file sliced with
*Label objects* on (RR-007 §5.1 — `; printing object <name> id:<n> copy <m>`) left
`frameContent:'object'` with an empty `objectBounds`. It now tracks object membership.

The object-start parsing (across all Prusa/Orca/Bambu lineage formats) is extracted into a shared
`PrintingObjectTracker` (`object-markers.ts`); the OrcaSlicer/Bambu adapter is refactored onto it, so
the two adapters can't drift. Each distinct slicer id maps to a sequential 1-based channel value (raw
ids can exceed Uint32). FDM geometry unchanged.
