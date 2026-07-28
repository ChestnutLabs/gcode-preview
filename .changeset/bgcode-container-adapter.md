---
'@chestnutlabs/gcode-bgcode': minor
'@chestnutlabs/gcode-parser': minor
---

Register `.bgcode` as a **container adapter** so it flows through the existing parser pipeline
(DD-011 phase 4c, #188). A `.bgcode` file now "just works" through `GcodeParseSession` with
`containers: 'auto'` — sniffed by magic, decoded to plain G-code, and parsed to the same IR as the
plain `.gcode` (proven by the golden-equivalence test).

- `gcode-bgcode`: `openBgcodeContainer(bytes)` implements the DD-005 §4.4 `{ id, sniff, open }` shape
  (single plate; `openPlate(0)` streams the decoded G-code). `openBgcode(bytes, { metadata: true })`
  now also decodes the metadata (INI) and thumbnail blocks, so the adapter surfaces **machine geometry
  from `bed_shape`**, whitelisted slicer settings (feeding dialect detection + provenance), and
  thumbnails.
- `gcode-parser`: the batteries worker registers the `bgcode` adapter beside `gcode-3mf`.

Verified end-to-end: a real Prusa XL cube `.bgcode` parses through the session to 11,417 segments with
a 360×360 bed and `printer_model` metadata.
