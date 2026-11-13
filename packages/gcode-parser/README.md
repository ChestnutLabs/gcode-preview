# @chestnutlabs/gcode-parser

Worker-safe G-code parse core and session client for the Chestnut Labs G-code Preview stack
(design: DD-003). Parses `.gcode` / `.gcode.3mf` **off the main thread** into
[`ToolpathIR`](../toolpath-core/README.md), with streaming input, progressive partial previews for large
files, resource limits, cancellation, and an adversarial-input corpus behind it.

```ts
import { GcodeParseSession } from '@chestnutlabs/gcode-parser';

const session = new GcodeParseSession(); // batteries worker: all dialects + .gcode.3mf
const result = await session.parse(bytes, {
  onPartial: (ir) => render(ir), // progressive preview
  onProgress: (p) => bar(p)
});
render(result.ir);
session.dispose();
```

> **Bytes are handed to the worker, not copied.** A `Uint8Array` passed to `parse()` has its buffer
> transferred to the worker, so it is empty (`byteLength === 0`) afterwards. To parse the same file
> again, for example to switch plates with `{ plate: 1 }`, keep a copy and pass `bytes.slice()`
> each time. Passing the already-transferred bytes rejects with `E_POST_FAILED`, with the browser's
> `DataCloneError` on `error.cause`; the session stays usable.

> **Coordinates are always millimetres.** A file that declares inches (`G20`) is converted while it is parsed, so
> every renderer, the bounds and the stats see millimetres. `ir.header.units` still reads `'in'`, because it records
> what the file declared, and the parse result carries a `units-converted` info warning.

If the worker can't be created (for example, a strict Content Security Policy blocks the worker URL),
`parse()` rejects with `E_WORKER_CREATE_FAILED`. The message keeps the browser's text, and `error.cause`
holds the original error (a `SecurityError`, say). The session stays usable: the next `parse()` tries to
create the worker again.

## Workers

- **Batteries default (zero setup):** the session creates its own worker via the bundler-native
  `new Worker(new URL('./worker.js', import.meta.url))` pattern — all supported dialect adapters
  plus `.gcode.3mf` container support. Vite resolves it out of the box (CI-tested).
- **Slim / custom:** pass a worker factory for the slim build (no dialects/containers), your own
  adapter set via `createWorkerHandler(...)`, other bundlers, or strict-CSP environments.

Wire options accept dialect selection, container/plate selection (`plate` for multi-plate
`.gcode.3mf`), and resource limits. Most applications should consume this through
[`@chestnutlabs/gcode-preview-core`](../gcode-preview-core/README.md) or a framework adapter rather than
directly.

Resource limits are validated: a limit that is not a non-negative safe integer throws a `ParseOptionError`
(`code: 'E_PARSE_OPTION'`) instead of silently disabling the bound. There is no `Infinity` for "unlimited";
pass a large integer. `limits.maxInputBytes` has a ceiling of 4 294 967 295 bytes (2^32 - 1), because
source byte offsets are stored in 32 bits; a larger value also throws `E_PARSE_OPTION`.

A `( … )` comment is ignored on every line, so `G1 X1 Y1 (then G1 X99)` moves to X1 Y1 only. Arcs and
canned cycles that cannot be drawn exactly as written are drawn the nearest way and reported in
`ir.header.warnings`; the codes are listed in the
[motion coverage reference](../../docs/compatibility/gcode-motion-coverage.md#moves-drawn-differently-from-what-was-written).

Part of [Chestnut Labs G-code Preview](../../README.md) · MIT
