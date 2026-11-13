import sys, pathlib, importlib.util
sys.argv = ['red.py', sys.argv[1], 'F:/ab-scratch/g3/model-sweep/check.log', '--list']
spec = importlib.util.spec_from_file_location('red', 'F:/ab-scratch/g3/model-sweep/red.py')
red = importlib.util.module_from_spec(spec)
spec.loader.exec_module(red)
bad = 0
ids = set()
for mid, fk, old, new in red.M:
    if mid in ids:
        print('DUP', mid)
    ids.add(mid)
    src = (red.WT / red.F[fk]).read_bytes().decode('utf-8')
    if '\r\n' in src:
        old = old.replace('\n', '\r\n')
    c = src.count(old)
    if c != 1:
        bad += 1
        print(mid, 'count', c)
print('total', len(red.M), 'bad', bad)
