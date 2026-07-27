/**
 * MeatPack G-code decoder (DD-011 phase 2, #188).
 *
 * A faithful TypeScript reimplementation of the MeatPack unpacker state machine from
 * **jamesgopsill/meatpack** (MIT, © 2025 James Gopsill — https://github.com/jamesgopsill/meatpack),
 * which is itself derived from the published Prusa spec (`libbgcode/binarize/meatpack.cpp`). Porting
 * from an MIT source with attribution is the sanctioned path (RR-003 §8) — the AGPL `libbgcode` and
 * OctoPrint-MeatPack are never copied.
 *
 * MeatPack packs the 15 most common G-code characters into 4-bit nibbles (two per byte); a nibble of
 * `0b1111` escapes a full literal byte, and a `0xFF 0xFF <cmd>` sequence toggles packing / no-spaces
 * state. The stream begins in the *disabled* state; the encoder emits `FF FF FB` (enable packing) up
 * front (the `MEATPACK_HEADER`). The first character of a packed byte is the LOW nibble.
 */
import { ContainerError } from '@chestnutlabs/gcode-containers';

const SIGNAL = 0xff;
// Command bytes (spec §meatpack; the two 0xFF signal bytes precede one of these).
const CMD_NO_SPACES_DISABLED = 246;
const CMD_NO_SPACES_ENABLED = 247;
const CMD_QUERY_CONFIG = 248;
const CMD_RESET_ALL = 249;
const CMD_PACKING_DISABLED = 250;
const CMD_PACKING_ENABLED = 251;

/**
 * 4-bit code → byte. Codes 0..14 are the packable characters; `0b1011` is space (or `'E'` when
 * no-spaces is active). Code `0b1111` (15) is the full-width escape marker — returned here as `0`,
 * which callers treat as "a full literal byte follows".
 */
function reverseLookup(nibble: number, noSpaces: boolean): number {
  if (nibble <= 9) return 0x30 + nibble; // '0'..'9'
  switch (nibble) {
    case 10:
      return 0x2e; // '.'
    case 11:
      return noSpaces ? 0x45 : 0x20; // 'E' or ' '
    case 12:
      return 0x0a; // '\n'
    case 13:
      return 0x47; // 'G'
    case 14:
      return 0x58; // 'X'
    default:
      return 0; // 0b1111 → NUL: full-width escape marker
  }
}

type State = 'disabled' | 'enabled' | 'first' | 'second' | 'rightFull' | 'leftFull';

/**
 * Decode a MeatPack byte stream to plain G-code, bounded to `limit` output bytes (decompression-bomb
 * defense). Both bgcode GCode encodings (MeatPack, MeatPack-comments) decode through this identically —
 * comment preservation is an *encoder* choice; the decoder simply reproduces the packed bytes.
 */
export function meatpackDecode(data: Uint8Array, limit: number): Uint8Array {
  let out = new Uint8Array(Math.max(64, Math.min(limit, data.length * 2)));
  let pos = 0;
  const push = (b: number): void => {
    if (pos >= limit) throw new ContainerError('E_BGCODE_BOMB', `MeatPack output exceeds the limit (${pos})`);
    if (pos >= out.length) {
      const bigger = new Uint8Array(Math.min(limit, Math.max(out.length * 2, pos + 1)));
      bigger.set(out.subarray(0, pos));
      out = bigger;
    }
    out[pos++] = b;
  };

  let state: State = 'disabled';
  let noSpaces = false;

  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    if (byte === SIGNAL) {
      if (state === 'first') state = 'second';
      else if (state === 'disabled' || state === 'enabled') state = 'first';
      else throw new ContainerError('E_BGCODE_MEATPACK', `invalid MeatPack state at byte ${i}`);
      continue;
    }
    switch (state) {
      case 'disabled':
        push(byte);
        break;
      case 'enabled': {
        const most = reverseLookup(byte >> 4, noSpaces); // high nibble → 2nd char
        const least = reverseLookup(byte & 0x0f, noSpaces); // low nibble → 1st char
        if (most === 10 && least === 10) {
          push(10); // a packed (\n, \n) collapses to a single newline
        } else if (most === 0 && least !== 0) {
          // 2nd char is full-width (follows in the stream); 1st char is real.
          push(least);
          state = 'rightFull';
        } else if (most !== 0 && least === 0) {
          // 1st char is full-width (follows); place a placeholder, then the real 2nd char.
          push(least);
          push(most);
          state = 'leftFull';
        } else if (most === 0 && least === 0) {
          // byte 0xFF — a signal, intercepted above; never reachable here.
          throw new ContainerError('E_BGCODE_MEATPACK', `unexpected 0xFF in packed data at byte ${i}`);
        } else {
          push(least); // 1st char (low nibble)
          push(most); // 2nd char (high nibble)
        }
        break;
      }
      case 'second': {
        switch (byte) {
          case CMD_PACKING_ENABLED:
            state = 'enabled';
            break;
          case CMD_PACKING_DISABLED:
            state = 'disabled';
            break;
          case CMD_RESET_ALL:
            state = 'disabled';
            noSpaces = false;
            break;
          case CMD_NO_SPACES_ENABLED:
            noSpaces = true;
            state = 'enabled';
            break;
          case CMD_NO_SPACES_DISABLED:
            noSpaces = false;
            state = 'enabled';
            break;
          case CMD_QUERY_CONFIG:
            // A serial-link query, not expected inside a file — no-op, resume packing.
            state = 'enabled';
            break;
          default:
            throw new ContainerError('E_BGCODE_MEATPACK', `invalid MeatPack command ${byte} at byte ${i}`);
        }
        break;
      }
      case 'first':
        // A lone 0xFF (not a command) → this byte and the next are two full-width literals.
        state = 'rightFull';
        push(byte);
        break;
      case 'rightFull':
        state = 'enabled';
        push(byte);
        break;
      case 'leftFull':
        state = 'enabled';
        out[pos - 2] = byte; // overwrite the placeholder with the full-width byte
        break;
    }
  }
  return out.subarray(0, pos);
}
