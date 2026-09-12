"""Write question_bank_ch04.js, the figure files and the video-link block.

Same shape as Chapter 12A's build_bank.py, with one simplification and one
extra step:
  - the explanation-video links are literal URLs already sitting in the .tex
    (\\qrcode[...]{URL}) rather than QR codes that need decoding off a
    rendered worksheet;
  - Version A ("Original PDF worksheet") gets no version_a-then-rename
    detour: it is keyed original_pdf and labeled "Original PDF worksheet"
    from the very first write, per the user's explicit instruction.
"""
import json, os, re, shutil, hashlib
import parse_ch04 as P
import solve_ch04 as S
from mkfig import SRC, preamble, fig_macros
from render_figs import macro_body

APP = '/tmp/energytech_app/energytech_quiz_app_session_sync_fixed'
FIGDIR = os.path.join(APP, 'figures_ch04')
UPLOAD = '/root/.claude/uploads/31b6d1fd-3b78-5915-86b3-6a23229c570d'
# Both instrument photographs are the SAME picture for every version -- unlike
# Chapter 12A's per-version palm tree photo, these are reference diagrams
# (a labelled caliper, a labelled micrometer), not randomized artwork.
STATIC_IMAGES = {
    'fig_caliper.png': ('ch04_caliper.png', f'{UPLOAD}/68beddca-image.png'),
    'fig_micrometer.png': ('ch04_micrometer.png', f'{UPLOAD}/9e87e2e5-image.png'),
}
SETS = {'A': 'original_pdf', 'B': 'version_b', 'C': 'version_c', 'D': 'version_d'}
LABELS = {'A': 'Original PDF worksheet', 'B': 'Version B', 'C': 'Version C', 'D': 'Version D'}

SCREEN_SCALE = 2.4   # same screen-legibility scale as Chapter 12A -- baked
                      # into copy_figures() from the start this time so a
                      # rebuild can never quietly drop it.


def to_app_latex(s):
    """The worksheet's LaTeX in the subset the app already renders."""
    s = re.sub(r'\\medskip\b', '', s)
    s = re.sub(r'\\smallskip\b', '', s)
    s = s.replace('\\ldots', '…')
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def build_a_key():
    all_data = P.parse_all()
    key = P.answer_key()
    S.build_part_map(all_data, key)
    texts = {v: open(P.SRC[v], encoding='utf-8').read() for v in P.VERS}
    a_key = {}
    for n in range(1, 51):
        rec = all_data['A'][n]
        fig_source = None
        if rec['fig'] and rec['fig'][0] == 'tikz':
            fig_source = P.macro_body(texts['A'], rec['fig'][1])
        got = S.solve(rec, n, fig_source)
        assert got is not None, ('A', n, 'unsolved -- refusing to ship a guess')
        a_key[n] = got.upper()
    return a_key


def figure_src(rec, usage, ver):
    if not rec['fig']:
        return None
    kind, name = rec['fig']
    if kind == 'image':
        return './images/%s' % STATIC_IMAGES[name][0]
    sha = usage[ver][name]
    return './figures_ch04/%s.svg' % sha


def build_bank():
    all_data = P.parse_all()
    key = P.answer_key()
    a_key = build_a_key()
    usage = json.load(open('/tmp/energytech_app/ch04new/fig_usage.json'))
    out = {}
    for ver, setid in SETS.items():
        questions = []
        for n in range(1, 51):
            r = all_data[ver][n]
            body = to_app_latex(r['body'])
            src = figure_src(r, usage, ver)
            if src:
                body = (body + '\\par[[DIAGRAM]]\\par').strip()
            answer = (a_key[n] if ver == 'A' else key[n][ver]).lower()
            q = {
                'original_number': n,
                'compact': False,
                'lesson': r['lesson'],
                'body': body,
                'choices': ' '.join('\\item ' + to_app_latex(c) for c in r['choices']),
                'answer': answer,
            }
            if src:
                q['diagram'] = {'type': 'image', 'src': src}
            questions.append(q)
        out[setid] = {'label': LABELS[ver], 'questions': questions}
    return out


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
    usage = json.load(open('/tmp/energytech_app/ch04new/fig_usage.json'))
    used = {sha for v in usage for sha in usage[v].values()}
    for sha in sorted(used):
        svg = open(f'/tmp/energytech_app/ch04new/figsvg/{sha}.svg', encoding='utf-8').read()
        open(os.path.join(FIGDIR, sha + '.svg'), 'w', encoding='utf-8').write(
            scale_svg_for_screen(svg))
        # Worksheet export needs a pdflatex-readable PDF twin of every figure
        # alongside the browser's SVG -- kept in the same step so a rebuild
        # can never wipe one and leave the other stale (Chapter 12A's bug).
        shutil.copy(f'/tmp/energytech_app/ch04new/figpdf/{sha}.pdf',
                    os.path.join(FIGDIR, sha + '.pdf'))
    os.makedirs(os.path.join(APP, 'images'), exist_ok=True)
    for _, (dest_name, src_path) in STATIC_IMAGES.items():
        shutil.copy(src_path, os.path.join(APP, 'images', dest_name))
    return len(used)


def video_links():
    texts = {v: open(P.SRC[v], encoding='utf-8').read() for v in P.VERS}
    links = {}
    for v in P.VERS:
        blocks = re.findall(
            r'\\begin\{Qbox\}\{(\d+)\}.*?qrcode\[height=2\.2cm,hyperlink\]\{([^}]*)\}',
            texts[v], re.S)
        assert len(blocks) == 50, (v, len(blocks))
        for n, url in blocks:
            links.setdefault(int(n), {})[v] = url
    out = {}
    for n in range(1, 51):
        seen = set(links[n].values())
        assert len(seen) == 1, f'Q{n} has different videos per version: {seen}'
        out[str(n)] = seen.pop()
    return out


if __name__ == '__main__':
    bank = build_bank()
    nfig = copy_figures()
    links = video_links()

    header = (
        '// EnergyTech Chapter 04 question banks.\n'
        '// Measurement: significant figures, precision, greatest possible error,\n'
        '// vernier caliper and micrometer reading, accuracy comparison, and\n'
        '// significant-figure arithmetic. Four parallel versions of 50 questions.\n'
        '//\n'
        "// Versions B, C and D carry the worksheet's own answer key. Version A is\n"
        '// the teacher-supplied original ("Original PDF worksheet") and came with\n'
        '// no key of its own; every one of its answers was re-derived from the\n'
        '// question and its figure by tools/check_ch04.py and scalereader.py,\n'
        '// which reproduce the supplied key for all 150 questions of B, C and D\n'
        '// before ever being trusted on A.\n'
        '//\n'
        '// Two typos in the teacher-supplied .tex files were corrected at source\n'
        '// (2026-09-09), so they are no longer carried here: Q4\'s lesson code read\n'
        '// "1-1.1" instead of "4-1.1" in all four versions, and Version A\'s Q45\n'
        '// listed the same decoy twice (options A and C both "$206{,}700$"). The\n'
        "// duplicate is now $200{,}000$ cm$^2$, the 1-significant-figure value --\n"
        '// the member of the 1sf/2sf/3sf/raw set that B, C and D all carry and A\n'
        '// was missing. No answer changed: the key is still option B.\n'
        'window.QUESTION_BANK_SETS_CH04 = ')
    open(os.path.join(APP, 'question_bank_ch04.js'), 'w').write(
        header + json.dumps(bank, indent=2, ensure_ascii=False) + ';\n')

    print('question_bank_ch04.js written: 4 versions x 50 questions')
    print(f'{nfig} figure files in figures_ch04/, 2 shared reference photos in images/')
    print(f'{len(links)} explanation-video links')
    json.dump(links, open('/tmp/energytech_app/ch04new/links_ch04.json', 'w'), indent=1)
