#!/usr/bin/env python3
"""Mutation test for verify_ch12.py.

A verifier that reports "all clear" is worthless unless it can be shown to
complain when the bank is wrong. For every question type the verifier claims to
cover, this takes one real question of that type, deliberately points its answer
key at a different option, and insists the verifier notices.

A family that survives its mutation is a family the verifier is not really
checking.
"""
import io, json, sys, collections, contextlib, importlib

sys.path.insert(0, '/tmp/energytech_app')
import verify_ch12 as V

REAL = V.BANK
src = open(REAL, encoding='utf-8').read()
head = src[:src.index('{')]
tail = src[src.rindex('}') + 1:]
data = json.loads(src[src.index('{'):src.rindex('}') + 1])

TMP = '/tmp/mutant_bank.js'


def run(bank_path):
    """Return (returncode, list of problem lines)."""
    V.BANK = bank_path
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = V.main()
    V.BANK = REAL
    out = buf.getvalue()
    return rc, out


def classify():
    """Which matcher name handled each (setid, question number)."""
    s = open(REAL, encoding='utf-8').read()
    d = json.loads(s[s.index('{'):s.rindex('}') + 1])
    owner = {}
    for setid, st in d.items():
        for q in st['questions']:
            choices = V.split_choices(q['choices'])
            if len(choices) != 4:
                continue
            for name, fn in V.MATCHERS:
                try:
                    if fn is V.m_circuit_total:
                        v = fn(q['body'], choices, q)
                    elif fn is V.m_hand_read:
                        v = fn(q['body'], choices, q, setid)
                    else:
                        v = fn(q['body'], choices)
                except Exception:
                    v = None
                if v is not None:
                    owner[(setid, q['original_number'])] = name
                    break
    return owner


def write_mutant(setid, number, new_answer):
    d = json.loads(json.dumps(data))
    for q in d[setid]['questions']:
        if q['original_number'] == number:
            q['answer'] = new_answer
            break
    open(TMP, 'w', encoding='utf-8').write(
        head + json.dumps(d, ensure_ascii=False, indent=2) + tail)


def main():
    # the bank as shipped must be clean, or nothing below means anything
    rc, out = run(REAL)
    if rc != 0:
        print('BASELINE IS NOT CLEAN -- mutation testing is meaningless here')
        print(out)
        return 1
    print('baseline: clean\n')

    owner = classify()
    families = collections.defaultdict(list)
    for k, name in owner.items():
        families[name].append(k)

    # One question per family, except the hand-read diagrams: those are recorded
    # one by one from the pictures, so every entry gets its own mutation.
    targets = []
    for name in sorted(families):
        members = sorted(families[name])
        targets += members if name == 'diagram read by eye' else members[:1]

    caught, survived = [], []
    for setid, number in targets:
        name = owner[(setid, number)]
        q = next(x for x in data[setid]['questions'] if x['original_number'] == number)
        wrong = next(c for c in 'abcd' if c != q['answer'])
        write_mutant(setid, number, wrong)
        rc, out = run(TMP)
        tag = f'{setid} Q{number}'
        hit = rc != 0 and f'{setid} Q{number}:' in out
        (caught if hit else survived).append((name, tag))
        print(f'  {"caught " if hit else "SURVIVED"}  {name:38s} ({tag}: {q["answer"]} -> {wrong})')

    print()
    print(f'{len(caught)} of {len(caught) + len(survived)} mutations were caught (one per question type, plus every hand-read diagram).')
    if survived:
        print('\nNOT ACTUALLY CHECKED:')
        for name, tag in survived:
            print(f'  {name}  ({tag})')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
