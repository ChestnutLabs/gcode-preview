# Fuzzing regression corpus (`gcode-containers`, #131 / DD-008 D7)

Minimized inputs from coverage-guided fuzzing (Jazzer.js) of `readDirectory` / `streamEntry`.
Each is a **small, deterministic, legal, redistributable** reproduction — never a raw crash blob
and never anything carrying private or copyrighted data. They are replayed on every PR by
`packages/gcode-containers/src/__tests__/fuzz-corpus.test.ts`; the property is *only typed
`ContainerError`s escape, and the process never crashes*.

Adding a finding (per SECURITY.md triage): reproduce → fix the code → minimize the input to the
smallest bytes that still reproduced the pre-fix crash → construct it deterministically (document
how, as with `deflate-corrupt-stream.zip`) → add a manifest entry → drop it here. The per-PR test
picks it up automatically.

| Fixture | Reproduces |
|---|---|
| `deflate-corrupt-stream.zip` | An unobserved `DecompressionStream` writer-side rejection on corrupt deflate data crashed the process as an unhandled rejection (the reader path had already converted its copy to `E_CONTAINER_INFLATE`). Fixed by capturing the writer promise instead of floating it. |
