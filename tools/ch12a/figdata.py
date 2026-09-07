"""Numeric labels carried by each figure, read from its TikZ source.

The dimensions these questions need are printed in the drawing, not in the
sentence, so a solver has to read them off the picture. Every label in these
files is a TikZ node, so the node text is the picture's data.
"""
import re, json
from mkfig import SRC, preamble, fig_macros
from render_figs import macro_body

NODE = re.compile(r'\\node\s*(?:\[[^\]]*\])?\s*(?:at\s*\([^()]*\)\s*)?\{')


def nodes(body):
    """Text of every \\node in the picture, in source order."""
    out = []
    for m in NODE.finditer(body):
        i = m.end() - 1
        depth = 0
        for j in range(i, len(body)):
            if body[j] == '{' and body[j - 1] != '\\':
                depth += 1
            elif body[j] == '}' and body[j - 1] != '\\':
                depth -= 1
                if depth == 0:
                    out.append(body[i + 1:j])
                    break
    return out


NUM = re.compile(r'-?\d+(?:\.\d+)?')


def clean(label):
    """A node's text with LaTeX spacing and sizing noise removed."""
    s = label
    s = re.sub(r'\\[,;:!]', ' ', s)
    s = re.sub(r'\\(?:footnotesize|scriptsize|small|tiny|glab|gsml)\b', ' ', s)
    s = s.replace('$', '')
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def numbers(labels):
    """Every number in the labels, as floats, in source order."""
    out = []
    for L in labels:
        for m in NUM.finditer(L.replace(',', '')):
            out.append(float(m.group()))
    return out


def build():
    data = {}
    for v, path in SRC.items():
        pre = preamble(path)
        data[v] = {}
        for name in fig_macros(pre):
            labels = [clean(x) for x in nodes(macro_body(pre, name))]
            data[v][name] = {'labels': labels, 'numbers': numbers(labels)}
    return data


if __name__ == '__main__':
    data = build()
    json.dump(data, open('figdata.json', 'w'), indent=1, ensure_ascii=False)
    a = data['version_a']
    for n in ['figParaA', 'figTrapA', 'figSquareA', 'figRectA', 'figTrapB',
              'figParaB', 'figTriObt', 'figSteelPlate', 'figTriIsoFD']:
        print(f"{n:16s} {a[n]['labels']}")
