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

declare class MessagePortLike {
  onmessage: ((ev: { data: unknown }) => void) | null;
  postMessage(value: unknown, transfer?: ArrayBuffer[]): void;
  close(): void;
  start?(): void;
}

/** MessageChannel is global in browsers, workers, and Node ≥15. */
declare class MessageChannel {
  readonly port1: MessagePortLike;
  readonly port2: MessagePortLike;
}

/** Minimal URL typing (global in browsers, workers, and Node). */
declare class URL {
  constructor(url: string, base?: string | URL);
  readonly href: string;
  toString(): string;
}

interface ImportMeta {
  url: string;
}

/** Minimal browser Worker typing for the default instantiation path (§4.4a). */
declare class Worker {
  constructor(scriptURL: string | URL, options?: { type?: 'classic' | 'module'; name?: string });
  postMessage(message: unknown, transfer?: ArrayBuffer[]): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((err: unknown) => void) | null;
}

declare function setTimeout(handler: () => void, timeout?: number): number;
declare function clearTimeout(id: number | undefined): void;
