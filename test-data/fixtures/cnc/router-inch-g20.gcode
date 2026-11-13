; Inch-units CNC router fixture (#189). Hand-written by Chestnut Labs, MIT.
; G20: every coordinate below is in inches. Profiles a 2.5 x 2 in rounded rectangle
; 0.05 in deep, with two rounded corners cut as G3 quarter-arcs.
G20 G90 G17
G0 Z0.25
G0 X0.5 Y0.5
M3 S12000
G1 Z-0.05 F10
G1 X2.5 Y0.5 F30
G3 X3.0 Y1.0 I0 J0.5
G1 X3.0 Y2.0
G3 X2.5 Y2.5 I-0.5 J0
G1 X0.5 Y2.5
G1 X0.5 Y0.5
G0 Z0.25
M5
G0 X0 Y0
M30
