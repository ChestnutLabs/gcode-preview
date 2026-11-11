/**
 * `matchPrintingObjectStart` name extraction (issue #469): the name is derived by index arithmetic,
 * not a backtracking scan, and must equal the previous regex on every real lineage marker shape.
 */
import { describe, expect, it } from 'vitest';
import { matchPrintingObjectStart } from '../object-markers';

/** The pre-#469 name logic, kept verbatim as the differential oracle. */
function oldName(trimmed: string): string | undefined {
  if (!/^(?:start\s+)?printing object\b/i.test(trimmed)) return undefined;
  if (/\bid:?\s*(\d+)/i.exec(trimmed) === null) return undefined;
  const suffix = /\bname:\s*(.+?)\s*$/i.exec(trimmed);
  let name: string;
  if (suffix !== null) {
    name = suffix[1].trim();
  } else {
    const pre = /printing object[,:]?\s*(?:"([^"]*)"|(.+?))\s+(?:unique\s+(?:label\s+)?)?id:?/i.exec(trimmed);
    name = (pre?.[1] ?? pre?.[2] ?? '').trim();
    if (/^unique(\s+label)?$/i.test(name)) name = '';
  }
  return name.length > 0 ? name : '';
}

const SAMPLES: Array<[string, string, string]> = [
  // [line, expected name ('' = none), id]
  ['printing object my_widget.stl id:729618461984033312', 'my_widget.stl', '729618461984033312'],
  ['printing object widget.stl id:0 copy 0', 'widget.stl', '0'],
  ['printing object "my widget.stl" id:0 copy 0', 'my widget.stl', '0'],
  ['printing object "" id:3', '', '3'],
  ['printing object, widget id:12', 'widget', '12'],
  ['printing object: widget id:12', 'widget', '12'],
  ['printing object two words here id:5', 'two words here', '5'],
  ['start printing object, unique label id: 89', '', '89'],
  ['start printing object, unique label id: 89 name: Cube A', 'Cube A', '89'],
  ['start printing object unique id:7', '', '7'],
  ['printing object foo unique id:7', 'foo', '7'],
  ['printing object foo unique label id:7', 'foo', '7'],
  ['printing object "foo bar" unique label id:7', 'foo bar', '7'],
  ['printing object "foo unique" id:7', 'foo unique', '7'],
  ['PRINTING OBJECT Foo ID:9', 'Foo', '9'],
  ['printing object "a"b" id:4', '"a"b"', '4'],
  ['printing object " padded " id:1', 'padded', '1'],
  ['printing object-id1', '', '1'],
  ['printing object myunique id:1', 'myunique', '1'],
  ['printing object " id:3', '"', '3']
];

describe('matchPrintingObjectStart names (#469)', () => {
  it.each(SAMPLES)('%s', (line, name, id) => {
    expect(matchPrintingObjectStart(line)).toEqual({ id, name: name === '' ? undefined : name });
  });

  it.each(SAMPLES)('matches the previous regex: %s', (line) => {
    const got = matchPrintingObjectStart(line);
    expect(got?.name ?? '').toBe(oldName(line));
  });

  it('a 64 KiB crafted line returns promptly (was ~740 ms)', () => {
    const line = 'printing object '.repeat(4096) + '-id1';
    expect(line.length).toBeGreaterThanOrEqual(65536);
    const t0 = performance.now();
    const got = matchPrintingObjectStart(line);
    const ms = performance.now() - t0;
    expect(got).toEqual({ id: '1', name: undefined });
    expect(ms).toBeLessThan(100);
  });
});

/** Lines whose id/name the previous regexes got WRONG (truncated names, name-embedded `id<digits>`). */
const FIXED: Array<[string, string, string]> = [
  ['printing object bracket(id2) id:7', 'bracket(id2)', '7'],
  ['printing object rev-id5 thing id:3', 'rev-id5 thing', '3'],
  ['printing object my id thing id:3', 'my id thing', '3'],
  ['printing object Ender idler pulley id:7', 'Ender idler pulley', '7'],
  ['printing object Box Identity id:5', 'Box Identity', '5'],
  ['printing object,id:3', '', '3']
];

describe('whitespace-anchored id selection', () => {
  it.each(FIXED)('%s', (line, name, id) => {
    expect(matchPrintingObjectStart(line)).toEqual({ id, name: name === '' ? undefined : name });
  });

  it('distinct objects whose names embed id<digits> get distinct ids', () => {
    const a = matchPrintingObjectStart('printing object bracket(id2) id:7');
    const b = matchPrintingObjectStart('printing object clip(id2) id:8');
    expect(a?.id).toBe('7');
    expect(b?.id).toBe('8');
  });

  it('an empty `name:` suffix falls back to the name before the id', () => {
    expect(matchPrintingObjectStart('printing object Cube id:3 name:')).toEqual({ id: '3', name: 'Cube' });
  });

  it('`printing objects` is not a marker', () => {
    expect(matchPrintingObjectStart('printing objects id:5')).toBeNull();
  });

  it('keeps Bambu `, unique label id: 89` and Prusa ` id:0 copy 0` ids', () => {
    expect(matchPrintingObjectStart('start printing object, unique label id: 89')?.id).toBe('89');
    expect(matchPrintingObjectStart('printing object widget.stl id:0 copy 0')?.id).toBe('0');
  });
});

describe('`name:` suffix (#469 review)', () => {
  /** The pre-fix suffix regex, verbatim, as the differential oracle. */
  const oldSuffix = (line: string): string | undefined => /\bname:\s*(.+?)\s*$/i.exec(line)?.[1].trim();
  const cases = ['name: Cube', 'name:', 'name:  a  b', 'name:a name:b', 'name:x name:', 'name: Cube  '];

  it.each(cases)('prefixed %s matches the previous regex', (suffix) => {
    const line = 'printing object id:1 ' + suffix;
    const old = oldSuffix(line);
    expect(matchPrintingObjectStart(line)?.name).toBe(old === '' ? undefined : old);
  });

  it('literal names', () => {
    expect(matchPrintingObjectStart('printing object id:1 name: Cube')?.name).toBe('Cube');
    expect(matchPrintingObjectStart('printing object id:1 name:  a  b')?.name).toBe('a  b');
    expect(matchPrintingObjectStart('printing object id:1 name:a name:b')?.name).toBe('a name:b');
  });

  it('a 64 KiB crafted `name:` line returns promptly (was ~6.9 s)', () => {
    const line = 'printing object id:1 name:a' + ' '.repeat(65536) + 'b';
    const t0 = performance.now();
    const got = matchPrintingObjectStart(line);
    const ms = performance.now() - t0;
    expect(got?.id).toBe('1');
    expect(got?.name?.length).toBe(65538);
    expect(ms).toBeLessThan(100);
  });
});
