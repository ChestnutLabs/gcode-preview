// The React adapter's main entry, as a 2D-only app imports it.
import { GcodePreview, useGcodePreview } from '@chestnutlabs/gcode-preview-react';

globalThis.adapter = [GcodePreview, useGcodePreview];
