"""Version A's answer key, and the two independent routes to it.

Route 1 -- computed. `verify_ch12a.solve` derives the answer from the question
and its drawing. The same code, unchanged, reproduces the official key for all
246 questions of versions B, C and D, and every one of its 48 question families
would have complained had that key been wrong.

Route 2 -- transferred. For the questions where a version with a key asks the
identical question over the identical drawing, its correct option TEXT names the
answer, and A's option carrying that text is A's answer.

Where both routes speak they must agree, or the question is reported rather than
answered.
"""
import json, re
import verify_ch12a as V
import dataset

D, KEY, LETTERS = V.D, V.KEY, 'abcd'


def opt_norm(s):
    s = re.sub(r'\s+', ' ', s or '').strip().replace('$', '').replace('~', ' ')
    s = re.sub(r'\\(?:,|;|:|!)', ' ', s)
    s = re.sub(r'\\(?:mathrm|text|mbox)\{([^{}]*)\}', r'\1', s)
    return re.sub(r'\s+', ' ', s).strip().rstrip('.').lower()


def transferred(n):
    """{letter: [versions that vouch for it]} for question n of Version A."""
    a = D['A'][n]
    a_opts = [opt_norm(c) for c in a['choices']]
    votes = {}
    for v in 'BCD':
        x = D[v][n]
        if a['body'] != x['body'] or a['sha'] != x['sha']:
            continue
        want = opt_norm(x['choices']['abcd'.index(KEY[n][v])])
        if a_opts.count(want) != 1:
            continue
        votes.setdefault(LETTERS[a_opts.index(want)], []).append(v)
    return votes


def build():
    key, notes, trouble = {}, {}, []
    for n in range(1, 83):
        computed = V.solve(D['A'][n])
        votes = transferred(n)
        moved = list(votes)
        if len(moved) > 1:
            trouble.append((n, 'the versions that share this question disagree', votes))
            continue
        vouched = moved[0] if moved else None
        if computed and vouched and computed != vouched:
            trouble.append((n, f'computed ({computed}) but the twin says ({vouched})', votes))
            continue
        pick = computed or vouched
        if not pick:
            trouble.append((n, 'no answer could be derived', votes))
            continue
        key[n] = pick
        notes[n] = ('computed and confirmed by ' + '/'.join(votes[pick])
                    if computed and vouched else
                    'computed' if computed else
                    'transferred from ' + '/'.join(votes[pick]))
    return key, notes, trouble


if __name__ == '__main__':
    key, notes, trouble = build()
    print(f'Version A: {len(key)} of 82 answered')
    from collections import Counter
    print('how each was established:', Counter(
        'computed + twin' if n.startswith('computed and') else n.split(' from ')[0]
        for n in notes.values()))
    print('letter spread a/b/c/d:',
          [sum(1 for v in key.values() if v == L) for L in LETTERS])
    if trouble:
        print('\nNOT ANSWERED:')
        for n, why, votes in trouble:
            print(f'  Q{n}: {why} {votes}')
    json.dump({str(k): v for k, v in key.items()}, open('key_a.json', 'w'), indent=1)
    json.dump({str(k): v for k, v in notes.items()}, open('key_a_notes.json', 'w'), indent=1)
