---
'@chestnutlabs/gcode-colors': patch
---

`fallback: null` now means "use the default" instead of throwing. In `tool` and `filament` colour modes, a
`null` `fallback` behaves exactly like an omitted one (the neutral grey). A `null` `range` in `feedrate`,
`layerHeight` and `power` mode now means "auto-range" like an omitted `range`, instead of throwing a
`TypeError`. This lets a framework binding pass `x ?? null` straight through. A required `fallback` (every
other mode) and any other bad colour still throw a `RangeError`.
