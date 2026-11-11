/**
 * #468 — the model-XML tokenizer (`TagScanner`) and attribute parser (`attrs`) are LINEAR and byte-identical to
 * the old regex implementations. The legacy regexes below are VERBATIM copies kept only as differential
 * oracles; delete them if the old forms ever need to go from the repo. They are quadratic on hostile input, so
 * they only ever see small inputs here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { readDirectory, extractEntry, DEFAULT_CONTAINER_LIMITS } from '@chestnutlabs/gcode-containers';
import { TagScanner, attrs } from '../three-mf.js';

const LEGACY_TAG_RE = /<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const LEGACY_ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

type Tok = [closing: boolean, name: string, selfClose: boolean, raw: string];

function legacyTags(xml: string): Tok[] {
  const out: Tok[] = [];
  LEGACY_TAG_RE.lastIndex = 0;
  let t: RegExpExecArray | null;
  while ((t = LEGACY_TAG_RE.exec(xml)) !== null) out.push([t[1] === '/', t[2], t[4] === '/', t[3]]);
  return out;
}

function legacyAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  LEGACY_ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LEGACY_ATTR_RE.exec(s)) !== null) out[m[1]] = m[2] ?? m[3] ?? '';
  return out;
}

function tags(xml: string): Tok[] {
  const s = new TagScanner(xml);
  const out: Tok[] = [];
  while (s.next()) out.push([s.closing, s.name, s.selfClose, s.raw]);
  return out;
}

/** mulberry32 — fixed-seed PRNG so a failure reproduces. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomString(next: () => number, alphabet: readonly string[], maxLen: number): string {
  const len = Math.floor(next() * maxLen);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[Math.floor(next() * alphabet.length)];
  return s;
}

/** JSON.stringify drops undefined-valued keys, which would hide a spurious attribute. */
const showUndefined = (o: Record<string, string>): string =>
  JSON.stringify(Object.entries(o), (_k, v) => (v === undefined ? '<undefined>' : v));

function elapsedMs(f: () => void): number {
  const t0 = performance.now();
  f();
  return performance.now() - t0;
}

describe('TagScanner — literal expectations', () => {
  it('reads names, closing and self-closing markers, and the raw attribute text', () => {
    expect(tags('<model unit="mm"><object id="1"/></object></model>')).toEqual([
      [false, 'model', false, ' unit="mm"'],
      [false, 'object', true, ' id="1"'],
      [true, 'object', false, ''],
      [true, 'model', false, '']
    ]);
  });

  it('keeps namespaced names whole (the caller strips the prefix)', () => {
    expect(tags('<p:component p:path="/3D/x.model" objectid="2"/>')).toEqual([
      [false, 'p:component', true, ' p:path="/3D/x.model" objectid="2"']
    ]);
  });

  it('does not end a tag at a `>` inside a quoted value (either quote)', () => {
    expect(tags(`<a b="x>y" c='p>q'/><z>`)).toEqual([
      [false, 'a', true, ` b="x>y" c='p>q'`],
      [false, 'z', false, '']
    ]);
  });

  it('a `/` that is not right before the `>` is body text, not a self-close', () => {
    expect(tags('<a b="x/" c=y/z / >')).toEqual([[false, 'a', false, ' b="x/" c=y/z / ']]);
    expect(tags('<a b="x/">')).toEqual([[false, 'a', false, ' b="x/"']]);
  });

  it('skips declarations, comments and CDATA (no name) but still tokenizes tags inside them', () => {
    expect(tags('<?xml version="1.0"?><!-- <c d="1"/> --><![CDATA[ <e/> ]]>')).toEqual([
      [false, 'c', true, ' d="1"'],
      [false, 'e', true, '']
    ]);
  });

  it('a truncated file yields the tags before the cut and nothing after it', () => {
    expect(tags('<a x="1"/><b y="2"/><c z="3')).toEqual([
      [false, 'a', true, ' x="1"'],
      [false, 'b', true, ' y="2"']
    ]);
    expect(tags('<a/><b ')).toEqual([[false, 'a', true, '']]);
  });

  it('a stray quote fails the tag it is in, and the tags after it still parse (retry at the next `<`)', () => {
    // `<a x="1 <b y='2'/>`: the `"` never closes ⇒ `<a` fails, `<b y='2'/>` is recovered.
    expect(tags(`<a x="1 <b y='2'/>`)).toEqual([[false, 'b', true, ` y='2'`]]);
  });

  it('a tag inside the quoted value of a tag that then fails is still found (phase shift)', () => {
    // `<a x="p <b y='1'>" z='unclosed` — `<a` fails (the `'` never closes), `<b y='1'>` is found.
    expect(tags(`<a x="p <b y='1'>" z='unclosed`)).toEqual([[false, 'b', false, ` y='1'`]]);
  });

  it('a quote chain with no `>` left yields nothing', () => {
    expect(tags('<a "x" "y" "z"')).toEqual([]);
    expect(tags('<a "x" "y" "z')).toEqual([]);
  });

  it('a `<` with no name is skipped one character at a time', () => {
    expect(tags('< a><>< /a></ a><//a><b>')).toEqual([[false, 'b', false, '']]);
  });

  it('only the memo bitmap grows, lazily, and never past the input length in bits', () => {
    const clean = new TagScanner('<a x="1"/><b y="2"/>');
    while (clean.next());
    expect(Reflect.get(clean, 'failed')).toBeNull();
    const xml = '<a "x"'.repeat(1000);
    const bad = new TagScanner(xml);
    while (bad.next());
    const bitmap = Reflect.get(bad, 'failed') as Uint8Array;
    expect(bitmap.length).toBe(Math.floor(xml.length / 8) + 1);
  });
});

describe('attrs — literal expectations', () => {
  it('reads double- and single-quoted values, empty values and namespaced names', () => {
    expect(attrs(` x="1" y='2' z="" p:path='/a b' `)).toStrictEqual({ x: '1', y: '2', z: '', 'p:path': '/a b' });
  });

  it('tolerates whitespace around `=` and skips words with no quoted value', () => {
    expect(attrs(' a = "1"  b\t=\n\'2\' c d= e="3"')).toStrictEqual({ a: '1', b: '2', e: '3' });
  });

  it('a name run directly after a closing quote is a new attribute', () => {
    expect(attrs('a="1"b="2"')).toStrictEqual({ a: '1', b: '2' });
  });

  it('a later duplicate wins, as before', () => {
    expect(attrs('a="1" a="2"')).toStrictEqual({ a: '2' });
  });
});

describe('differential vs the legacy regexes', () => {
  const HAND: string[] = [
    '',
    '<',
    '>',
    '<a>',
    '</a>',
    '<a/>',
    '</a/>',
    '<a b="1" c=\'2\'/>',
    '<a b="x>y"/>',
    "<a b='x>y'/>",
    '<a b="x\'y">',
    "<a b='x\"y'>",
    '<a "x',
    "<a 'x",
    '<a "x" "y',
    '<a "x"<b "y">',
    "<a x=\"1 <b y='2'/>",
    "<a x=\"p <b y='1'>\" z='unclosed",
    '<a <b <c >',
    '<a <b <c',
    '<a/><b/><c',
    '<?xml version="1.0"?><model/>',
    '<!-- <c d="1"/> --><e/>',
    '<![CDATA[ <e f="1"/> ]]>',
    '< a><><  /a></ a><//a><b>',
    '<p:q.r-s_t:u b="1"/>',
    '<a\nb="1"\n/>',
    '<a b=">"/>\n<c/>',
    '<a b="1"/>>>>',
    '<<<a>',
    '<a>"<b>',
    '<a b="1"><c d=\'2\'></c></a>',
    '<h1 a2="3"/><AZaz09:._-x y="1"/>',
    '<a@b><a[b><a`b><a{b><a;b><a/b><a,b>',
    '<@a><[a><`a><{a><;a><,a><0a/><:a/><.a/><-a/><_a/>',
    '<Z z="1"/><A a="2"/><9 x="1"/>'
  ];

  it('hand cases: tags and attrs are identical', () => {
    for (const xml of HAND) {
      expect(tags(xml), JSON.stringify(xml)).toEqual(legacyTags(xml));
      expect(attrs(xml), JSON.stringify(xml)).toStrictEqual(legacyAttrs(xml));
    }
  });

  it('seeded random garbled strings: tag sequences are identical', () => {
    const next = rng(0x468);
    const alphabet = [
      '<',
      '>',
      '/',
      '"',
      "'",
      ' ',
      'a',
      'b',
      ':',
      '-',
      '=',
      '\n',
      '</',
      '<a',
      '/>',
      '="',
      "='",
      '<?',
      '<!--'
    ];
    for (let i = 0; i < 12000; i++) {
      const xml = randomString(next, alphabet, i % 4 === 0 ? 120 : 30);
      const got = tags(xml);
      const want = legacyTags(xml);
      if (JSON.stringify(got) !== JSON.stringify(want)) expect(got, JSON.stringify(xml)).toEqual(want);
    }
  });

  it('seeded random garbled strings: attribute maps are identical', () => {
    const next = rng(0x4a77);
    const alphabet = ['a', 'b', '=', '"', "'", ' ', '\t', ':', '-', '.', 'ab', '=""', "=''", ' ', '\n'];
    for (let i = 0; i < 12000; i++) {
      const s = randomString(next, alphabet, 40);
      const got = attrs(s);
      const want = legacyAttrs(s);
      if (showUndefined(got) !== showUndefined(want)) expect(got, JSON.stringify(s)).toStrictEqual(want);
    }
  });

  it('every XML part of the corpus 3MFs tokenizes identically', async () => {
    const dir = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      'test-data',
      'fixtures',
      'containers'
    );
    const files = readdirSync(dir).filter((f) => f.endsWith('.3mf'));
    // fixture → [XML parts, tokens]. Readable fixtures only; a new fixture is added here deliberately.
    const found: Record<string, [number, number]> = {};
    for (const f of files) {
      const bytes = new Uint8Array(readFileSync(join(dir, f)));
      let entries;
      try {
        entries = readDirectory(bytes, DEFAULT_CONTAINER_LIMITS).entries;
      } catch {
        continue; // the adv-* fixtures that are deliberately unreadable
      }
      for (const e of entries) {
        if (!/\.(model|config|rels|xml)$/i.test(e.name)) continue;
        let xml: string;
        try {
          xml = new TextDecoder().decode(await extractEntry(bytes, e, 4 * 1024 * 1024));
        } catch {
          continue;
        }
        const want = legacyTags(xml);
        expect(tags(xml), `${f}:${e.name}`).toEqual(want);
        const [p, t] = found[f] ?? [0, 0];
        found[f] = [p + 1, t + want.length];
      }
    }
    // Guards against an empty corpus / a silently skipped loop, per fixture so an unrelated new fixture
    // only adds its own line. The committed model parts are tiny stubs (8 and 45 bytes: 1 + 3 tags), so the
    // realistic-document case below carries the volume. A fixture missing here, or missing from `found`, fails.
    expect(found).toEqual({
      'adv-bad-crc.gcode.3mf': [1, 0],
      'mini-project.gcode.3mf': [2, 1],
      'mini-thumbs.gcode.3mf': [1, 0],
      'model-project.3mf': [2, 3]
    });
  });

  it('a realistic Bambu/Orca-style model part (namespaces, production extension, materials, CRLF) is identical', () => {
    const rows: string[] = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">',
      ' <metadata name="Title">a &gt; b</metadata>',
      ' <metadata name="Description">x = "y" &amp; \'z\'</metadata>',
      ' <resources>',
      '  <basematerials id="5"><base name="PLA" displaycolor="#FF8800FF"/><base name="PETG" displaycolor="#00AA44"/></basematerials>',
      '  <m:colorgroup id="6"><m:color color="#112233FF"/></m:colorgroup>',
      '  <object id="1" name="cube &gt; 2" type="model" pid="5" pindex="0">',
      '   <mesh><vertices>'
    ];
    for (let i = 0; i < 40; i++) rows.push(`    <vertex x="${i}.25" y="-${i}e-3" z="${i % 7}"/>`);
    rows.push('   </vertices><triangles>');
    for (let i = 0; i < 40; i++)
      rows.push(`    <triangle v1="${i}" v2="${i + 1}" v3="${i + 2}" p1="0" paint_color="4"/>`);
    rows.push(
      '   </triangles></mesh>',
      '  </object>',
      '  <object id="2" type="model"><components><component p:path="/3D/Objects/o.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 5 5 0"/></components></object>',
      ' </resources>',
      ' <build p:UUID="abc"><item objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0" printable="1"/></build>',
      '</model>'
    );
    const xml = rows.join('\r\n');
    const want = legacyTags(xml);
    expect(want.length).toBeGreaterThan(90);
    expect(tags(xml)).toEqual(want);
    for (const t of want) expect(attrs(t[3])).toStrictEqual(legacyAttrs(t[3]));
    // …and the same document cut at every 17th byte (truncated files).
    for (let cut = 0; cut < xml.length; cut += 17)
      expect(tags(xml.slice(0, cut))).toEqual(legacyTags(xml.slice(0, cut)));
  });
});

describe('crafted hostile input is linear (each < 100 ms; the legacy regex needs seconds on every shape)', () => {
  const BOUND_MS = 100;

  it('(1) 120 KB of `<a ` — a lazy body restarted at every `<` (legacy 11.6 s)', () => {
    const xml = '<a '.repeat(40000);
    let n = -1;
    expect(elapsedMs(() => (n = tags(xml).length))).toBeLessThan(BOUND_MS);
    expect(n).toBe(0);
  });

  it('(2) one 40k-char tag name with no `>` — the greedy name backtracked (legacy 3.8 s)', () => {
    const xml = '<' + 'a'.repeat(40000);
    let n = -1;
    expect(elapsedMs(() => (n = tags(xml).length))).toBeLessThan(BOUND_MS);
    expect(n).toBe(0);
  });

  it('(3) a lone unmatched quote after 40000 `<a ` starts (legacy 11.6 s)', () => {
    const xml = '<a '.repeat(40000) + '"';
    let n = -1;
    expect(elapsedMs(() => (n = tags(xml).length))).toBeLessThan(BOUND_MS);
    expect(n).toBe(0);
  });

  it('(4) a quote chain with no `>`: 15000 `<a "x"` starts (legacy ~6 s)', () => {
    const xml = '<a "x"'.repeat(15000);
    let n = -1;
    expect(elapsedMs(() => (n = tags(xml).length))).toBeLessThan(BOUND_MS);
    expect(n).toBe(0);
  });

  it('(5) alternating quote phases: `<a "` then 30000 `<b \'` and a closing `"` (legacy 10.5 s)', () => {
    const xml = '<a "' + "<b '".repeat(30000) + '"';
    let n = -1;
    expect(elapsedMs(() => (n = tags(xml).length))).toBeLessThan(BOUND_MS);
    expect(n).toBe(0);
  });

  it('(6) one 80 KB word with no `=` in an attribute list (legacy 8.5 s)', () => {
    const word = 'a'.repeat(80000);
    let got: Record<string, string> = {};
    expect(elapsedMs(() => (got = attrs(word)))).toBeLessThan(BOUND_MS);
    expect(got).toEqual({});
  });

  it('the same shapes at a size the legacy regex finishes quickly tokenize identically', () => {
    const small = [
      '<a '.repeat(150),
      '<' + 'a'.repeat(300),
      '<a '.repeat(150) + '"',
      '<a "x"'.repeat(100),
      '<a "' + "<b '".repeat(150) + '"',
      '<a "x" <b>'.repeat(80) + '<c/>',
      '<a x="1 ' + '<q '.repeat(100) + `'><v x="1"/><v x="2"/>`
    ];
    for (const xml of small) expect(tags(xml), xml.slice(0, 24)).toEqual(legacyTags(xml));
    expect(attrs('a'.repeat(300))).toStrictEqual(legacyAttrs('a'.repeat(300)));
  });

  it('(7) a stray quote early on does not cost the tags after it, and stays linear', () => {
    // `<a x="1 ` opens a quote that never closes ⇒ `<a` fails (a full-length scan). The first `<q ` then runs
    // to the first `>` (one tag with a huge raw) and the 1999 `<v/>` after it are recovered: 2000 tags.
    const good = `<v x='1'/>`.repeat(2000);
    const xml = '<a x="1 ' + '<q '.repeat(20000) + good;
    let n = -1;
    expect(elapsedMs(() => (n = tags(xml).length))).toBeLessThan(BOUND_MS);
    expect(n).toBe(2000);
  });
});
