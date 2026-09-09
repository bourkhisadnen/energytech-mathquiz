import re, os, subprocess, hashlib, json, shutil
from mkfig import SRC, preamble, fig_macros

OUT = '/tmp/energytech_app/ch04new/figsvg'
WORK = '/tmp/energytech_app/ch04new/figwork'
os.makedirs(OUT, exist_ok=True); shutil.rmtree(WORK, ignore_errors=True); os.makedirs(WORK)


def macro_body(pre, name):
    """The balanced-brace body of \\newcommand{\\name}{...}."""
    m = re.search(r'\\newcommand\{\\' + name + r'\}\{', pre)
    i = m.end() - 1
    depth = 0
    for j in range(i, len(pre)):
        if pre[j] == '{' and pre[j - 1] != '\\':
            depth += 1
        elif pre[j] == '}' and pre[j - 1] != '\\':
            depth -= 1
            if depth == 0:
                return pre[i + 1:j]
    raise ValueError(name)


if __name__ == '__main__':
    bodies = {}          # sha -> body
    usage = {}           # version -> {macro name: sha}
    for v, path in SRC.items():
        pre = preamble(path)
        usage[v] = {}
        for name in fig_macros(pre):
            b = macro_body(pre, name)
            sha = hashlib.sha1(re.sub(r'\s+', ' ', b).strip().encode()).hexdigest()[:12]
            bodies.setdefault(sha, b)
            usage[v][name] = sha

    print(f'{sum(len(u) for u in usage.values())} definitions -> {len(bodies)} distinct figures')

    for v, path in SRC.items():
        pre = preamble(path)
        mine = [(n, s) for n, s in usage[v].items() if not os.path.exists(f'{OUT}/{s}.svg')]
        mine = list({s: n for n, s in mine}.items())
        mine = [(n, s) for s, n in mine]
        if not mine:
            continue
        doc = pre.replace('\\documentclass[11pt]{article}',
                           '\\documentclass[11pt]{article}\n\\usepackage[active,tightpage]{preview}')
        doc += '\n\\PreviewEnvironment{tikzpicture}\n\\begin{document}\n'
        for n, s in mine:
            doc += '\\%s\n' % n
        doc += '\\end{document}\n'
        tex = f'{WORK}/{v}.tex'
        open(tex, 'w', encoding='utf-8').write(doc)
        r = subprocess.run(['pdflatex', '-interaction=nonstopmode', '-halt-on-error',
                             f'-output-directory={WORK}', tex],
                            capture_output=True, text=True)
        pdf = f'{WORK}/{v}.pdf'
        if not os.path.exists(pdf):
            print(f'{v}: COMPILE FAILED'); print(r.stdout[-2500:]); continue
        pages = int(subprocess.run(['pdfinfo', pdf], capture_output=True, text=True)
                    .stdout.split('Pages:')[1].split()[0])
        print(f'{v}: {len(mine)} figures asked, {pages} pages produced')
        if pages != len(mine):
            print('   !! page count does not match figure count -- refusing to map blindly')
            continue
        for i, (n, s) in enumerate(mine, start=1):
            subprocess.run(['pdftocairo', '-svg', '-f', str(i), '-l', str(i), pdf, f'{OUT}/{s}.svg'],
                            check=True)

    json.dump(usage, open('/tmp/energytech_app/ch04new/fig_usage.json', 'w'), indent=1)
    print('svg files:', len(os.listdir(OUT)))
