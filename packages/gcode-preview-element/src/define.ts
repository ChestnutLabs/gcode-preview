/**
 * Side-effectful registration entry: `import '@chestnutlabs/gcode-preview-element/define'`
 * auto-registers `<gcode-preview>`. Kept as a separate subpath so the main `.` entry stays
 * `sideEffects: false`.
 */
import { defineGcodePreview } from './index.js';

defineGcodePreview();
