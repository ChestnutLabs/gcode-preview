---
'@chestnutlabs/gcode-preview-core': minor
---

`renderStill` now accepts `qualityMode` (`'full' | 'adaptive' | 'fast'`), the same option the interactive viewer already has. Omitted, it stays `'adaptive'` and nothing changes. `'full'` skips the `tubeByteBudget` tubes-to-lines fallback; `'fast'` renders flat lines.
