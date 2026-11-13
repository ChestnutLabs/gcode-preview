---
'@chestnutlabs/gcode-renderer-three': patch
---

CNC, laser and pen-plotter files now frame and sit on the plate sensibly.

- **Plotter files frame the drawing.** A file with only travel moves, such as a pen plotter that lifts its pen with Z
  or a servo, used to open on the empty bed. The camera now frames the drawing instead. A file with unusable
  coordinates still frames the bed.
- **CNC and laser work shows through the plate.** For a file with no printing moves, the build plate and its edge are
  drawn at no more than 35% opaque and the contact shadow is left out, so cuts below the plate stay visible. A file
  with any printing move, including one printed entirely with arcs, or a printer that also cuts, looks exactly as
  before. Themes that draw no plate are unaffected.
- The "frameContent 'object' is unavailable" message now says it frames all cut and printed moves.
