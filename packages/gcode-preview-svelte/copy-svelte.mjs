// Ship the RAW .svelte component (standard Svelte library packaging): consumers'
// bundlers compile it with their own svelte plugin via the "svelte" export condition.
import { copyFileSync } from 'node:fs';
copyFileSync(
  new URL('./src/GcodePreview.svelte', import.meta.url),
  new URL('./dist/GcodePreview.svelte', import.meta.url)
);
