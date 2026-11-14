; Z-lift pen plotter fixture (#189). Hand-written by Chestnut Labs, MIT.
; The pen rides on the Z axis: Z5 = pen up, Z0 = pen down. No spindle, no extruder.
; Draws a right triangle, then a short separate stroke.
G21
G90
G0 Z5 ; pen up
G0 X10 Y10 F3000
G1 Z0 F600 ; pen down
G1 X30 Y10 F1500
G1 X30 Y25
G1 X10 Y10
G1 Z5 F600 ; pen up
G0 X40 Y10
G1 Z0 F600 ; pen down
G1 X40 Y25 F1500
G1 Z5 F600 ; pen up
G0 X0 Y0
