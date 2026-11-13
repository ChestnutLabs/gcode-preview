---
'@chestnutlabs/gcode-renderer-three': patch
---

Framing and plate look for files with no extrusion (CNC, laser, pen plotter).

- **Travel-only files frame their drawing.** A pen plotter has no Extrude and no Cut move, so its productive bounds are
  empty and the camera framed the bed. It now frames `boundsWithTravel`. Bounds that hold Infinity or NaN still fall back
  to the bed.
- **CNC work below Z 0 shows through the plate.** When a file has content but no Extrude move, the plate and its edge are
  drawn at no more than 35% opacity and the contact shadow is left out. A file with any Extrude (FDM, or a printer that
  also cuts) is unchanged, pixel for pixel. Themes that draw no plate are unaffected.
- The `E_FRAME_CONTENT_UNAVAILABLE` message now says it frames "all productive moves (extrusion or cut)".
