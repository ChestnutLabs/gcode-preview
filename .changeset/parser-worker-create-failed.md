---
'@chestnutlabs/gcode-parser': patch
'@chestnutlabs/gcode-preview-core': patch
---

A worker that can't be created no longer leaves the preview stuck on "parsing".

- **The preview recovers.** If `createWorker` (or the default worker) throws, for example `SecurityError` under a strict
  Content Security Policy, the preview used to emit `parse-started`, throw out of `parse()`, and stay at
  `parsing: true` with no `parse-error`. It now emits `parse-error` with code `E_WORKER_CREATE_FAILED`, sets
  `state.error`, and returns to `parsing: false`. The next `parse()` tries to create the worker again. All four
  adapters inherit this.
- **Error shape change for `GcodeParseSession` and `renderStill` callers.** `session.parse()` and `renderStill()` now
  reject with a `ParseSessionError` whose `code` is `E_WORKER_CREATE_FAILED`, instead of the raw error the factory
  threw. The message keeps the original text (`could not start the parse worker: <original message>`), and the
  original error is on `error.cause`. **If you match on the original error, for example `err.name === 'SecurityError'`,
  read `err.cause.name` instead.** `session.parse()` no longer throws synchronously in this case.
