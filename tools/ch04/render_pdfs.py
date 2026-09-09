"""A PDF twin of every figure, for the worksheet export -- same rationale as
Chapter 12A's render_pdfs.py: the app shows SVG, but pdflatex needs a PDF, so
both come from the same compile rather than a second, possibly-divergent
render.
"""
import os, re, shutil, subprocess, hashlib
from mkfig import SRC, preamble, fig_macros
from render_figs import macro_body

OUT = '/tmp/energytech_app/ch04new/figpdf'
WORK = '/tmp/energytech_app/ch04new/figwork_pdf'
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
shutil.rmtree(WORK, ignore_errors=True); os.makedirs(WORK)

bodies, usage = {}, {}
for v, path in SRC.items():
    pre = preamble(path)
    usage[v] = {}
    for name in fig_macros(pre):
        b = macro_body(pre, name)
        sha = hashlib.sha1(re.sub(r'\s+', ' ', b).strip().encode()).hexdigest()[:12]
        bodies.setdefault(sha, b)
        usage[v][name] = sha

done = set()
for v, path in SRC.items():
    pre = preamble(path)
    mine = []
    for name, sha in usage[v].items():
        if sha in done:
            continue
        done.add(sha)
        mine.append((name, sha))
    if not mine:
        continue
    doc = pre.replace('\\documentclass[11pt]{article}',
                       '\\documentclass[11pt]{article}\n\\usepackage[active,tightpage]{preview}')
    doc += '\n\\PreviewEnvironment{tikzpicture}\n\\begin{document}\n'
    doc += ''.join('\\%s\n' % n for n, _ in mine)
    doc += '\\end{document}\n'
    tex = f'{WORK}/{v}.tex'
    open(tex, 'w', encoding='utf-8').write(doc)
    subprocess.run(['pdflatex', '-interaction=nonstopmode', '-halt-on-error',
                     f'-output-directory={WORK}', tex], capture_output=True, text=True)
    pdf = f'{WORK}/{v}.pdf'
    pages = int(subprocess.run(['pdfinfo', pdf], capture_output=True, text=True)
                .stdout.split('Pages:')[1].split()[0])
    assert pages == len(mine), (v, pages, len(mine))
    for i, (name, sha) in enumerate(mine, start=1):
        subprocess.run(['qpdf', pdf, '--pages', pdf, f'{i}-{i}', '--', f'{OUT}/{sha}.pdf'],
                        check=True)

print(len(os.listdir(OUT)), 'figure PDFs')
print('total size:', sum(os.path.getsize(f'{OUT}/{f}') for f in os.listdir(OUT)) // 1024, 'KB')
