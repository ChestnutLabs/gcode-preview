/**
 * Budget-aware growable SoA segment writer (DD-003 §7.2/§7.3).
 *
 * Accumulates segments directly into growable typed arrays (no intermediate object
 * graphs) and keeps a byte-accurate account of every live working allocation. Any
 * projected allocation — growth steps and the final right-size compaction, during
 * which old and new capacity coexist — is checked against `maxBufferBytes` BEFORE
 * it is performed. On budget exhaustion the writer reports failure and the parse
 * stops at the current command boundary with a structured bounded result; it never
 * throws an unhandled allocation error.
 */

export class BudgetExceededError extends Error {
  constructor(
    public readonly requestedBytes: number,
    public readonly accountedBytes: number,
    public readonly maxBufferBytes: number
  ) {
    super(
      `allocation of ${requestedBytes} B would exceed maxBufferBytes=${maxBufferBytes} B (accounted: ${accountedBytes} B)`
    );
    this.name = 'BudgetExceededError';
  }
}

type ChannelSpec = { name: string; bytesPerElement: 1 | 2 | 4 };

const CHANNELS: ChannelSpec[] = [
  { name: 'x0', bytesPerElement: 4 },
  { name: 'y0', bytesPerElement: 4 },
  { name: 'z0', bytesPerElement: 4 },
  { name: 'x1', bytesPerElement: 4 },
  { name: 'y1', bytesPerElement: 4 },
  { name: 'z1', bytesPerElement: 4 },
  { name: 'e', bytesPerElement: 4 },
  { name: 'feedrate', bytesPerElement: 4 },
  { name: 'kind', bytesPerElement: 1 },
  { name: 'tool', bytesPerElement: 2 },
  { name: 'layer', bytesPerElement: 4 },
  { name: 'feature', bytesPerElement: 1 },
  { name: 'object', bytesPerElement: 4 },
  { name: 'srcByte', bytesPerElement: 4 }
];

const BYTES_PER_SEGMENT = CHANNELS.reduce((a, c) => a + c.bytesPerElement, 0); // 40 B core set

export interface SegmentRecord {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  e: number;
  feedrate: number;
  kind: number;
  tool: number;
  layer: number;
  srcByte: number;
}

export interface FinalChannels {
  count: number;
  x0: Float32Array;
  y0: Float32Array;
  z0: Float32Array;
  x1: Float32Array;
  y1: Float32Array;
  z1: Float32Array;
  e: Float32Array;
  feedrate: Float32Array;
  kind: Uint8Array;
  tool: Uint16Array;
  layer: Uint32Array;
  feature: Uint8Array;
  object: Uint32Array;
  srcByte: Uint32Array;
}

const INITIAL_CAPACITY = 4096;

export class SegmentWriter {
  private capacity = 0;
  private _count = 0;

  private x0!: Float32Array;
  private y0!: Float32Array;
  private z0!: Float32Array;
  private x1!: Float32Array;
  private y1!: Float32Array;
  private z1!: Float32Array;
  private e!: Float32Array;
  private feedrate!: Float32Array;
  private kind!: Uint8Array;
  private tool!: Uint16Array;
  private layer!: Uint32Array;
  private feature!: Uint8Array;
  private object!: Uint32Array;
  private srcByte!: Uint32Array;

  /** Bytes of live typed-array capacity currently held by this writer. */
  private accountedBytes = 0;
  /** Extra live bytes the caller wants included in the budget (line buffer, warnings). */
  private externalBytes = 0;

  constructor(private readonly maxBufferBytes: number) {
    this.allocate(INITIAL_CAPACITY);
  }

  get count(): number {
    return this._count;
  }

  get accounted(): number {
    return this.accountedBytes + this.externalBytes;
  }

  /** Report additional live working bytes (e.g., the line-drain buffer) into the budget. */
  setExternalBytes(bytes: number): void {
    this.externalBytes = bytes;
  }

  /** Throws BudgetExceededError if `requested` more bytes would break the budget. */
  private ensureBudget(requested: number): void {
    if (this.accounted + requested > this.maxBufferBytes) {
      throw new BudgetExceededError(requested, this.accounted, this.maxBufferBytes);
    }
  }

  private allocate(newCapacity: number): void {
    // During a grow/compact, old and new capacity coexist until copies complete.
    const newBytes = newCapacity * BYTES_PER_SEGMENT;
    this.ensureBudget(newBytes);

    const nx0 = new Float32Array(newCapacity);
    const ny0 = new Float32Array(newCapacity);
    const nz0 = new Float32Array(newCapacity);
    const nx1 = new Float32Array(newCapacity);
    const ny1 = new Float32Array(newCapacity);
    const nz1 = new Float32Array(newCapacity);
    const ne = new Float32Array(newCapacity);
    const nfeed = new Float32Array(newCapacity);
    const nkind = new Uint8Array(newCapacity);
    const ntool = new Uint16Array(newCapacity);
    const nlayer = new Uint32Array(newCapacity);
    const nfeature = new Uint8Array(newCapacity);
    const nobject = new Uint32Array(newCapacity);
    const nsrc = new Uint32Array(newCapacity);

    if (this.capacity > 0) {
      nx0.set(this.x0.subarray(0, this._count));
      ny0.set(this.y0.subarray(0, this._count));
      nz0.set(this.z0.subarray(0, this._count));
      nx1.set(this.x1.subarray(0, this._count));
      ny1.set(this.y1.subarray(0, this._count));
      nz1.set(this.z1.subarray(0, this._count));
      ne.set(this.e.subarray(0, this._count));
      nfeed.set(this.feedrate.subarray(0, this._count));
      nkind.set(this.kind.subarray(0, this._count));
      ntool.set(this.tool.subarray(0, this._count));
      nlayer.set(this.layer.subarray(0, this._count));
      nfeature.set(this.feature.subarray(0, this._count));
      nobject.set(this.object.subarray(0, this._count));
      nsrc.set(this.srcByte.subarray(0, this._count));
    }

    const oldBytes = this.capacity * BYTES_PER_SEGMENT;
    this.x0 = nx0;
    this.y0 = ny0;
    this.z0 = nz0;
    this.x1 = nx1;
    this.y1 = ny1;
    this.z1 = nz1;
    this.e = ne;
    this.feedrate = nfeed;
    this.kind = nkind;
    this.tool = ntool;
    this.layer = nlayer;
    this.feature = nfeature;
    this.object = nobject;
    this.srcByte = nsrc;
    this.capacity = newCapacity;
    this.accountedBytes = this.accountedBytes - oldBytes + newBytes;
  }

  /** Append one segment. Throws BudgetExceededError when growth would break the budget. */
  push(s: SegmentRecord): void {
    if (this._count === this.capacity) {
      this.allocate(this.capacity * 2);
    }
    const i = this._count;
    this.x0[i] = s.x0;
    this.y0[i] = s.y0;
    this.z0[i] = s.z0;
    this.x1[i] = s.x1;
    this.y1[i] = s.y1;
    this.z1[i] = s.z1;
    this.e[i] = s.e;
    this.feedrate[i] = s.feedrate;
    this.kind[i] = s.kind;
    this.tool[i] = s.tool;
    this.layer[i] = s.layer;
    this.feature[i] = 0;
    this.object[i] = 0;
    this.srcByte[i] = s.srcByte;
    this._count++;
  }

  /** Overwrite the layer channel for a segment range (used for post-hoc layer resolution). */
  setLayerRange(start: number, end: number, layerIndex: number): void {
    this.layer.fill(layerIndex, start, end + 1);
  }

  /** Zero the whole layer channel (non-planar clearing semantics). */
  clearLayers(): void {
    this.layer.fill(0, 0, this._count);
  }

  /** Right-size to exact count. Budget-checked (old + new coexist during the copy). */
  finalize(): FinalChannels {
    if (this._count < this.capacity) {
      this.allocate(Math.max(this._count, 1));
    }
    return {
      count: this._count,
      x0: this.x0.subarray(0, this._count),
      y0: this.y0.subarray(0, this._count),
      z0: this.z0.subarray(0, this._count),
      x1: this.x1.subarray(0, this._count),
      y1: this.y1.subarray(0, this._count),
      z1: this.z1.subarray(0, this._count),
      e: this.e.subarray(0, this._count),
      feedrate: this.feedrate.subarray(0, this._count),
      kind: this.kind.subarray(0, this._count),
      tool: this.tool.subarray(0, this._count),
      layer: this.layer.subarray(0, this._count),
      feature: this.feature.subarray(0, this._count),
      object: this.object.subarray(0, this._count),
      srcByte: this.srcByte.subarray(0, this._count)
    };
  }
}
