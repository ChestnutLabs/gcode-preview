---
'@chestnutlabs/gcode-renderer-three': patch
---

Mark `CapabilityHint` and `resolveCapability` as `@experimental` and diagnostic-only in their TSDoc: no entry point accepts a `capabilityHint` option and they have no effect on rendering or budgets until capability-aware budgets ship. No behaviour change.
