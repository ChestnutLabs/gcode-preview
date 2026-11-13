---
'@chestnutlabs/gcode-colors': patch
---

`fallback: null` now means "use the default" instead of throwing. In `tool` and `filament` colour modes, a
`null` `fallback` behaves exactly like an omitted one (the neutral grey). A `null` `range` in `feedrate`,
`layerHeight` and `power` mode now means "auto-range" like an omitted `range`, instead of throwing a
`TypeError`. This lets a framework binding pass `x ?? null` straight through. Only `null` and `undefined` mean
"unset": `false`, `0` and `''` are still bad values and throw. A required `fallback` (every other mode) and any
other bad colour still throw a `RangeError`.

A `range` that is not a two-element array (`5`, `{}`, `false`, `''`, `[]`, `[1, 2, 3]`) now throws a
`RangeError` too, where `5`, `{}` and `false` used to throw a `TypeError` from the destructure. A three-element
array was accepted before, with the third value ignored; it is now rejected, because the type is `[number, number]`.
