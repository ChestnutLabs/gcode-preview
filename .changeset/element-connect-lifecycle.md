---
"@chestnutlabs/gcode-preview-element": patch
---

Fix `<gcode-preview>` connect/disconnect defects: the initial `view` attribute (and a `cameraState` set before connect) are now applied on connect instead of being dropped, and `hidden-feature-roles` is re-applied after the element is moved/reconnected in the DOM (previously the hidden roles reappeared permanently on reconnect).
