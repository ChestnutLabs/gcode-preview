import { afterEach, describe, expect, it, vi } from 'vitest';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { ModelParseError } from '../limits.js';
import { parseStl, repairFacetNormals } from '../stl.js';

/** Binary STL: 80-byte header, uint32 count, then 50 bytes per facet (normal, 3 vertices, attr). */
function binaryStl(tris: number[][], opts: { declared?: number; trailing?: number } = {}): Uint8Array {
  const buf = new Uint8Array(84 + tris.length * 50 + (opts.trailing ?? 0));
  const dv = new DataView(buf.buffer);
  dv.setUint32(80, opts.declared ?? tris.length, true);
  let o = 84;
  for (const t of tris) {
    o += 12; // facet normal left as 0 0 0
    for (let i = 0; i < 9; i++) dv.setFloat32(o + i * 4, t[i], true);
    o += 38;
  }
  return buf;
}

function asciiStl(tris: number[][]): Uint8Array {
  const facets = tris
    .map(
      (t) =>
        `facet normal 0 0 1\nouter loop\nvertex ${t[0]} ${t[1]} ${t[2]}\nvertex ${t[3]} ${t[4]} ${t[5]}\nvertex ${t[6]} ${t[7]} ${t[8]}\nendloop\nendfacet\n`
    )
    .join('');
  return new TextEncoder().encode(`solid t\n${facets}endsolid t\n`);
}

const TRI = [0, 0, 0, 10, 0, 0, 0, 20, 0];
const tris = (n: number): number[][] => Array.from({ length: n }, () => TRI);

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof ModelParseError ? e.code : `not-a-ModelParseError:${String(e)}`;
  }
  return 'no-throw';
}

afterEach(() => vi.restoreAllMocks());

describe('parseStl: input shapes', () => {
  it('a Uint8Array that is a window over a larger buffer parses only its own bytes', () => {
    const stl = binaryStl([[1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    const backing = new Uint8Array(7 + stl.length + 11).fill(0xee);
    backing.set(stl, 7);
    const scene = parseStl(backing.subarray(7, 7 + stl.length));
    expect(Array.from(scene.objects[0].geometry.positions)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(scene.bounds).toEqual({ min: [1, 2, 3], max: [7, 8, 9] });
  });

  it('a bare ArrayBuffer parses like its bytes', () => {
    const scene = parseStl(binaryStl([TRI]).buffer as ArrayBuffer);
    expect(scene.bounds).toEqual({ min: [0, 0, 0], max: [10, 20, 0] });
  });

  it('a 83-byte source fails as a ModelParseError, never a raw RangeError from the header read', () => {
    expect(codeOf(() => parseStl(new Uint8Array(83)))).toBe('E_MODEL_PARSE');
    // the failure comes from the loader (no header to bound), not from the header guard
    expect(() => parseStl(new Uint8Array(83))).toThrow(/^STL parse failed: /);
  });

  it('the capacity in the "holds" message rounds down to whole facets (160 bytes hold 1, not 1.52)', () => {
    const src = binaryStl(tris(1), { declared: 5, trailing: 26 });
    expect(src.byteLength).toBe(160);
    expect(() => parseStl(src)).toThrow('STL declares 5 triangles but holds 1');
  });

  it('a binary header declaring zero facets is E_MODEL_EMPTY', () => {
    expect(codeOf(() => parseStl(binaryStl([])))).toBe('E_MODEL_EMPTY');
  });

  it('an ASCII solid with no facets is E_MODEL_EMPTY', () => {
    const src = new TextEncoder().encode(`solid t\n${' '.repeat(100)}\nendsolid t\n`);
    expect(codeOf(() => parseStl(src))).toBe('E_MODEL_EMPTY');
  });

  it('a binary file with trailing bytes still parses (the header count is what is read)', () => {
    const scene = parseStl(binaryStl(tris(2), { trailing: 1 }));
    expect(scene.objects[0].geometry.positions).toHaveLength(18);
    const fewer = parseStl(binaryStl(tris(2), { declared: 1, trailing: 0 }));
    expect(fewer.objects[0].geometry.positions).toHaveLength(9);
  });
});

describe('parseStl: limit boundaries (cap-1 / cap / cap+1)', () => {
  it('maxSourceBytes: the cap itself is accepted, one byte over is E_MODEL_TOO_LARGE', () => {
    const src = binaryStl(tris(1)); // 134 bytes
    expect(src.byteLength).toBe(134);
    expect(codeOf(() => parseStl(src, { maxSourceBytes: 133 }))).toBe('E_MODEL_TOO_LARGE');
    expect(codeOf(() => parseStl(src, { maxSourceBytes: 134 }))).toBe('no-throw');
    expect(codeOf(() => parseStl(src, { maxSourceBytes: 135 }))).toBe('no-throw');
  });

  it('maxTriangles, binary: 3 facets pass at 3 and 4, fail at 2 — and the over-cap case never reaches the loader', () => {
    const spy = vi.spyOn(STLLoader.prototype, 'parse');
    const src = binaryStl(tris(3));
    expect(codeOf(() => parseStl(src, { maxTriangles: 2 }))).toBe('E_MODEL_TOO_MANY_TRIANGLES');
    expect(spy).not.toHaveBeenCalled();
    expect(codeOf(() => parseStl(src, { maxTriangles: 3 }))).toBe('no-throw');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(codeOf(() => parseStl(src, { maxTriangles: 4 }))).toBe('no-throw');
  });

  it('maxTriangles, binary: maxTriangles 0 rejects any facet and an empty file is EMPTY, not TOO_MANY', () => {
    expect(codeOf(() => parseStl(binaryStl(tris(1)), { maxTriangles: 0 }))).toBe('E_MODEL_TOO_MANY_TRIANGLES');
    expect(codeOf(() => parseStl(binaryStl([]), { maxTriangles: 0 }))).toBe('E_MODEL_EMPTY');
  });

  it('maxTriangles, ASCII (counted after the loader): 3 facets pass at 3 and 4, fail at 2', () => {
    const src = asciiStl(tris(3));
    expect(codeOf(() => parseStl(src, { maxTriangles: 2 }))).toBe('E_MODEL_TOO_MANY_TRIANGLES');
    expect(codeOf(() => parseStl(src, { maxTriangles: 3 }))).toBe('no-throw');
    expect(codeOf(() => parseStl(src, { maxTriangles: 4 }))).toBe('no-throw');
  });
});

/** Largest numeric-length Float32Array constructed while `fn` runs (a loader sizing an array from a header). */
function maxFloat32Request(fn: () => unknown): { max: number; outcome: string } {
  const Orig = globalThis.Float32Array;
  let max = 0;
  const Probe = new Proxy(Orig, {
    construct(target, args, newTarget) {
      if (typeof args[0] === 'number' && args[0] > max) max = args[0];
      return Reflect.construct(target, args, newTarget);
    }
  });
  vi.stubGlobal('Float32Array', Probe);
  let outcome = 'no-throw';
  try {
    fn();
  } catch (e) {
    outcome = e instanceof ModelParseError ? `${e.code}: ${e.message}` : `raw:${String(e)}`;
  } finally {
    vi.unstubAllGlobals();
  }
  return { max, outcome };
}

describe('parseStl: a header that overstates its facet count allocates nothing before failing', () => {
  const small = (declared: number): Uint8Array => binaryStl(tris(1), { declared }); // 134 bytes

  it('134 bytes claiming 100,000 and 5,000,000 facets: E_MODEL_PARSE, no large array constructed', () => {
    for (const declared of [100_000, 5_000_000]) {
      const r = maxFloat32Request(() => parseStl(small(declared)));
      expect(r.outcome).toBe(`E_MODEL_PARSE: STL declares ${declared} triangles but holds 1`);
      expect(r.max).toBeLessThan(1000);
    }
  });

  it('a header-only 84-byte file claiming 5,000,000 facets holds 0', () => {
    const r = maxFloat32Request(() => parseStl(binaryStl([], { declared: 5_000_000 })));
    expect(r.outcome).toBe('E_MODEL_PARSE: STL declares 5000000 triangles but holds 0');
    expect(r.max).toBeLessThan(1000);
  });

  it('a SHORT file whose claim is over maxTriangles is E_MODEL_PARSE (capacity is checked first), also at the uint32 maximum', () => {
    const over = maxFloat32Request(() => parseStl(small(5_000_000), { maxTriangles: 10 }));
    expect(over.outcome).toBe('E_MODEL_PARSE: STL declares 5000000 triangles but holds 1');
    expect(over.max).toBeLessThan(1000);
    const huge = maxFloat32Request(() => parseStl(small(4_294_967_295)));
    expect(huge.outcome).toBe('E_MODEL_PARSE: STL declares 4294967295 triangles but holds 1');
    expect(huge.max).toBeLessThan(1000);
  });

  it('a FULL-length file over maxTriangles is E_MODEL_TOO_MANY_TRIANGLES, and the loader never runs', () => {
    const spy = vi.spyOn(STLLoader.prototype, 'parse');
    const r = maxFloat32Request(() => parseStl(binaryStl(tris(3)), { maxTriangles: 2 }));
    expect(r.outcome).toBe('E_MODEL_TOO_MANY_TRIANGLES: STL declares 3 triangles, exceeds limit 2');
    expect(r.max).toBeLessThan(1000);
    expect(spy).not.toHaveBeenCalled();
  });

  it("three's tolerance: a file 1 or 2 bytes short of its last facet's attribute word still loads", () => {
    for (const short of [1, 2]) {
      const full = binaryStl(tris(2));
      const src = full.slice(0, full.length - short);
      const scene = parseStl(src);
      expect(Array.from(scene.objects[0].geometry.positions)).toEqual([...TRI, ...TRI]);
    }
  });

  it('a file 3 bytes short of its last facet fails with E_MODEL_PARSE (as before the guard)', () => {
    const full = binaryStl(tris(2));
    const src = full.slice(0, full.length - 3);
    expect(src.byteLength).toBe(181);
    expect(maxFloat32Request(() => parseStl(src)).outcome).toBe('E_MODEL_PARSE: STL declares 2 triangles but holds 1');
  });

  it('the "holds" count includes the tolerance: 182 bytes hold 2 facets', () => {
    const src = binaryStl(tris(2), { declared: 3 }).slice(0, 182);
    expect(() => parseStl(src)).toThrow('STL declares 3 triangles but holds 2');
  });

  it('the tolerance applies before the cap: 2 bytes short and over the cap is TOO_MANY, 3 bytes short is PARSE', () => {
    const full = binaryStl(tris(3));
    expect(codeOf(() => parseStl(full.slice(0, full.length - 2), { maxTriangles: 2 }))).toBe(
      'E_MODEL_TOO_MANY_TRIANGLES'
    );
    expect(codeOf(() => parseStl(full.slice(0, full.length - 3), { maxTriangles: 2 }))).toBe('E_MODEL_PARSE');
  });

  it('a claim of exactly what the file holds (cap-1 / cap / cap+1 around it) passes through', () => {
    // 134 bytes hold 1 facet: claiming 1 is exact, claiming 2 is one more than it holds.
    expect(maxFloat32Request(() => parseStl(small(1))).outcome).toBe('no-throw');
    expect(maxFloat32Request(() => parseStl(small(2))).outcome).toBe(
      'E_MODEL_PARSE: STL declares 2 triangles but holds 1'
    );
    // claiming 0 while holding 1 is not a bound violation: the loader reads no facets and the result is empty
    expect(maxFloat32Request(() => parseStl(small(0))).outcome).toBe('E_MODEL_EMPTY: STL contains no triangles');
  });

  it('with trailing bytes the claim is bounded by the cap before the loader on that path too', () => {
    const spy = vi.spyOn(STLLoader.prototype, 'parse');
    const src = binaryStl(tris(3), { trailing: 7 });
    expect(codeOf(() => parseStl(src, { maxTriangles: 2 }))).toBe('E_MODEL_TOO_MANY_TRIANGLES');
    expect(spy).not.toHaveBeenCalled();
    expect(codeOf(() => parseStl(src, { maxTriangles: 3 }))).toBe('no-throw');
    expect(codeOf(() => parseStl(src, { maxTriangles: 4 }))).toBe('no-throw');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a file at the cap with >= 48 trailing bytes loads: the cap applies to the claim, not to what the file holds', () => {
    // 4 declared facets + 50 (or 48) trailing bytes: the file "holds" 5 by length, but the loader reads only the 4 claimed.
    for (const trailing of [50, 48]) {
      const scene = parseStl(binaryStl(tris(4), { trailing }), { maxTriangles: 4 });
      expect(scene.objects[0].geometry.positions).toHaveLength(36);
    }
  });

  it('a claim over both the cap and the capacity is E_MODEL_PARSE, and so is one at the cap; neither reaches the loader', () => {
    const spy = vi.spyOn(STLLoader.prototype, 'parse');
    expect(codeOf(() => parseStl(small(11), { maxTriangles: 10 }))).toBe('E_MODEL_PARSE');
    expect(codeOf(() => parseStl(small(10), { maxTriangles: 10 }))).toBe('E_MODEL_PARSE');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('parseStl: the STLLoader ASCII-vs-binary rule we mirror (a three upgrade that changes it must fail here)', () => {
  /** ASCII STL whose bytes 80..83 are "zzzz" (a uint32 of 2,054,847,098) after `prefix` and `solid `. */
  function asciiWithCountBytes(prefix: string): Uint8Array {
    const name = 'n'.repeat(80 - prefix.length - 'solid '.length) + 'zzzz';
    const text =
      `${prefix}solid ${name}\n` +
      'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 20 0\nendloop\nendfacet\n' +
      'endsolid\n';
    const bytes = new TextEncoder().encode(text);
    expect(Array.from(bytes.slice(80, 84))).toEqual([122, 122, 122, 122]);
    return bytes;
  }

  it('"solid" at offset 0 and at offset 4: ASCII, even though bytes 80..83 read as a huge count', () => {
    for (const prefix of ['', '    ']) {
      const scene = parseStl(asciiWithCountBytes(prefix));
      expect(scene.bounds).toEqual({ min: [0, 0, 0], max: [10, 20, 0] });
    }
  });

  it('"solid" at offset 5 is not ASCII to the loader: binary path, so the claim is bounded first', () => {
    const spy = vi.spyOn(STLLoader.prototype, 'parse');
    const src = asciiWithCountBytes('     ');
    // 2,054,847,098 claimed, far more than the file holds: the capacity check fires, before any allocation
    expect(maxFloat32Request(() => parseStl(src)).outcome).toMatch(
      /^E_MODEL_PARSE: STL declares 2054847098 triangles but holds \d+$/
    );
    expect(maxFloat32Request(() => parseStl(src, { maxTriangles: 3_000_000_000 })).outcome).toMatch(
      /^E_MODEL_PARSE: STL declares 2054847098 triangles but holds \d+$/
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it('"solid" at offset 5 with a claim the file holds is binary, so the cap applies without the loader', () => {
    const spy = vi.spyOn(STLLoader.prototype, 'parse');
    const src = binaryStl(tris(3), { trailing: 7 });
    src.set(new TextEncoder().encode('solid'), 5);
    expect(codeOf(() => parseStl(src, { maxTriangles: 2 }))).toBe('E_MODEL_TOO_MANY_TRIANGLES');
    expect(spy).not.toHaveBeenCalled();
  });

  describe("three's own STLLoader rule (pinned directly: a three upgrade that widens or narrows it fails here)", () => {
    /** 134 bytes, count field 0, "solid" at `off` followed by one ASCII facet that ends before byte 80. */
    function solidAt(off: number): ArrayBuffer {
      const bytes = new Uint8Array(134);
      const text = 'solid facet vertex 0 0 0 vertex 1 0 0 vertex 0 1 0 endfacet endsolid';
      bytes.set(new TextEncoder().encode(text), off);
      expect(off + text.length).toBeLessThan(80);
      return bytes.buffer;
    }

    it('"solid" at offset 4 is ASCII: one facet, three vertices', () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined); // a facet with no normal is logged
      const geom = new STLLoader().parse(solidAt(4));
      expect(geom.getAttribute('position').count).toBe(3);
    });

    it('"solid" at offset 5 is binary: the count field (0) rules, so no facets', () => {
      const geom = new STLLoader().parse(solidAt(5));
      expect(geom.getAttribute('position').count).toBe(0);
    });
  });

  it('S15: an ASCII facet with 4 or 2 vertices counts triangles by floor(vertices / 3)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const facet = (n: number): Uint8Array =>
      new TextEncoder().encode(
        `solid t\nfacet normal 0 0 1\nouter loop\n${Array.from({ length: n }, (_, i) => `vertex ${i} 0 0\n`).join('')}endloop\nendfacet\nendsolid t\n`
      );
    // 4 vertices = 1 whole triangle (floor 1; ceil would be 2)
    expect(codeOf(() => parseStl(facet(4), { maxTriangles: 1 }))).toBe('no-throw');
    expect(codeOf(() => parseStl(facet(4), { maxTriangles: 0 }))).toBe('E_MODEL_TOO_MANY_TRIANGLES');
    // 2 vertices = 0 whole triangles (floor 0; ceil would be 1)
    expect(codeOf(() => parseStl(facet(2), { maxTriangles: 0 }))).toBe('no-throw');
  });

  it('an exact-size binary file whose header starts with "solid" is binary: the size rule wins', () => {
    const src = binaryStl([TRI]);
    src.set(new TextEncoder().encode('solid exported by a CAD tool'), 0);
    const spy = vi.spyOn(STLLoader.prototype, 'parse');
    expect(parseStl(src).bounds).toEqual({ min: [0, 0, 0], max: [10, 20, 0] });
    // …and it is bounded like any binary file: 1 facet claimed, cap 0.
    expect(codeOf(() => parseStl(src, { maxTriangles: 0 }))).toBe('E_MODEL_TOO_MANY_TRIANGLES');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a 5-offset "solid" match needs all five letters', () => {
    const src = asciiWithCountBytes('');
    src[0] = 0x58; // "Xolid …": "solid" no longer starts at any of offsets 0..4
    src[4] = 0x58;
    // rejected by the header guard (not by the loader's allocation failing): its message says what it counted
    expect(() => parseStl(src, { maxTriangles: 3_000_000_000 })).toThrow(
      /^STL declares 2054847098 triangles but holds \d+$/
    );
  });

  it('an ASCII solid whose bytes 80..83 happen to read as a small count is still ASCII, not capped by that count', () => {
    // bytes 80..83 = 03 00 00 00 → a claim of 3 facets, which this 400-byte text could "hold"
    const name = 'n'.repeat(80 - 'solid '.length) + '\u0003\u0000\u0000\u0000';
    const text =
      `solid ${name}\n` +
      'facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 20 0\nendloop\nendfacet\n' +
      `${' '.repeat(300)}\nendsolid\n`;
    const src = new TextEncoder().encode(text);
    expect(Array.from(src.slice(80, 84))).toEqual([3, 0, 0, 0]);
    expect(src.byteLength).toBeGreaterThan(84 + 3 * 50);
    expect(parseStl(src, { maxTriangles: 2 }).bounds).toEqual({ min: [0, 0, 0], max: [10, 20, 0] });
  });
});

describe('parseStl: result shape', () => {
  it('reports min/max bounds per axis from negative and positive coordinates', () => {
    const scene = parseStl(binaryStl([[-1, 5, 2, 3, -4, 8, 0, 9, -6]]));
    expect(scene.bounds).toEqual({ min: [-1, -4, -6], max: [3, 9, 8] });
  });

  it('keeps valid file normals and repairs zero ones from the winding', () => {
    const scene = parseStl(binaryStl([TRI])); // normal 0 0 0 in the file
    expect(Array.from(scene.objects[0].geometry.normals ?? [])).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  });

  it('declares every capability honestly', () => {
    expect(parseStl(binaryStl([TRI])).capabilities).toEqual({
      materials: 'unavailable',
      transforms: 'unavailable',
      multiObject: 'unavailable',
      instanced: 'unavailable',
      plates: 'unavailable'
    });
  });

  it('a non-finite coordinate names its vertex index', () => {
    const src = binaryStl([TRI, [0, 0, 0, 1, 0, 0, 0, Number.NaN, 0]]);
    expect(() => parseStl(src)).toThrow(/vertex 5 has a non-finite coordinate/);
  });
});

describe('repairFacetNormals', () => {
  const P = [1, 2, 3, 4, 6, 9, 2, 7, 4]; // edges (3,4,6) x (1,5,1) = (-26, 3, 11)
  const N: [number, number, number] = [-0.915810939779251, 0.10567049305145204, 0.3874584745219908];
  const expectNormal = (out: Float32Array, at: number, n: readonly number[]): void => {
    for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) expect(out[at + v * 3 + k]).toBeCloseTo(n[k], 6);
  };

  it('a zero normal becomes the unit winding normal on all three vertices', () => {
    expectNormal(repairFacetNormals(new Float32Array(P), new Float32Array(9)), 0, N);
  });

  it('a valid file normal is kept verbatim, even when it is not unit length or disagrees with the winding', () => {
    const out = repairFacetNormals(new Float32Array(P), new Float32Array([0, 0, 5, 0, 0, 5, 0, 0, 5]));
    expect(Array.from(out)).toEqual([0, 0, 5, 0, 0, 5, 0, 0, 5]);
  });

  it('the validity threshold is a length of 1e-6: 2e-6 is kept, 5e-7 is repaired', () => {
    const kept = repairFacetNormals(new Float32Array(P), new Float32Array([2e-6, 0, 0, 2e-6, 0, 0, 2e-6, 0, 0]));
    expect(kept[0]).toBe(Math.fround(2e-6));
    expect(kept[1]).toBe(0);
    const fixed = repairFacetNormals(new Float32Array(P), new Float32Array([5e-7, 0, 0, 5e-7, 0, 0, 5e-7, 0, 0]));
    expectNormal(fixed, 0, N);
  });

  it('an infinite or NaN normal is repaired', () => {
    expectNormal(repairFacetNormals(new Float32Array(P), new Float32Array([Infinity, 0, 0, 0, 0, 0, 0, 0, 0])), 0, N);
    expectNormal(repairFacetNormals(new Float32Array(P), new Float32Array([NaN, 1, 1, 0, 0, 0, 0, 0, 0])), 0, N);
  });

  it('a collinear (zero-area) triangle keeps a zero normal, not NaN', () => {
    const out = repairFacetNormals(new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]), new Float32Array(9));
    expect(Array.from(out)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('a tiny but non-degenerate triangle still gets a unit normal', () => {
    const out = repairFacetNormals(new Float32Array([0, 0, 0, 0.001, 0, 0, 0, 0.001, 0]), new Float32Array(9));
    expectNormal(out, 0, [0, 0, 1]);
  });

  it('walks every facet: a valid one is skipped, the next degenerate one is repaired', () => {
    const positions = new Float32Array([...P, ...P]);
    const normals = new Float32Array([0, 0, 5, 0, 0, 5, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const out = repairFacetNormals(positions, normals);
    expect(Array.from(out.slice(0, 9))).toEqual([0, 0, 5, 0, 0, 5, 0, 0, 5]);
    expectNormal(out, 9, N);
  });

  it('never reads or writes past the positions array: a facet with no positions is left alone', () => {
    const normals = new Float32Array(18).fill(NaN); // 2nd facet is degenerate but has no positions behind it
    normals.fill(0, 0, 9);
    const out = repairFacetNormals(new Float32Array(P), normals);
    expectNormal(out, 0, N);
    expect(out.slice(9).every(Number.isNaN)).toBe(true);
  });

  it('a trailing partial facet in the normals is not processed', () => {
    const out = repairFacetNormals(new Float32Array([...P, ...P]), new Float32Array(17));
    expectNormal(out, 0, N);
    expect(Array.from(out.slice(9))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
