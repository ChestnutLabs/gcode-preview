/**
 * Minimal ambient platform declarations (no DOM lib — same stance as
 * gcode-parser/globals.d.ts): only what the container reader touches, present
 * in browsers, workers, and the pinned Node ≥ 22 runtime.
 */
declare class TextDecoder {
  constructor(label?: string);
  decode(input?: ArrayBufferView | ArrayBuffer, options?: { stream?: boolean }): string;
}

interface MinimalReader<T> {
  read(): Promise<{ done: boolean; value?: T }>;
  releaseLock?(): void;
}

interface MinimalWriter<T> {
  write(chunk: T): Promise<void>;
  close(): Promise<void>;
}

declare class DecompressionStream {
  constructor(format: 'gzip' | 'deflate' | 'deflate-raw');
  readonly readable: { getReader(): MinimalReader<Uint8Array> };
  readonly writable: { getWriter(): MinimalWriter<Uint8Array> };
}
