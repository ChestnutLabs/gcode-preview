---
'@chestnutlabs/gcode-preview-core': minor
---

`renderStill` now accepts `qualityMode` (`'full' | 'adaptive' | 'fast'`, DD-023 §5), forwarded to the renderer as `GcodePreview` already does. Omitted, it stays `'adaptive'` and nothing changes. `'full'` skips the `tubeByteBudget` tubes-to-lines fallback; `'fast'` renders flat lines (#435).
