---
"@chestnutlabs/gcode-renderer-three": minor
"@chestnutlabs/gcode-preview-core": minor
"@chestnutlabs/gcode-preview-vue": minor
"@chestnutlabs/gcode-preview-react": minor
"@chestnutlabs/gcode-preview-svelte": minor
"@chestnutlabs/gcode-preview-element": minor
---

`progressivePreview` — a during-parse preview curtain over the #60 streaming preview

New public option/prop/attribute (renderer + core controller + all four adapters), plus a
`setProgressivePreview` control. It governs only what shows WHILE parsing — orthogonal to
`quality`/`qualityMode`, which govern the FINAL representation:

- **`'lines'`** (default, backward-compatible): stream the progressive line preview as it parses,
  then replace it with the final build. Existing behaviour — unchanged for current consumers.
- **`'hold'`**: keep parsing/building and keep emitting progress (`previewAppend`; `parse-progress`
  flows in every mode), but reveal NO incomplete/neutral line preview — the first thing shown is the
  final, correctly-coloured, policy-quality build. A single clean reveal with a live progress signal,
  removing the "renders neutral, then re-renders coloured" double-take on streamed files.
- **`'off'`**: suppress the progressive preview entirely (no geometry, no `previewAppend`) — the
  consumer supplies its own loading/progress treatment until the final build is revealed.

The revealed representation is always the policy-correct one (full tubes at `full`, disclosed lines
at `adaptive` per budget) — never a silent large-file lines fallback (DD-023 alignment). 3D only;
the 2D renderer is a no-op (it has its own low-resource progressive cut).
