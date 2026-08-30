// Ship the RAW .svelte component (standard Svelte library packaging): consumers'
// bundlers compile it with their own svelte plugin via the "svelte" export condition.
import { copyFileSync, mkdirSync } from 'node:fs';
copyFileSync(
  new URL('./src/GcodePreview.svelte', import.meta.url),
  new URL('./dist/GcodePreview.svelte', import.meta.url)
);
// DD-031: the model-viewer component (Prepare side).
mkdirSync(new URL('./dist/model/', import.meta.url), { recursive: true });
copyFileSync(
  new URL('./src/model/ModelViewer.svelte', import.meta.url),
  new URL('./dist/model/ModelViewer.svelte', import.meta.url)
);
