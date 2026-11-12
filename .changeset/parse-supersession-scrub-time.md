---
'@chestnutlabs/gcode-preview-core': patch
---

Replacing the source several times in one tick now applies only the last file, and a time scrub draws the right number of segments (#529, #435).

- **Rapid source changes.** Setting `source` (or calling `parse()`) three times in one tick used to run
  two parses at once: you got a spurious `parse-error` event, and which file ended up on screen
  depended on timing. Now only the newest call runs. The superseded calls resolve as
  `{ ok: false, cancelled: true }`. A parse that was already running reports `parse-cancelled`, and its
  result is dropped even if it had finished first. A call that never started emits no event. This is the
  same in Vue, React, Svelte and the Web Component, which share this controller.
- **`setScrubTime(ms)` no longer draws one segment too many.** A scrub at 0 ms drew the first segment,
  and a scrub at the end of segment 5 drew segments 0 to 5. It now draws exactly the segments finished
  by `ms`, and nothing before the first one ends.
