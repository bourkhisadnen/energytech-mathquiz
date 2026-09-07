import re, json, sys

SRC = {
 'A': '/root/.claude/uploads/31b6d1fd-3b78-5915-86b3-6a23229c570d/b3cf3f1e-Ch12A_questions.tex',
 'B': '/root/.claude/uploads/31b6d1fd-3b78-5915-86b3-6a23229c570d/8c1d69db-Ch12B_questions.tex',
 'C': '/root/.claude/uploads/31b6d1fd-3b78-5915-86b3-6a23229c570d/9dc181d8-Ch12C_questions.tex',
 'D': '/root/.claude/uploads/31b6d1fd-3b78-5915-86b3-6a23229c570d/e1b85db4-Ch12D_questions.tex',
}

QBOX = re.compile(r'\\begin\{Qbox\}\{(\d+)\}\{([^}]*)\}(.*?)\\end\{Qbox\}', re.S)

def split_items(block):
    """The \item list inside a choices environment, as raw LaTeX strings."""
    m = re.search(r'\\begin\{choices\}(.*?)\\end\{choices\}', block, re.S)
    if not m: return None
    body = m.group(1)
    parts = re.split(r'\\item\s', body)
    return [p.strip() for p in parts[1:]]

def parse(path):
    txt = open(path, encoding='utf-8').read()
    # cut the preamble so \newenvironment examples are not matched
    txt = txt[txt.index('\\begin{document}'):]
    out = {}
    for num, lesson, block in QBOX.findall(txt):
        items = split_items(block)
        stem = block[:block.index('\\begin{choices}')] if '\\begin{choices}' in block else block
        fig = re.search(r'\\figbox\{\\([A-Za-z]+)\}', block)
        inc = re.search(r'\\incfig\{[^}]*\}\{([^}]*)\}', block)
        qr  = re.search(r'\\qrcode\[[^\]]*\]\{([^}]*)\}', block)
        # the stem with figure/qr commands stripped
        body = re.sub(r'\\figbox\{\\[A-Za-z]+\}', '', stem)
        body = re.sub(r'\\incfig\{[^}]*\}\{[^}]*\}', '', body)
        body = re.sub(r'\\noqr', '', body).strip()
        out[int(num)] = dict(lesson=lesson, body=body, choices=items,
                             figure=fig.group(1) if fig else None,
                             photo=inc.group(1) if inc else None,
                             video=qr.group(1) if qr else '')
    return out

banks = {v: parse(p) for v, p in SRC.items()}
for v, b in banks.items():
    bad = [n for n, q in b.items() if not q['choices'] or len(q['choices']) != 4]
    print(f"{v}: {len(b)} questions, {len(bad)} without exactly 4 choices {bad[:5]}")

json.dump({v: {str(k): q for k, q in b.items()} for v, b in banks.items()},
          open('parsed.json', 'w'), indent=1, ensure_ascii=False)
print('wrote parsed.json')
