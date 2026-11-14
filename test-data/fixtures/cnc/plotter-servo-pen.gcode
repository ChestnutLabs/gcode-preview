; Servo-pen plotter fixture (#189). Hand-written by Chestnut Labs, MIT.
; The pen is lifted and lowered by a hobby servo on P0: S90 = pen up, S30 = pen down.
; These angles are machine-specific; other plotters swap them or use other values.
; Draws a 30 x 20 mm rectangle, then a 20 mm circle as two half-arcs.
G21
G90
M280 P0 S90 ; pen up
G0 X10 Y10 F3000
M280 P0 S30 ; pen down
G1 X40 Y10 F1500
G1 X40 Y30
G1 X10 Y30
G1 X10 Y10
M280 P0 S90 ; pen up
G0 X50 Y20
M280 P0 S30 ; pen down
G2 X70 Y20 I10 J0
G2 X50 Y20 I-10 J0
M280 P0 S90 ; pen up
G0 X0 Y0
