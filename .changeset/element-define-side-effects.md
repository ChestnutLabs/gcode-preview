---
'@chestnutlabs/gcode-preview-element': patch
---

`import '@chestnutlabs/gcode-preview-element/define'` (and `/model/define`) now registers `<gcode-preview>` (and
`<gcode-model-viewer>`) in production builds too.

Before, the package told bundlers that none of its files had side effects, so a production build (Vite, Rollup,
webpack) dropped the one-line import. The tags stayed plain, unregistered elements and nothing drew. A dev server
never shows this, because it doesn't tree-shake. The package now lists the two registration files as side effects,
and nothing else changes: the main entry still tree-shakes as before.

If you worked around this by calling `defineGcodePreview()` / `defineGcodeModelViewer()` yourself, that keeps
working; registering twice is a no-op.
