---
'@chestnutlabs/gcode-preview-react': patch
---

`onDisclosure` on the React `<GcodePreview>` now reports the current build's disclosure (it used to report
an empty string on the first build and the previous build's text after that).
