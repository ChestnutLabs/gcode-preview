---
'@chestnutlabs/gcode-preview-react': patch
---

`useModelViewer` / `<ModelViewer>`: a handle call after the component unmounted (for example `setSource` from a
late async callback) used to build a new controller that no canvas would ever bind, so the returned promise never
settled and the controller leaked. It now reaches the disposed controller: `setSource` rejects with
`E_MODEL_PREVIEW_DISPOSED`, as in the Vue, Svelte and Web Component adapters. A StrictMode remount and a handle
disposed by hand with `dispose()` still rebuild on the next call.
