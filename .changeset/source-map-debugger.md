---
'@chestnutlabs/toolpath-core': minor
'@chestnutlabs/gcode-renderer-three': minor
'@chestnutlabs/gcode-preview-core': minor
---

Source-line ↔ segment mapping (#184) — the "G-code debugger" surface. Additive; no IR/geometry change.

- `toolpath-core`: framework-free primitives over `segments.srcByte` + `sourceIndex`: build a line
  index (`buildSourceLineIndex`), then `lineAtByte` / `byteRangeOfLine` / `sourceLineOfSegment`
  (segment → its 1-based source line) / `segmentAtSourceLine` (line → segment, -1 when the line
  produced none). Both directions, O(log n).
- `gcode-renderer-three`: `ToolpathRenderer.pickSegment(ndcX, ndcY, threshold?)` raycasts the
  toolpath and returns the IR segment under a pointer (or null) — click a segment → its source line.
  The pure index-mapping helper `resolveHitSegment(mesh, vertexIndex)` is exported and unit-tested.
- `gcode-preview-core`: `PreviewRenderer.pickSegment` (the 2D renderer returns null — no picking yet),
  reachable via `raw.renderer()`.
