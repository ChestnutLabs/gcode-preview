---
'@chestnutlabs/gcode-parser': patch
---

Invalid parse limits now throw instead of silently turning the limit off.

Each `limits` field (`maxInputBytes`, `maxSegments`, `maxBufferBytes`, `maxLineLength`, `maxWarnings`,
`maxProgramIterations`, `maxCallDepth`) must be a non-negative integer. Before, `NaN` switched the bound
off, so a looping RS274NGC program such as `o1 while [1]` / `o1 endwhile` never returned. `Infinity`, a
negative number, a fraction, `null` and a string were accepted too and gave no real bound.

- **What changes for you:** a bad value now throws a `ParseOptionError` with `code: 'E_PARSE_OPTION'` before
  any parsing starts. Through a parse session (the worker) the same code arrives on the rejection, and the
  session stays usable. There is no "unlimited" value; pass a large integer such as `Number.MAX_SAFE_INTEGER`
  if you really want a high bound.
- **Unchanged:** a field that is left out or `undefined` keeps its default, and `0` is still allowed.
- `ParseOptionError` is exported from `@chestnutlabs/gcode-parser`.
