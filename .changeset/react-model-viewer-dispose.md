---
"@chestnutlabs/gcode-preview-react": patch
---

Fix `<ModelViewer>` / `useModelViewer` (React) leaking its controller on unmount. The hook now disposes the model-preview controller when the component unmounts — matching the toolpath hook and the Vue/Svelte/Web-Component adapters — so in-flight `setSource` operations settle and resources are released.
