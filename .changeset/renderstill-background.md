---
"@chestnutlabs/gcode-preview-core": minor
---

Add a `background` convenience option to `renderStill` (#306): `'transparent'` composites the still on a
consumer card (creates an alpha GL context so the unset scene background shows through), or a solid
`ThemeColor` paints a themed backdrop. Shorthand for wiring `theme.background` + an alpha `createRenderer`
yourself — so a presentation card thumbnail is `renderStill(ir, { quality: 'tubes', showTravel: false,
showWipe: false, background: 'transparent' })` (no build volume, extrude-only framing). An explicit
`theme.background` or `createRenderer` you pass still wins.
