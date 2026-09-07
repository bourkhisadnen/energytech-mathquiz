"""What a figure actually draws: its corners, its labels and where they sit.

The solvers must not key off macro names -- Version A calls a drawing
\\figTrapB and Version C calls the same kind of drawing \\figQEG -- so shapes are
recognised from the TikZ geometry and each printed dimension is attached to the
side it is written against.
"""
import re, math
from mkfig import SRC, preamble
from render_figs import macro_body
import dataset

COORD = re.compile(r'\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)')
NODE_AT = re.compile(
    r'\\node\s*(?:\[(?P<opt>[^\]]*)\])?\s*at\s*\(\s*(?P<x>-?\d*\.?\d+)\s*,\s*(?P<y>-?\d*\.?\d+)\s*\)\s*\{')
NODE_AT_NAMED = re.compile(
    r'\\node\s*(?:\[(?P<opt>[^\]]*)\])?\s*at\s*\(\s*(?P<name>[A-Za-z][A-Za-z0-9]*)\s*\)\s*\{')


def _body(rec):
    pre = preamble(SRC[dataset.VER[rec['version']]])
    return macro_body(pre, rec['figure'])


def _balanced(src, i):
    depth = 0
    for j in range(i, len(src)):
        if src[j] == '{' and src[j - 1] != '\\':
            depth += 1
        elif src[j] == '}' and src[j - 1] != '\\':
            depth -= 1
            if depth == 0:
                return src[i + 1:j], j
    return '', len(src)


def coordinates(body):
    """Named \\coordinate points, e.g. (A) at (4.0,0)."""
    out = {}
    for m in re.finditer(r'\\coordinate\s*\(\s*([A-Za-z][A-Za-z0-9]*)\s*\)\s*at\s*'
                         r'\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)', body):
        out[m.group(1)] = (float(m.group(2)), float(m.group(3)))
    return out


def labels_with_positions(rec):
    """[(text, (x, y))] for every node whose position can be resolved."""
    import figdata
    body = _body(rec)
    named = coordinates(body)
    out = []
    for m in NODE_AT.finditer(body):
        txt, _ = _balanced(body, m.end() - 1)
        out.append((figdata.clean(txt), (float(m.group('x')), float(m.group('y')))))
    for m in NODE_AT_NAMED.finditer(body):
        p = named.get(m.group('name'))
        if p is None:
            continue
        txt, _ = _balanced(body, m.end() - 1)
        out.append((figdata.clean(txt), p))
    return out


def polygon(rec, sides=None):
    """The corners of the drawn polygon, in path order.

    Handles both an explicit path and TikZ's `regular polygon` node; the
    regular-polygon case returns evenly spaced corners of the right count.
    """
    body = _body(rec)
    m = re.search(r'regular polygon sides\s*=\s*(\d+)', body)
    if m:
        k = int(m.group(1))
        return [(math.cos(2 * math.pi * i / k), math.sin(2 * math.pi * i / k)) for i in range(k)]
    named = coordinates(body)
    for cmd in (r'\\filldraw', r'\\draw'):
        for mm in re.finditer(cmd + r'[^;]*?;', body, re.S):
            seg = mm.group(0)
            # \filldraw (0,0) rectangle (4.2,2.6);
            r = re.search(r'\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)\s*rectangle\s*'
                          r'\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*\)', seg)
            if r and (sides is None or sides == 4):
                x0, y0, x1, y1 = map(float, r.groups())
                return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
            if 'cycle' not in seg:
                continue
            path = seg[:seg.index('cycle')]
            pts = []
            for tok in re.findall(r'\(\s*([^()]*?)\s*\)', path):
                m = re.fullmatch(r'(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)', tok)
                if m:
                    pts.append((float(m.group(1)), float(m.group(2))))
                elif tok in named:
                    pts.append(named[tok])
            if len(pts) >= 3 and (sides is None or len(pts) == sides):
                return pts
    return None


def sides_of(pts):
    """[(midpoint, length, (p, q))] for each edge of a closed polygon."""
    out = []
    for i in range(len(pts)):
        p, q = pts[i], pts[(i + 1) % len(pts)]
        mid = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
        out.append((mid, math.hypot(q[0] - p[0], q[1] - p[1]), (p, q)))
    return out


def dashed_segments(rec):
    """Midpoints of the dashed segments -- how these figures draw a height."""
    body = _body(rec)
    named = coordinates(body)
    out = []
    for m in re.finditer(r'\\draw\s*\[([^\]]*)\][^;]*?;', body, re.S):
        if 'gdash' not in m.group(1) and 'dash' not in m.group(1):
            continue
        pts = []
        for tok in re.findall(r'\(\s*([^()]*?)\s*\)', m.group(0)):
            mm = re.fullmatch(r'(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)', tok)
            if mm:
                pts.append((float(mm.group(1)), float(mm.group(2))))
            elif tok in named:
                pts.append(named[tok])
        for i in range(len(pts) - 1):
            p, q = pts[i], pts[i + 1]
            out.append(((p[0] + q[0]) / 2, (p[1] + q[1]) / 2))
    return out


def attach(rec, pts, max_dist=0.75):
    """Attach each printed dimension to the edge it is written against.

    Returns (on_edge, loose): on_edge is {edge index: value}; loose holds the
    values written against a dashed segment or away from every edge, which is
    how these drawings mark a height.
    """
    edges = sides_of(pts)
    dashes = dashed_segments(rec)
    on_edge, loose = {}, []
    for text, pos in labels_with_positions(rec):
        nums = [float(x.replace(',', '')) for x in
                re.findall(r'-?\d[\d,]*(?:\.\d+)?', text.replace('\\,', ''))]
        if len(nums) != 1 or re.search(r'\^\\circ|\^\{\\circ\}', text):
            continue
        v = nums[0]
        d_dash = min((math.hypot(pos[0] - m[0], pos[1] - m[1]) for m in dashes), default=1e9)
        best, bestd = None, 1e9
        for i, (mid, length, _) in enumerate(edges):
            d = math.hypot(pos[0] - mid[0], pos[1] - mid[1])
            if d < bestd:
                best, bestd = i, d
        if d_dash <= bestd and d_dash <= max_dist:
            loose.append(v)                      # written against the height line
        elif bestd <= max_dist and best not in on_edge:
            on_edge[best] = v
        else:
            loose.append(v)
    return on_edge, loose


def classify_quad(pts):
    """'square' | 'rectangle' | 'parallelogram' | 'trapezoid' from the corners."""
    if len(pts) != 4:
        return None
    v = [(pts[(i + 1) % 4][0] - pts[i][0], pts[(i + 1) % 4][1] - pts[i][1]) for i in range(4)]
    ln = [math.hypot(*x) for x in v]

    def par(a, b):
        return abs(a[0] * b[1] - a[1] * b[0]) < 1e-3 * max(1.0, ln[v.index(a)] * ln[v.index(b)])

    def parallel(i, j):
        return abs(v[i][0] * v[j][1] - v[i][1] * v[j][0]) < 0.02 * max(ln[i] * ln[j], 1e-6)

    def perp(i, j):
        return abs(v[i][0] * v[j][0] + v[i][1] * v[j][1]) < 0.02 * max(ln[i] * ln[j], 1e-6)

    both = parallel(0, 2) and parallel(1, 3)
    right = perp(0, 1)
    equal = abs(ln[0] - ln[1]) < 0.02 * max(ln[0], ln[1])
    if both and right and equal:
        return 'square'
    if both and right:
        return 'rectangle'
    if both:
        return 'parallelogram'
    if parallel(0, 2) or parallel(1, 3):
        return 'trapezoid'
    return None
