# @chestnutlabs/gcode-parser

Worker-safe G-code parse core and session client for the Chestnut Labs G-code Preview stack
(design: DD-003). Parses `.gcode` / `.gcode.3mf` **off the main thread** into
[`ToolpathIR`](../toolpath-core), with streaming input, progressive partial previews for large
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

## Workers

- **Batteries default (zero setup):** the session creates its own worker via the bundler-native
  `new Worker(new URL('./worker.js', import.meta.url))` pattern — all supported dialect adapters
  plus `.gcode.3mf` container support. Vite resolves it out of the box (CI-tested).
- **Slim / custom:** pass a worker factory for the slim build (no dialects/containers), your own
  adapter set via `createWorkerHandler(...)`, other bundlers, or strict-CSP environments.

Wire options accept dialect selection, container/plate selection (`plate` for multi-plate
`.gcode.3mf`), and resource limits. Most applications should consume this through
[`@chestnutlabs/gcode-preview-core`](../gcode-preview-core) or a framework adapter rather than
directly.

Part of [Chestnut Labs G-code Preview](../../README.md) · MIT
