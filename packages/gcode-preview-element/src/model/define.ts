/**
 * Side-effectful registration entry: `import '@chestnutlabs/gcode-preview-element/model/define'`
 * auto-registers `<gcode-model-viewer>`. Kept as a separate subpath so `.../model` stays
 * side-effect-free.
 */
import { defineGcodeModelViewer } from './index.js';

defineGcodeModelViewer();
