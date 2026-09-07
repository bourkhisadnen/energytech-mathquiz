"""One record per question per version: what the sentence says, what the picture
says, and which drawing it is (by content hash, so a per-version macro name
cannot disguise the same or a different picture)."""
import json, re, hashlib
from mkfig import SRC, preamble, fig_macros
from render_figs import macro_body
import figdata

VER = {'A': 'version_a', 'B': 'version_b', 'C': 'version_c', 'D': 'version_d'}

_parsed = json.load(open('/tmp/energytech_app/ch12new/parsed.json'))
_figs = figdata.build()

_sha = {}
for v, path in SRC.items():
    pre = preamble(path)
    _sha[v] = {}
    for name in fig_macros(pre):
        b = macro_body(pre, name)
        _sha[v][name] = hashlib.sha1(re.sub(r'\s+', ' ', b).strip().encode()).hexdigest()[:12]


def norm(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def build():
    out = {}
    for V in 'ABCD':
        vk = VER[V]
        out[V] = {}
        for n in range(1, 83):
            q = _parsed[V][str(n)]
            fig = q['figure']
            rec = dict(n=n, version=V, lesson=q['lesson'], body=norm(q['body']),
                       choices=[norm(c) for c in q['choices']],
                       figure=fig, photo=q['photo'], video=q['video'],
                       sha=(_sha[vk][fig] if fig else ('photo:' + q['photo'] if q['photo'] else None)),
                       labels=(_figs[vk][fig]['labels'] if fig else []),
                       numbers=(_figs[vk][fig]['numbers'] if fig else []))
            out[V][n] = rec
    return out


def answer_key():
    """{n: {'B': 'b', ...}} from the uploaded Ch12_answer_key.tex."""
    txt = open('/root/.claude/uploads/31b6d1fd-3b78-5915-86b3-6a23229c570d/'
               '5e6c7048-Ch12_answer_key.tex').read()
    out = {}
    for line in txt.splitlines():
        m = re.match(r'\s*(\d+)\s*&\s*([A-D])\s*&\s*([A-D])\s*&\s*([A-D])\s*\\\\', line)
        if m:
            out[int(m.group(1))] = {'B': m.group(2).lower(),
                                    'C': m.group(3).lower(),
                                    'D': m.group(4).lower()}
    return out


if __name__ == '__main__':
    D = build()
    K = answer_key()
    print('questions:', {v: len(D[v]) for v in D}, ' key rows:', len(K))
    # how many distinct drawings does each question number use across versions?
    same = sum(1 for n in range(1, 83) if len({D[v][n]['sha'] for v in 'ABCD'}) == 1)
    print(f'{same} of 82 question numbers use the identical drawing in all four versions')
