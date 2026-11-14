/**
 * The 3D renderer is loaded on demand (`import('@chestnutlabs/gcode-renderer-three')`), so the first 3D bind in a
 * test file would evaluate three.js cold and outlast the suites' fixed-tick `settle()`. Load it once up front,
 * as an app that has shown a 3D view has. This changes no behaviour under test; only the first load's timing.
 */
await import('@chestnutlabs/gcode-renderer-three');
