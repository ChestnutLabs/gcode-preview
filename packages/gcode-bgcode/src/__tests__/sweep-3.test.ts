/**
 * Mutation sweep 3 over EXISTING bgcode code (G3 lane, 2026-11): the block-count cap, MeatPack stream
 * end states, and the adapter's untrusted bed / height / thumbnail values. Expected values are literals.
 */
import { describe, expect, it } from 'vitest';
import { ContainerError } from '@chestnutlabs/gcode-containers';
import { meatpackDecode, openBgcode, openBgcodeContainer, sniffBgcode } from '../index.js';
import { assembleBgcode } from './assemble.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);
const HUGE = '9'.repeat(400);

function thrown(fn: () => unknown): ContainerError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ContainerError);
    return e as ContainerError;
  }
  throw new Error('expected a ContainerError');
}

async function rejection(p: Promise<unknown>): Promise<ContainerError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ContainerError);
    return e as ContainerError;
  }
  throw new Error('expected a ContainerError, but the call resolved');
}

/**
 * A no-CRC file of `n` empty blocks of an unknown type (7): 8-byte header + 2-byte params, no data.
 * Built directly (headers only): 10 + 10·n bytes.
 */
function emptyBlocks(n: number): Uint8Array {
  const f = new Uint8Array(10 + 10 * n);
  f.set([0x47, 0x43, 0x44, 0x45, 1, 0, 0, 0, 0, 0]);
  for (let i = 0; i < n; i++) f[10 + 10 * i] = 7;
  return f;
}

describe('block-count cap (1,000,000 blocks)', () => {
  it('exactly 1,000,000 blocks are walked', async () => {
    const r = await openBgcode(emptyBlocks(1_000_000));
    expect(r.blocks.length).toBe(1000000);
  });

  it('1,000,001 blocks throw E_BGCODE_BOMB', async () => {
    const e = await rejection(openBgcode(emptyBlocks(1_000_001)));
    expect(e.code).toBe('E_BGCODE_BOMB');
    expect(e.message).toBe('file has more than 1000000 blocks');
  });

  it('the cap is checked before the extra block is read (a cut 1,000,001st header still says BOMB)', async () => {
    const f = emptyBlocks(1_000_001).subarray(0, 10 + 10 * 1_000_000 + 3);
    const e = await rejection(openBgcode(f));
    expect(e.code).toBe('E_BGCODE_BOMB');
  });
});

describe('MeatPack stream end states (defect: NUL placeholder / dropped char)', () => {
  const ON = [0xff, 0xff, 251]; // enable packing

  it('ending with the left full-width byte still due throws (was: a NUL in the G-code)', () => {
    const e = thrown(() => meatpackDecode(new Uint8Array([...ON, 0x1f]), 100));
    expect(e.code).toBe('E_BGCODE_MEATPACK');
    expect(e.message).toBe('MeatPack stream ends mid-token (state leftFull)');
  });

  it('ending with the right full-width byte still due throws (was: silently dropped)', () => {
    const e = thrown(() => meatpackDecode(new Uint8Array([...ON, 0xf1]), 100));
    expect(e.message).toBe('MeatPack stream ends mid-token (state rightFull)');
  });

  it('ending inside a signal throws: one 0xFF, or 0xFF 0xFF with no command', () => {
    expect(thrown(() => meatpackDecode(new Uint8Array([...ON, 0x21, 0xff]), 100)).message).toBe(
      'MeatPack stream ends mid-token (state first)'
    );
    expect(thrown(() => meatpackDecode(new Uint8Array([0x41, 0xff, 0xff]), 100)).message).toBe(
      'MeatPack stream ends mid-token (state second)'
    );
  });

  it('the same tokens completed decode normally, and both terminal states end cleanly', () => {
    expect(dec(meatpackDecode(new Uint8Array([...ON, 0x1f, 0x41]), 100))).toBe('A1');
    expect(dec(meatpackDecode(new Uint8Array([...ON, 0xf1, 0x41]), 100))).toBe('1A');
    expect(dec(meatpackDecode(new Uint8Array([...ON, 0x21]), 100))).toBe('12'); // ends 'enabled'
    expect(dec(meatpackDecode(new Uint8Array([0x47, 0x31]), 100))).toBe('G1'); // ends 'disabled'
  });

  it('the end-state error surfaces through openBgcode for a MeatPack G-code block', async () => {
    const f = await assembleBgcode([{ type: 1, compression: 0, encoding: 1, data: new Uint8Array([...ON, 0x1f]) }]);
    const e = await rejection(openBgcode(f));
    expect(e.code).toBe('E_BGCODE_MEATPACK');
  });
});

describe('adapter: untrusted bed_shape / height (defect: infinite bed, negative height)', () => {
  const open = async (ini: string) => {
    const f = await assembleBgcode([
      { type: 1, compression: 0, encoding: 0, data: enc('G1 X1\n') },
      { type: 3, compression: 0, encoding: 0, data: enc(ini) }
    ]);
    return (await openBgcodeContainer(f)).metadata;
  };
  const BED = 'bed_shape = 0x0,250x0,250x210,0x210\n';

  it('an overflowing X or Y gives no machine and a bgcode-bed-unparsed warning', async () => {
    for (const shape of [`0x0,${HUGE}x0,${HUGE}x210,0x210`, `0x0,250x0,250x${HUGE},0x${HUGE}`]) {
      const md = await open(`bed_shape = ${shape}\nmax_print_height = 210\n`);
      expect(md.machine).toBeUndefined();
      expect(md.warnings).toEqual([
        { code: 'bgcode-bed-unparsed', message: 'bed_shape setting present but unreadable; no bed reported' }
      ]);
    }
  });

  it('a malformed bed warns too; no bed_shape at all is silent', async () => {
    const bad = await open('bed_shape = 0x0,oops,1x1\n');
    expect(bad.machine).toBeUndefined();
    expect(bad.warnings.map((w) => w.code)).toEqual(['bgcode-bed-unparsed']);
    const none = await open('printer_model = MK4\n');
    expect(none.machine).toBeUndefined();
    expect(none.warnings).toEqual([]);
  });

  for (const h of ['-5', '0', HUGE, 'abc']) {
    it(`max_print_height = ${h.length > 8 ? 'an overflowing value' : h} → a bed with no height`, async () => {
      const md = await open(`${BED}max_print_height = ${h}\n`);
      expect(md.machine?.bed).toEqual({ kind: 'rect', min: { x: 0, y: 0 }, max: { x: 250, y: 210 } });
      expect(md.machine?.heightMm).toBeUndefined();
      expect(md.warnings).toEqual([]);
    });
  }

  it('a small positive height is kept (0.5), and printable_height is the fallback', async () => {
    expect((await open(`${BED}max_print_height = 0.5\n`)).machine?.heightMm).toBe(0.5);
    expect((await open(`${BED}printable_height = 180\n`)).machine?.heightMm).toBe(180);
  });
});

describe('Thumbnail blocks with a zero dimension are dropped', () => {
  const thumbs = async (width: number, height: number) => {
    const f = await assembleBgcode([
      { type: 1, compression: 0, encoding: 0, data: enc('G1 X1\n') },
      { type: 5, compression: 0, thumbnail: { format: 0, width, height }, data: new Uint8Array([1, 2, 3]) }
    ]);
    return (await openBgcode(f, { metadata: true })).thumbnails;
  };

  it('0 x 8 and 8 x 0 are dropped; 1 x 1 and 65535 x 65535 are kept', async () => {
    expect(await thumbs(0, 8)).toEqual([]);
    expect(await thumbs(8, 0)).toEqual([]);
    expect((await thumbs(1, 1)).map((t) => [t.format, t.width, t.height, Array.from(t.bytes)])).toEqual([
      ['png', 1, 1, [1, 2, 3]]
    ]);
    expect((await thumbs(65535, 65535)).map((t) => [t.width, t.height])).toEqual([[65535, 65535]]);
  });
});

describe('survivors of the first RED pass (existing code)', () => {
  const gcodeBlock = { type: 1, compression: 0, encoding: 0, data: enc('G1 X1\n') };

  it('sniff: the `.bgcode` name must END the file name', () => {
    const noMagic = new Uint8Array(4);
    expect(sniffBgcode(noMagic, 'part.bgcode')).toBe(true);
    expect(sniffBgcode(noMagic, 'PART.BGCODE')).toBe(true);
    expect(sniffBgcode(noMagic, 'part.bgcode.txt')).toBe(false);
    expect(sniffBgcode(noMagic, 'part.gcode')).toBe(false);
  });

  it('a 9-byte file is truncated, not an empty decode', async () => {
    const f = new Uint8Array([0x47, 0x43, 0x44, 0x45, 1, 0, 0, 0, 0]);
    const e = await rejection(openBgcode(f));
    expect(e.code).toBe('E_BGCODE_TRUNCATED');
    expect(e.message).toBe('file shorter than the 10-byte header');
  });

  it('INI: blank, comment and section keys are skipped; a plain key is read', async () => {
    const ini = 'no equals sign\n=lead\n   = blank\n; c = 1\n# h = 2\n[s = 3\nk = v\n';
    const f = await assembleBgcode([gcodeBlock, { type: 3, compression: 0, encoding: 0, data: enc(ini) }]);
    expect((await openBgcode(f, { metadata: true })).settings).toEqual({ k: 'v' });
  });

  it('thumbnail format ids: 0 png, 1 jpg, 2 qoi, 3 unknown', async () => {
    const blocks = [0, 1, 2, 3].map((format) => ({
      type: 5,
      compression: 0,
      thumbnail: { format, width: 2, height: 2 },
      data: new Uint8Array([format])
    }));
    const f = await assembleBgcode([gcodeBlock, ...blocks]);
    expect((await openBgcode(f, { metadata: true })).thumbnails.map((t) => t.format)).toEqual([
      'png',
      'jpg',
      'qoi',
      'unknown'
    ]);
  });

  it('a stored (None) thumbnail is a copy, not a view of the input buffer', async () => {
    const f = await assembleBgcode([
      gcodeBlock,
      { type: 5, compression: 0, thumbnail: { format: 0, width: 1, height: 1 }, data: new Uint8Array([7, 8, 9]) }
    ]);
    const [t] = (await openBgcode(f, { metadata: true })).thumbnails;
    expect(t.bytes.buffer).not.toBe(f.buffer);
    f.fill(0);
    expect(Array.from(t.bytes)).toEqual([7, 8, 9]);
  });

  describe('MeatPack commands', () => {
    const FF = 0xff;
    it('reset-all (249) clears no-spaces: a later space nibble is a space again', () => {
      // no-spaces on (247) → reset (249, disabled) → enable (251) → 0xBB = two code-11 nibbles
      const out = meatpackDecode(new Uint8Array([FF, FF, 247, FF, FF, 249, FF, FF, 251, 0xbb]), 100);
      expect(dec(out)).toBe('  ');
    });
    it('no-spaces-disabled (246) clears no-spaces', () => {
      expect(dec(meatpackDecode(new Uint8Array([FF, FF, 247, FF, FF, 246, 0xb1]), 100))).toBe('1 ');
    });
    it('no-spaces-enabled (247) reads code 11 as E', () => {
      expect(dec(meatpackDecode(new Uint8Array([FF, FF, 247, 0xb1]), 100))).toBe('1E');
    });
    it('query-config (248) resumes packing', () => {
      expect(dec(meatpackDecode(new Uint8Array([FF, FF, 248, 0x21]), 100))).toBe('12');
    });
  });

  describe('adapter settings', () => {
    const open = async (ini: string) => {
      const f = await assembleBgcode([gcodeBlock, { type: 3, compression: 0, encoding: 0, data: enc(ini) }]);
      return (await openBgcodeContainer(f)).metadata;
    };
    it('max_print_height wins over printable_height', async () => {
      const md = await open('bed_shape = 0x0,250x0,250x210,0x210\nprintable_height = 180\nmax_print_height = 210\n');
      expect(md.machine?.heightMm).toBe(210);
    });
    it('three bed corners are a polygon, not a rect', async () => {
      expect((await open('bed_shape = 0x0,10x0,10x10\n')).machine?.bed.kind).toBe('polygon');
    });
    it('Producer is copied into raw; an unlisted key is not', async () => {
      const md = await open('Producer = PrusaSlicer 2.9.0\nunlisted = x\n');
      expect(md.raw).toEqual({ Producer: 'PrusaSlicer 2.9.0' });
    });
  });
});
