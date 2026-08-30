/*
 * demo-kit/capabilities — capability-aware control metadata (DD-031 §4.5/§4.6). Turns the honest
 * capability model into UX: default palettes so a color-mode NAME resolves to a full `ColorMode`
 * object, per-mode legend data, and plain-language reasons a mode is unavailable for the current file.
 * Shared by the Feature Lab and the framework showcase examples so they present modes identically.
 *
 * Colors are the engine's RGB convention: [r, g, b] floats in 0..1 (see @chestnutlabs/gcode-colors).
 */

/** 0..1 RGB → "rgb(r,g,b)" for CSS swatches. */
export function rgbCss(rgb) {
  return `rgb(${rgb.map((c) => Math.round(c * 255)).join(',')})`;
}

const NEUTRAL = [0.72, 0.74, 0.78];

/** Palette indexed by FeatureRole value (toolpath-core FeatureRole enum order). */
export const FEATURE_PALETTE = [
  [0.55, 0.58, 0.62], // 0 Unknown
  [0.36, 0.62, 0.96], // 1 ExternalPerimeter
  [0.4, 0.76, 0.98], // 2 Perimeter
  [0.98, 0.72, 0.28], // 3 InternalInfill
  [0.96, 0.5, 0.32], // 4 SolidInfill
  [0.62, 0.82, 0.4], // 5 TopSolidInfill
  [0.78, 0.5, 0.86], // 6 Skirt
  [0.9, 0.44, 0.72], // 7 Brim
  [0.5, 0.86, 0.78], // 8 Support
  [0.44, 0.78, 0.66], // 9 SupportInterface
  [0.7, 0.66, 0.5], // 10 Bridge
  [0.86, 0.72, 0.4], // 11 PrimeTower
  [0.82, 0.6, 0.9], // 12 WipeTower
  [0.6, 0.55, 0.72], // 13 Raft
  [0.9, 0.55, 0.55] // 14 Purge
];

export const TOOL_PALETTE = [
  [0.36, 0.62, 0.96],
  [0.96, 0.5, 0.32],
  [0.62, 0.82, 0.4],
  [0.9, 0.44, 0.72],
  [0.98, 0.78, 0.3],
  [0.5, 0.86, 0.78],
  [0.78, 0.5, 0.86],
  [0.6, 0.66, 0.72]
];

const RAMP = [
  [0.15, 0.3, 0.75],
  [0.2, 0.65, 0.85],
  [0.35, 0.82, 0.55],
  [0.95, 0.82, 0.25],
  [0.95, 0.45, 0.2]
];

/**
 * Every color mode the engine supports (DD-031 §4.1), with the capability channel it needs, a
 * builder that produces the full `ColorMode` object from a default palette, and legend data.
 * `always: true` modes need no capability (single / tool / moveKind / filament).
 */
export const COLOR_MODES = [
  { id: 'single', label: 'Single color', always: true, build: () => ({ mode: 'single', color: [0.4, 0.72, 0.98] }) },
  {
    id: 'tool',
    label: 'By tool / extruder',
    always: true,
    build: () => ({ mode: 'tool', palette: TOOL_PALETTE, fallback: NEUTRAL })
  },
  {
    id: 'feature',
    label: 'By feature role',
    capability: 'featureRoles',
    build: () => ({ mode: 'feature', palette: FEATURE_PALETTE, fallback: NEUTRAL }),
    legend: [
      ['Outer wall', FEATURE_PALETTE[1]],
      ['Inner wall', FEATURE_PALETTE[2]],
      ['Infill', FEATURE_PALETTE[3]],
      ['Solid/top', FEATURE_PALETTE[5]],
      ['Support', FEATURE_PALETTE[8]],
      ['Skirt/Brim', FEATURE_PALETTE[6]],
      ['Tower/Purge', FEATURE_PALETTE[12]]
    ]
  },
  {
    id: 'colorChange',
    label: 'By color change (M600)',
    capability: 'colorChanges',
    build: () => ({ mode: 'colorChange', palette: TOOL_PALETTE, fallback: NEUTRAL })
  },
  {
    id: 'filament',
    label: "By filament (file's own colors)",
    always: true,
    build: () => ({ mode: 'filament', fallback: NEUTRAL })
  },
  {
    id: 'feedrate',
    label: 'By speed (feedrate)',
    capability: 'feedrate',
    build: () => ({ mode: 'feedrate', ramp: RAMP, fallback: NEUTRAL }),
    ramp: RAMP,
    rampLabel: ['slow', 'fast']
  },
  {
    id: 'object',
    label: 'By object',
    capability: 'objects',
    build: () => ({ mode: 'object', palette: TOOL_PALETTE, fallback: NEUTRAL })
  },
  {
    id: 'layerHeight',
    label: 'By layer height',
    capability: 'layers',
    build: () => ({ mode: 'layerHeight', ramp: RAMP, fallback: NEUTRAL }),
    ramp: RAMP,
    rampLabel: ['thin', 'thick']
  },
  {
    id: 'power',
    label: 'By tool power (CNC/laser)',
    capability: 'toolPower',
    cam: true,
    build: () => ({ mode: 'power', ramp: RAMP, fallback: NEUTRAL }),
    ramp: RAMP,
    rampLabel: ['low', 'high']
  },
  {
    id: 'moveKind',
    label: 'Cut vs rapid (CNC/laser)',
    always: true,
    cam: true,
    build: () => ({ mode: 'moveKind', cut: [0.4, 0.72, 0.98], travel: [0.55, 0.58, 0.62], fallback: NEUTRAL }),
    legend: [
      ['Cutting / working move', [0.4, 0.72, 0.98]],
      ['Rapid / travel', [0.55, 0.58, 0.62]]
    ]
  }
];

export const COLOR_MODE_BY_ID = Object.fromEntries(COLOR_MODES.map((m) => [m.id, m]));

/** Human-readable reason a color mode is unavailable for the current capabilities, for contextual UI. */
export function colorModeReason(id, capabilities) {
  const mode = COLOR_MODE_BY_ID[id];
  if (mode === undefined || mode.always) return '';
  const conf = capabilities?.[mode.capability];
  const REASONS = {
    featureRoles: "this file doesn't identify feature roles (walls, infill, support)",
    colorChanges: 'this file has no M600 color changes',
    feedrate: 'feedrate data is unavailable for this file',
    objects: "this file doesn't tag per-object membership (M486 / EXCLUDE_OBJECT)",
    layers: 'this file has no planar layer structure',
    toolPower: 'this file was parsed without the tool-power (S) channel'
  };
  return conf === undefined || conf === 'unavailable'
    ? (REASONS[mode.capability] ?? 'not available for this file')
    : '';
}

/** Confidence phrasing for a capability key (known/inferred/approximated/unavailable). */
export function confidenceTier(conf) {
  if (conf === 'known') return { cls: 'gp-known', label: 'known' };
  if (conf === 'inferred') return { cls: 'gp-inferred', label: 'inferred' };
  if (conf === 'approximated') return { cls: 'gp-approx', label: 'approximated' };
  return { cls: 'gp-unavailable', label: 'unavailable' };
}
