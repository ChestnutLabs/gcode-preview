# E7 phase 3 — publish dry-run proof (2026-07-23, #130)

`npm run release:dry-run` (tools/release/publish.mjs --dry-run): dependency-ordered
`npm publish --dry-run --provenance --access public` ×9 with the pre-release `private`
flag temporarily stripped and restored — the full pack + validation path, no upload.
Versions are the pre-release `0.0.0` line; the identical flow publishes `0.1.0` at phase 7.

Result: **9/9 OK**. Internal `@chestnutlabs/*` ranges are the exact synced versions
(`tools/release/sync-internal-ranges.mjs`; guarded by `release:sync-check` in the publish gate) —
the development-time `*` wildcard no longer exists in any manifest.

| Package | Files | Size | Internal deps (exact) |
|---|--:|--:|---|
| `@chestnutlabs/toolpath-core@0.0.0` | 23 | 16.1 kB | — |
| `@chestnutlabs/gcode-dialects@0.0.0` | 29 | 14.9 kB | @chestnutlabs/toolpath-core@0.0.0 |
| `@chestnutlabs/gcode-containers@0.0.0` | 11 | 9.3 kB | @chestnutlabs/toolpath-core@0.0.0 |
| `@chestnutlabs/gcode-parser@0.0.0` | 29 | 29.4 kB | @chestnutlabs/toolpath-core@0.0.0<br>@chestnutlabs/gcode-dialects@0.0.0<br>@chestnutlabs/gcode-containers@0.0.0 |
| `@chestnutlabs/gcode-renderer-three@0.0.0` | 23 | 26.5 kB | @chestnutlabs/toolpath-core@0.0.0 |
| `@chestnutlabs/gcode-preview-core@0.0.0` | 11 | 9.7 kB | @chestnutlabs/gcode-parser@0.0.0<br>@chestnutlabs/gcode-renderer-three@0.0.0<br>@chestnutlabs/toolpath-core@0.0.0 |
| `@chestnutlabs/gcode-preview-vue@0.0.0` | 11 | 8.8 kB | @chestnutlabs/gcode-parser@0.0.0<br>@chestnutlabs/gcode-renderer-three@0.0.0<br>@chestnutlabs/toolpath-core@0.0.0<br>@chestnutlabs/gcode-preview-core@0.0.0 |
| `@chestnutlabs/gcode-preview-react@0.0.0` | 11 | 6.8 kB | @chestnutlabs/gcode-parser@0.0.0<br>@chestnutlabs/gcode-preview-core@0.0.0<br>@chestnutlabs/gcode-renderer-three@0.0.0<br>@chestnutlabs/toolpath-core@0.0.0 |
| `@chestnutlabs/gcode-preview-svelte@0.0.0` | 9 | 5.5 kB | @chestnutlabs/gcode-parser@0.0.0<br>@chestnutlabs/gcode-preview-core@0.0.0<br>@chestnutlabs/gcode-renderer-three@0.0.0<br>@chestnutlabs/toolpath-core@0.0.0 |
