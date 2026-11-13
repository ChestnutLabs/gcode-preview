// A 3D app on the core controller: three.js must be in a lazy chunk, never at startup.
import { createPreviewController } from '@chestnutlabs/gcode-preview-core';

globalThis.preview = createPreviewController({ renderer: { mode: '3d' } });
