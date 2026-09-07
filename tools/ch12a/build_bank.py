"""Write question_bank_ch12a.js, the figure files and the video-link block.

The LaTeX that the worksheet compiles is not what the app renders, so the few
commands this chapter uses that the app has never seen are turned into the plain
characters they stand for here, at build time, rather than by teaching the
renderer four more special cases.
"""
import json, os, re, shutil, hashlib
import dataset
import key_a
import verify_ch12a as V

APP = '/tmp/energytech_app/energytech_quiz_app_session_sync_fixed'
FIGDIR = os.path.join(APP, 'figures_ch12a')
UPLOAD = '/root/.claude/uploads/31b6d1fd-3b78-5915-86b3-6a23229c570d'
PHOTOS = {                                   # the palm-tree picture, one per version
    'original_pdf': ('fig_q76.png', f'{UPLOAD}/ea12069b-image.png'),
    'version_b': ('fig_q76_B.png', f'{UPLOAD}/0166ef8c-image.png'),
    'version_c': ('fig_q76_C.png', f'{UPLOAD}/485123bd-image.png'),
    'version_d': ('fig_q76_D.png', f'{UPLOAD}/f4762f10-image.png'),
}
# 'A' is the original worksheet exactly as the teacher supplied it, so it is
# keyed and labeled the same way Chapters 01&02 and 03 key/label theirs
# ("original_pdf" / "Original PDF worksheet"), not as a fourth parallel
# version. This also puts it first in app.js's SET_ORDER, which lists
# original_pdf before version_b/c/d.
SETS = {'A': 'original_pdf', 'B': 'version_b', 'C': 'version_c', 'D': 'version_d'}
LABELS = {'A': 'Original PDF worksheet', 'B': 'Version B', 'C': 'Version C', 'D': 'Version D'}


def to_app_latex(s):
    """The worksheet's LaTeX in the subset the app already renders."""
    s = re.sub(r'\\rule\{[^{}]*\}\{[^{}]*\}', r'\\hspace{1.2cm}', s)
    s = re.sub(r'\\ang\{([^{}]*)\}', r'∠\1', s)
    s = s.replace('\\dg', '°')
    s = s.replace('\\parallel', ' ∥ ')
    s = s.replace('\\ldots', '…')
    s = re.sub(r'\\(?:noindent|normalsize|small|footnotesize)\b\s*', '', s)
    s = re.sub(r'\\tfrac\{([^{}]*)\}\{([^{}]*)\}', r'\\frac{\1}{\2}', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def figure_src(rec):
    if rec['photo']:
        return './images/ch12a_q%d_%s.png' % (rec['n'], rec['version'].lower())
    if rec['sha']:
        return './figures_ch12a/%s.svg' % rec['sha']
    return None


def build_bank():
    D = dataset.build()
    KEY = dataset.answer_key()
    A_KEY, A_NOTES, trouble = key_a.build()
    assert not trouble, trouble
    out = {}
    for V_, setid in SETS.items():
        questions = []
        for n in range(1, 83):
            r = D[V_][n]
            body = to_app_latex(r['body'])
            src = figure_src(r)
            if src:
                body = (body + '\\par[[DIAGRAM]]\\par').strip()
            q = {
                'original_number': n,
                'compact': False,
                'lesson': r['lesson'],
                'body': body,
                'choices': ' '.join('\\item ' + to_app_latex(c) for c in r['choices']),
                'answer': A_KEY[n] if V_ == 'A' else KEY[n][V_],
            }
            if src:
                q['diagram'] = {'type': 'image', 'src': src}
            questions.append(q)
        out[setid] = {'label': LABELS[V_], 'questions': questions}
    return out


SCREEN_SCALE = 2.4   # pdftocairo sizes the SVG in PDF points (~1x); the app
                      # scales the presentation width/height up so the drawing
                      # is legible on screen. The viewBox is left untouched --
                      # only the outer <svg width=.. height=..> changes.


def scale_svg_for_screen(svg_text):
    def repl(m):
        return '%s="%.1f"' % (m.group(1), float(m.group(2)) * SCREEN_SCALE)
    svg_text, n = re.subn(r'\b(width|height)="([\d.]+)"', repl, svg_text, count=2)
    assert n == 2, 'expected exactly one width= and one height= on the <svg> tag'
    return svg_text


def copy_figures():
    os.makedirs(FIGDIR, exist_ok=True)
    for f in os.listdir(FIGDIR):
        os.remove(os.path.join(FIGDIR, f))
    D = dataset.build()
    used = {D[v][n]['sha'] for v in 'ABCD' for n in range(1, 83)
            if D[v][n]['figure']}
    for sha in sorted(used):
        svg = open(f'/tmp/energytech_app/ch12new/figsvg/{sha}.svg', encoding='utf-8').read()
        open(os.path.join(FIGDIR, sha + '.svg'), 'w', encoding='utf-8').write(
            scale_svg_for_screen(svg))
        # The worksheet export needs a pdflatex-readable twin of every figure
        # (see render_pdfs.py) alongside the browser's SVG. Keep both in sync
        # here so a rebuild can never wipe one and leave the other stale.
        shutil.copy(f'/tmp/energytech_app/ch12new/figpdf/{sha}.pdf',
                    os.path.join(FIGDIR, sha + '.pdf'))
    for V_, setid in SETS.items():
        _, srcpath = PHOTOS[setid]
        shutil.copy(srcpath, os.path.join(APP, 'images', f'ch12a_q76_{V_.lower()}.png'))
    return len(used)


def video_links():
    D = dataset.build()
    links = {}
    for n in range(1, 83):
        seen = {D[v][n]['video'] for v in 'ABCD' if D[v][n]['video']}
        assert len(seen) <= 1, f'Q{n} has different videos per version: {seen}'
        if seen:
            links[str(n)] = seen.pop()
    return links


if __name__ == '__main__':
    bank = build_bank()
    nfig = copy_figures()
    links = video_links()

    header = (
        '// EnergyTech Chapter 12A question banks.\n'
        '// Geometry: angles, polygons, area and perimeter, right triangles and\n'
        '// similar figures. Four parallel versions of 82 questions.\n'
        '//\n'
        "// Versions B, C and D carry the worksheet's own answer key. Version A's\n"
        '// key was not supplied with it; every one of its answers was re-derived\n'
        "// from the question and its drawing by tools/verify_ch12a.py, which\n"
        '// reproduces the supplied key for all 246 questions of B, C and D.\n'
        'window.QUESTION_BANK_SETS_CH12A = ')
    open(os.path.join(APP, 'question_bank_ch12a.js'), 'w').write(
        header + json.dumps(bank, indent=2, ensure_ascii=False) + ';\n')

    print(f'question_bank_ch12a.js written: 4 versions x 82 questions')
    print(f'{nfig} figure files in figures_ch12a/, 4 photographs in images/')
    print(f'{len(links)} explanation-video links')
    json.dump(links, open('/tmp/energytech_app/ch12new/links_ch12a.json', 'w'), indent=1)
