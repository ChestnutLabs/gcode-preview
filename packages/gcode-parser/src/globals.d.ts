/**
 * Minimal ambient typings for runtime-universal globals (present in browsers,
 * workers, Node and Electron) that are not part of lib ES2022. We deliberately
 * do NOT include the DOM lib in this package (DD-002 boundary), so the one
 * universal API the parser needs is declared narrowly here.
 */
declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: ArrayBufferView | ArrayBuffer, options?: { stream?: boolean }): string;
}
