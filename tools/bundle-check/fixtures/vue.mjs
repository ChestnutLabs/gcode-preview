// The Vue adapter's main entry, as a 2D-only app imports it.
import { GcodePreview, useGcodePreview } from '@chestnutlabs/gcode-preview-vue';

globalThis.adapter = [GcodePreview, useGcodePreview];
