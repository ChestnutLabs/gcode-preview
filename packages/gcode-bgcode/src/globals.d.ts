/**
 * Minimal ambient platform declarations (no DOM lib — same stance as
 * gcode-containers/globals.d.ts): only the streaming/text globals the decoder
 * (and its tests) touch, present in browsers, workers, and the pinned Node ≥ 22
 * runtime. `CompressionStream` is used only by the test fixture assembler.
 */
declare class TextDecoder {
  constructor(label?: string);
  decode(input?: ArrayBufferView | ArrayBuffer, options?: { stream?: boolean }): string;
}

declare class TextEncoder {
  encode(input?: string): Uint8Array;
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

declare class CompressionStream {
  constructor(format: 'gzip' | 'deflate' | 'deflate-raw');
  readonly readable: { getReader(): MinimalReader<Uint8Array> };
  readonly writable: { getWriter(): MinimalWriter<Uint8Array> };
}
