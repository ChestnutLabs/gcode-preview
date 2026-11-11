---
'@chestnutlabs/gcode-model-renderer': patch
---

Fix hangs when loading a crafted Bambu/Orca `.3mf`. Reading `Metadata/model_settings.config` took time
quadratic in the config size in three places: the plate layout (many `<plate` tags with no closing tag),
each plate's `<model_instance>` list, and the per-object/part extruder colours (many `<object id="…"`
headers with no closing `>`). A few hundred KiB froze the load for seconds and a few MiB for minutes. All
three scans are now linear. Well-formed configs parse exactly as before.
