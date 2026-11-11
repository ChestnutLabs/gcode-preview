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
  ['printing object myunique id:1', 'myunique', '1']
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
