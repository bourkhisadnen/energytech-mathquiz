"""Parse the four Chapter 04 .tex files into structured question records."""
import re

VERS = ['A', 'B', 'C', 'D']
SRC = {v: f'/tmp/energytech_app/ch04new/Ch04{v}_questions.tex' for v in VERS}


def parse_version(v):
    text = open(SRC[v], encoding='utf-8').read()
    blocks = re.findall(r'\\begin\{Qbox\}\{(\d+)\}\{([^}]*)\}(.*?)\\end\{Qbox\}', text, re.S)
    out = {}
    for n, lesson, body in blocks:
        n = int(n)
        choices = re.findall(r'\\item\s+(.*)', body)
        assert len(choices) == 4, (v, n, choices)
        fig = None
        m = re.search(r'\\figbox\{\\(fig\w+)\}', body)
        if m:
            fig = ('tikz', m.group(1))
        else:
            m = re.search(r'\\incfig\{[\d.]+\}\{([\w.]+)\}', body)
            if m:
                fig = ('image', m.group(1))
        # question text = everything before the first \begin{choices} / \incfig / \figbox
        qtext = re.split(r'\\begin\{choices\}|\\incfig|\\figbox', body)[0].strip()
        out[n] = {'lesson': lesson.strip(), 'body': qtext, 'choices': choices, 'fig': fig}
    assert len(out) == 50, (v, len(out))
    return out


def parse_all():
    return {v: parse_version(v) for v in VERS}


def answer_key():
    text = open('/tmp/energytech_app/ch04new/Ch04_answer_key.tex', encoding='utf-8').read()
    rows = re.findall(r'^(\d+) & ([A-D]) & ([A-D]) & ([A-D]) \\\\', text, re.M)
    key = {}
    for n, b, c, d in rows:
        key[int(n)] = {'B': b, 'C': c, 'D': d}
    assert len(key) == 50, len(key)
    return key


def macro_body(text, name):
    m = re.search(r'\\newcommand\{\\' + re.escape(name) + r'\}\{%(.*?)\n\}\n', text, re.S)
    assert m, name
    return m.group(1)


if __name__ == '__main__':
    data = parse_all()
    key = answer_key()
    print('parsed', {v: len(data[v]) for v in VERS}, 'key', len(key))
