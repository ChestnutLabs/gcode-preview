/*
 * demo-kit/fixtures — the sample corpus organized by PURPOSE, not filename (DD-031 §17). A user picks
 * "Parametric CNC program" or "Variable layer height", not an obscure path. Paths resolve against the
 * demo's served public dir (test-data, via Vite publicDir). Shared by the Feature Lab and examples so
 * they offer the same scenarios. `blurb` says what each file is meant to demonstrate.
 */

export const FIXTURE_GROUPS = [
  {
    group: 'FDM prints',
    items: [
      {
        id: 'benchy',
        label: '3DBenchy',
        path: 'gcodes/3DBenchy.gcode',
        blurb: 'The classic torture-test boat — a dense, feature-rich FDM print (3.7 MB).'
      },
      {
        id: 'calicat',
        label: 'Calicat',
        path: 'gcodes/calicat.gcode',
        blurb: 'A small calibration cat — quick to load, good for trying color modes.'
      },
      {
        id: 'vase',
        label: 'Vase (spiral / vase mode)',
        path: 'gcodes/vase.gcode',
        blurb: 'Continuous single-wall spiralized print — one long extrusion.'
      },
      {
        id: 'plant-sign',
        label: 'Plant sign',
        path: 'gcodes/plant-sign.gcode',
        blurb: 'Multi-object plate — several parts printed together.'
      }
    ]
  },
  {
    group: 'Feature & appearance',
    items: [
      {
        id: 'skirt-brim',
        label: 'Model + skirt + brim',
        path: 'fixtures/annotations/skirt-brim-model.gcode',
        blurb: 'Adhesion features around a part — try object framing and hiding brim/skirt.'
      },
      {
        id: 'variable-layers',
        label: 'Variable layer height',
        path: 'fixtures/annotations/variable-layers.gcode',
        blurb: 'Adaptive layer heights — reveal them with the "By layer height" color mode.'
      },
      {
        id: 'wipe-brackets',
        label: 'Wipe moves',
        path: 'fixtures/annotations/wipe-brackets.gcode',
        blurb: 'Slicer wipe moves as their own kind — toggle them in Inspect.'
      }
    ]
  },
  {
    group: 'Containers',
    items: [
      {
        id: 'container-3mf',
        label: 'mini-project.gcode.3mf',
        path: 'fixtures/containers/mini-project.gcode.3mf',
        blurb: 'A .gcode.3mf container — parsed straight from the archive.'
      }
    ]
  },
  {
    group: 'CNC / laser',
    items: [
      {
        id: 'mach3',
        label: 'Mach3 CNC program',
        path: 'gcodes/mach3.gcode',
        blurb: 'CNC-style toolpath — try the cut-vs-rapid color mode.'
      },
      {
        id: 'easel',
        label: 'Easel CNC (small)',
        path: 'gcodes/easel.gcode',
        blurb: 'A compact CNC job (19 KB) — fast to inspect.'
      },
      { id: 'screw', label: 'Screw', path: 'gcodes/screw.gcode', blurb: 'A threaded part toolpath.' },
      {
        id: 'bolt-circle',
        label: 'Parametric program (RS274NGC)',
        path: 'fixtures/parametric/bolt-circle.ngc',
        blurb: 'A parametric bolt-circle with variables, expressions and O-word loops — expanded by the parser.'
      }
    ]
  }
];

/** Flat lookup by id. */
export const FIXTURE_BY_ID = Object.fromEntries(FIXTURE_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i])));

/** Sibling model/still demos, linked from the Feature Lab (source-model presentation is a distinct product). */
export const RELATED_DEMOS = [
  { href: 'model-viewer.html', label: 'Model viewer (STL / 3MF)' },
  { href: '2d.html', label: '2D layer view' },
  { href: 'validate.html', label: 'Validate' },
  { href: 'still.html', label: 'Headless still' }
];
