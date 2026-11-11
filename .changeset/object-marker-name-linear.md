---
'@chestnutlabs/gcode-dialects': patch
---

Slicer object markers (`; printing object <name> id:<n>`) are now parsed in linear time and read more
accurately. A hostile line that repeated `printing object` or padded a `name:` suffix with spaces could
stall the parse (one 64 KiB line took 0.7–7 s). Two correctness fixes ride along: (a) a name containing a
word that starts with "id" (`Ender idler pulley`, `Box Identity`) was truncated at that word; (b) an
`id<digits>` inside the name (`bracket(id2) id:7`) took the object id, which could merge distinct objects.
The object id is now the first whitespace-delimited `id:<n>` token.
