// The Svelte adapter's main entry, as a 2D-only app imports it.
import { createGcodePreview } from '@chestnutlabs/gcode-preview-svelte';

globalThis.adapter = createGcodePreview;
