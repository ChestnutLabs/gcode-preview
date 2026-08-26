---
"@chestnutlabs/gcode-dialects": minor
"@chestnutlabs/gcode-parser": patch
---

feat(dialects): ideaMaker adapter — `;TYPE:` roles + `PRINTING_ID` object membership (DD-026 T1)

New `ideaMaker()` dialect adapter (RR-007 §5.6), registered in the built-in worker set. It captures
ideaMaker's UPPERCASE `;TYPE:` feature roles and — crucially for `frameContent:'object'` — object
membership from ideaMaker's `;PRINTING: <name>` + `;PRINTING_ID: <n>` STATE channel: `PRINTING_ID:
-1` (with `;PRINTING: NON-OBJECT`) is housekeeping, `n≥0` is the printed object. Housekeeping (raft,
wipe tower) emitted under NON-OBJECT is correctly excluded from the object channel, so ideaMaker files
frame the model rather than the raft/tower. FDM geometry unchanged.
