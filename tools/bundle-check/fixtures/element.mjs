// The Web Component's main entry, as a 2D-only app imports it.
import { GcodePreviewElement, defineGcodePreview } from '@chestnutlabs/gcode-preview-element';

globalThis.adapter = [GcodePreviewElement, defineGcodePreview];
