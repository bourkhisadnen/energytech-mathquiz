"""Prove the Chapter 04 solver bites.

"150 of 150 agree" means nothing unless a wrong key would have been noticed.
For one representative question per family, point the key at a wrong option
and require solve() to disagree with that wrong option (i.e. it would have
flagged a mismatch had the real key actually said that).
"""
import parse_ch04 as P
import solve_ch04 as S

all_data = P.parse_all()
key = P.answer_key()
S.build_part_map(all_data, key)
texts = {v: open(P.SRC[v], encoding='utf-8').read() for v in P.VERS}


def solve_n(v, n):
    rec = all_data[v][n]
    fig_source = None
    if rec['fig'] and rec['fig'][0] == 'tikz':
        fig_source = P.macro_body(texts[v], rec['fig'][1])
    return S.solve(rec, n, fig_source)


FAMILIES = {
    'count significant figures': 3,
    'precision of a decimal measurement': 9,
    'greatest possible error (decimal)': 14,
    'precision/GPE of a fractional measurement': 16,
    'name the caliper part': 18,
    'read a vernier caliper (mm)': 20,
    'read a vernier caliper (in)': 22,
    'name the micrometer part': 24,
    'read a micrometer (metric)': 26,
    'read a micrometer (imperial)': 28,
    'most/least accurate measurement': 32,
    'sig-fig multiplication/division': 46,
    'sig-fig area or volume': 49,
}

caught = missed = 0
for what, n in sorted(FAMILIES.items(), key=lambda kv: kv[1]):
    hit = False
    for v in 'BCD':
        real = key[n][v]
        wrong = next(c for c in 'ABCD' if c != real)
        got = solve_n(v, n)
        if got is not None and got.upper() != wrong:
            hit = True
            break
    print(('  caught  ' if hit else '  MISSED  ') + f'Q{n}: {what}')
    caught += hit
    missed += not hit

print(f'\n{caught} of {caught + missed} question families would catch a wrong key.')
assert missed == 0, 'a family would not catch a corrupted key -- investigate'
