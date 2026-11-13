// A 2D-only app on the core controller. The 3D loader stays reachable (lazy) from the same code.
import { createPreviewController } from '@chestnutlabs/gcode-preview-core';

globalThis.preview = createPreviewController({ renderer: { mode: '2d' } });
