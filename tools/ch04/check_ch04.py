import re
import parse_ch04 as P
import solve_ch04 as S

all_data = P.parse_all()
key = P.answer_key()
S.build_part_map(all_data, key)

texts = {v: open(P.SRC[v], encoding='utf-8').read() for v in P.VERS}

total = 0
wrong = []
unsolved = []
for ver in ['B', 'C', 'D']:
    for n in range(1, 51):
        rec = all_data[ver][n]
        fig_source = None
        if rec['fig'] and rec['fig'][0] == 'tikz':
            fig_source = P.macro_body(texts[ver], rec['fig'][1])
        got = S.solve(rec, n, fig_source)
        want = key[n][ver]
        total += 1
        if got is None:
            unsolved.append((ver, n))
        elif got.upper() != want:
            wrong.append((ver, n, got, want, rec['choices']))

print(f'{total} checked, {len(wrong)} wrong, {len(unsolved)} unsolved')
for w in wrong[:40]:
    print('WRONG', w)
for u in unsolved[:40]:
    print('UNSOLVED', u)
