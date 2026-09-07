"""Chapter 12A -- re-derive every answer from the question itself.

Why this exists: the uploaded answer key has columns for versions B, C and D
only. Version A has none. So the answers are computed here from the sentence and
from the numbers printed in the drawing, and the method is then *proved* on the
three versions that do have a key: 246 questions whose answers were written by
somebody else. A family of questions is only trusted for Version A once its
solver reproduces the official key for that family on B, C and D.

The drawings matter as much as the sentences -- most of these questions print
their dimensions in the picture and not in the text -- so `figdata.py` reads the
TikZ node labels and this module treats them as the question's data.

Nothing here ever reads Version A's answers, because there are none to read.
"""
import re, math, json
import dataset, geom

D = dataset.build()
KEY = dataset.answer_key()
LETTERS = 'abcd'

# --------------------------------------------------------------------------
# reading numbers out of options and stems
# --------------------------------------------------------------------------
NUM = re.compile(r'-?\d[\d,]*(?:\.\d+)?')


def numbers_in(text):
    out = []
    for m in NUM.finditer(text.replace('\\,', '')):
        try:
            out.append(float(m.group().replace(',', '')))
        except ValueError:
            pass
    return out


def stem_numbers(rec):
    """Numbers in the sentence, with the question's own lesson code removed."""
    s = rec['body']
    s = re.sub(r'\\ang\{\d+\}', ' ', s)          # "angle 3" is a name, not a value
    s = re.sub(r'angles?\s+\d+(\s+and\s+\d+)?', ' ', s, flags=re.I)
    return numbers_in(s)


def fig_numbers(rec):
    return list(rec['numbers'])


def close(a, b, rel=0.02, abs_=0.06):
    return abs(a - b) <= max(abs_, rel * max(abs(a), abs(b)))


# --------------------------------------------------------------------------
# choosing the option that carries the computed answer
# --------------------------------------------------------------------------
def pick_number(rec, want, rel=0.02):
    """The single option whose numbers contain `want`.

    Tried tightest-first. These papers put the near miss on the sheet on purpose
    -- 31.0 beside 31.3, 130 beside 132 -- so a tolerance wide enough to admit
    the rounding of the right answer also admits the decoy. Starting tight and
    widening only while nothing matches keeps the two apart, and a tolerance
    that matches two options at once is reported as no answer, never guessed.
    """
    for tol in (1e-9, 5e-4, 2e-3, 6e-3, 0.012, rel):
        if tol > rel and tol != rel:
            continue
        hits = [i for i, c in enumerate(rec['choices'])
                if any(close(v, want, tol, abs_=tol * max(1.0, abs(want))) for v in numbers_in(c))]
        if len(hits) == 1:
            return LETTERS[hits[0]]
        if len(hits) > 1:
            return None
    return None


def pick_numbers(rec, wants, rel=0.02):
    """For answers that name several values, e.g. 'DE = 15, AE = 25'."""
    hits = []
    for i, c in enumerate(rec['choices']):
        got = numbers_in(c)
        if len(got) < len(wants):
            continue
        if all(any(close(g, w, rel) for g in got) for w in wants):
            hits.append(i)
    return LETTERS[hits[0]] if len(hits) == 1 else None


def pick_word(rec, word):
    """The single option naming `word` (a whole word, case-insensitive)."""
    pat = re.compile(r'\b' + re.escape(word) + r'\b', re.I)
    hits = [i for i, c in enumerate(rec['choices']) if pat.search(c)]
    return LETTERS[hits[0]] if len(hits) == 1 else None


NAMED = re.compile(r'([A-Za-z]{1,10})\s*\$?\s*=\s*\$?\s*(-?\d[\d,]*(?:\.\d+)?)')


def pick_named(rec, wants):
    """For options that name each value: 'DE = 15, AE = 25'.

    Matching by name and not by position matters: 'DE = 25, AE = 15' carries the
    same two numbers as the right answer and is on the paper precisely to catch
    a reader who does not check which is which.
    """
    keys = {k.lower(): v for k, v in wants.items()}
    hits = []
    for i, c in enumerate(rec['choices']):
        got = {m.group(1).lower(): float(m.group(2).replace(',', ''))
               for m in NAMED.finditer(c.replace('\\,', ''))}
        if set(keys) <= set(got) and all(close(got[k], v) for k, v in keys.items()):
            hits.append(i)
    return LETTERS[hits[0]] if len(hits) == 1 else None


# --------------------------------------------------------------------------
# the drawings that are read as pictures rather than as numbers
# --------------------------------------------------------------------------
ANGLE_CLASS = {'figAngRight': 'Right', 'figAngStraight': 'Straight',
               'figAngObtuse': 'Obtuse', 'figAngAcute': 'Acute'}

# A drawing is identified by the hash of its TikZ source, so the same picture is
# recognised in a version that gave it a different macro name.
SHA_ANGLE, SHA_SIDES, SHA_VERTS = {}, {}, {}
for _v in 'ABCD':
    for _n in range(1, 83):
        _r = D[_v][_n]
        if _r['figure'] in ANGLE_CLASS:
            SHA_ANGLE[_r['sha']] = ANGLE_CLASS[_r['figure']]


def polygon_vertices(rec):
    """How many corners the drawn polygon has."""
    pts = geom.polygon(rec)
    return len(pts) if pts else None


POLY_NAME = {3: 'Triangle', 4: 'Quadrilateral', 5: 'Pentagon', 6: 'Hexagon',
             7: 'Heptagon', 8: 'Octagon', 9: 'Nonagon', 10: 'Decagon'}


def triangle_shape(rec):
    """Corner coordinates of the drawn triangle."""
    pts = geom.polygon(rec, sides=3)
    return pts if pts and len(pts) == 3 else None


def angles_of(pts):
    def ang(a, b, c):
        v1 = (b[0] - a[0], b[1] - a[1])
        v2 = (c[0] - a[0], c[1] - a[1])
        d = (v1[0] * v2[0] + v1[1] * v2[1]) / (math.hypot(*v1) * math.hypot(*v2))
        return math.degrees(math.acos(max(-1, min(1, d))))
    a, b, c = pts
    return [ang(a, b, c), ang(b, a, c), ang(c, a, b)]


def classify_by_angles(angs):
    if any(a > 90.5 for a in angs):
        return 'Obtuse'
    if any(abs(a - 90) <= 0.5 for a in angs):
        return 'Right'
    return 'Acute'


# --------------------------------------------------------------------------
# the solvers, one per question number (the paper's shape is the same in all
# four versions -- asserted in check() below)
# --------------------------------------------------------------------------
def heron(a, b, c):
    s = (a + b + c) / 2
    return math.sqrt(max(0.0, s * (s - a) * (s - b) * (s - c)))


def solve(rec):
    n, F, S = rec['n'], fig_numbers(rec), stem_numbers(rec)

    # -- 1-4: name the drawn angle ----------------------------------------
    if n <= 4:
        cls = SHA_ANGLE.get(rec['sha'])
        return pick_word(rec, cls + ' angle') if cls else None

    # -- 5, 6: complementary / supplementary -------------------------------
    if n == 5:
        return pick_number(rec, 90 - S[0]) if S else None
    if n == 6:
        return pick_number(rec, 180 - S[0]) if S else None

    # -- 7: two transversals; angles 7 and 8 are a linear pair -------------
    if n == 7:
        return pick_number(rec, 180 - S[1]) if len(S) >= 2 else None

    # -- 8-16: l parallel to m cut by t ------------------------------------
    #    Reading the drawing: 1 and 2 are equal, 3 and 4 are equal, and either
    #    of the first pair is supplementary to either of the second.
    if 8 <= n <= 16:
        return solve_parallel(rec)

    # -- 17-23: name the drawn polygon -------------------------------------
    if 17 <= n <= 23:
        v = polygon_vertices(rec)
        return pick_word(rec, POLY_NAME[v]) if v in POLY_NAME else None

    # -- 24-29: quadrilateral definitions ----------------------------------
    if 24 <= n <= 29:
        b = rec['body'].lower()
        four_right = 'four right angles' in b
        four_equal = 'four equal sides' in b
        if 'parallelogram' in b and four_right and four_equal:
            return pick_word(rec, 'Square')
        if 'rectangle' in b and four_equal:
            return pick_word(rec, 'Square')
        if 'parallelogram' in b and four_right:
            return pick_word(rec, 'Rectangle')
        if 'parallelogram' in b and four_equal:
            return pick_word(rec, 'Rhombus')
        if 'only two sides parallel' in b:
            return pick_word(rec, 'Trapezoid')
        if 'all opposite sides parallel' in b:
            return pick_word(rec, 'Parallelogram')
        return None

    # -- 30-40: area and perimeter of the drawn quadrilateral --------------
    if 30 <= n <= 40:
        return solve_quad(rec)

    # -- 41: the corner counter -- an isosceles right triangle -------------
    if n == 41:
        return pick_number(rec, F[0] ** 2 / 4) if F else None

    # -- 42: centre-to-centre distance between two holes -------------------
    if n == 42:
        return pick_number(rec, math.hypot(F[0], F[1])) if len(F) >= 2 else None

    # -- 43: area of the obtuse triangle, from its base and drawn height ---
    if n == 43:
        return solve_tri_area_bh(rec)

    # -- 44: the punched triangular hole -----------------------------------
    if n == 44:
        return solve_plate_hole(rec)

    # -- 45-57: what kind of triangle --------------------------------------
    if 45 <= n <= 57:
        return solve_tri_kind(rec)

    # -- 58-62: Pythagoras --------------------------------------------------
    if 58 <= n <= 62:
        return solve_pythagoras(rec)

    # -- 63-66: area of a triangle -----------------------------------------
    if 63 <= n <= 66:
        return solve_tri_area(rec)

    # -- 67-71: angles in a triangle ---------------------------------------
    if 67 <= n <= 71:
        return solve_tri_angles(rec)

    # -- 72-78: similar figures --------------------------------------------
    if 72 <= n <= 78:
        return solve_similar(rec)

    # -- 79-82: an area with a hole in it ----------------------------------
    if 79 <= n <= 82:
        return solve_hole(rec)

    return None


# --------------------------------------------------------------------------
def solve_parallel(rec):
    """Angles 1..4 where l is parallel to m.

    From the picture: 1 sits above l left of t, 4 above l right of t, 3 below m
    left of t, 2 below m right of t. So 1 = 2, 3 = 4, and 1 + 3 = 180.
    """
    b = rec['body']
    given = dict(re.findall(r'\\ang\{(\d)\}\s*\$?=\s*\$?\s*([^,.$]+)', b))
    if not 1 <= len(given) <= 2:
        return None
    SAME = {'1': 'a', '2': 'a', '3': 'b', '4': 'b'}

    if len(given) == 1:
        # One angle is given and another is asked for; the two are either equal
        # or supplementary, and which is decided by the picture alone.
        (src, txt), = given.items()
        m = re.search(r'measure of (?:angle\s*)?(?:\\ang\{(\d)\}|(\d))', b, re.I)
        if not m:
            return None
        target = m.group(1) or m.group(2)
        val = numbers_in(txt.replace('\\dg', ''))
        if not val or target == src:
            return None
        v = val[0] if SAME[target] == SAME[src] else 180 - val[0]
        return pick_number(rec, v)

    def expr(t):
        t = t.replace('\\dg', '').replace('$', '').strip()
        m = re.fullmatch(r'\s*(-?\d*)\s*x\s*([+-]\s*\d+)?\s*', t)
        if m:
            k = m.group(1)
            k = float(k) if k not in ('', '-') else (-1.0 if k == '-' else 1.0)
            c = float(m.group(2).replace(' ', '')) if m.group(2) else 0.0
            return ('lin', k, c)
        m = re.fullmatch(r'\s*(-?\d+(?:\.\d+)?)\s*', t)
        return ('const', float(m.group(1))) if m else None

    parts = {k: expr(v) for k, v in given.items()}
    if any(p is None for p in parts.values()):
        return None
    (n1, e1), (n2, e2) = list(parts.items())
    supplementary = SAME[n1] != SAME[n2]

    # Solve for x when the two given angles are expressions.
    x = None
    if e1[0] == 'lin' and e2[0] == 'lin':
        k1, c1 = e1[1], e1[2]
        k2, c2 = e2[1], e2[2]
        if supplementary:
            if k1 + k2 == 0:
                return None
            x = (180 - c1 - c2) / (k1 + k2)
        else:
            if k1 - k2 == 0:
                return None
            x = (c2 - c1) / (k1 - k2)

    def value(name):
        e = parts.get(name)
        if e is not None:
            if e[0] == 'const':
                return e[1]
            return e[1] * x + e[2] if x is not None else None
        other = n1 if name != n1 else n2
        v = value(other)
        if v is None:
            return None
        return 180 - v if SAME[name] != SAME[other] else v

    if re.search(r'value of \$?x', rec['body'], re.I):
        return pick_number(rec, x) if x is not None else None
    m = re.search(r'measure of (?:angle\s*)?\\ang\{(\d)\}|measure of angle\s*(\d)'
                  r'|What is the measure of \\ang\{(\d)\}', rec['body'], re.I)
    if not m:
        return None
    want = next(g for g in m.groups() if g)
    v = value(want)
    return pick_number(rec, v) if v is not None else None


def solve_quad(rec):
    """Area (30-35) or perimeter (36-40) of the drawn quadrilateral.

    Read from the drawing: which four corners it has, which printed dimension is
    written against which edge, and which dimension is written away from every
    edge -- that last one is how these figures mark a height.
    """
    pts = geom.polygon(rec, sides=4)
    if not pts:
        return None
    kind = geom.classify_quad(pts)
    if not kind:
        return None
    on_edge, loose = geom.attach(rec, pts)
    if not on_edge:
        return None
    edges = geom.sides_of(pts)
    wants_area = 'area' in rec['body'].lower()

    def horizontal(i):
        (p, q) = edges[i][2]
        return abs(q[1] - p[1]) < 0.05 * max(edges[i][1], 1e-6)

    if kind in ('square', 'rectangle'):
        # Opposite edges are equal, so one label per direction is enough.
        w = next((v for i, v in on_edge.items() if horizontal(i)), None)
        h = next((v for i, v in on_edge.items() if not horizontal(i)), None)
        if kind == 'square':
            s = w if w is not None else h
            if s is None:
                return None
            return pick_number(rec, s * s if wants_area else 4 * s)
        if w is None or h is None:
            return None
        return pick_number(rec, w * h if wants_area else 2 * (w + h))

    if kind == 'parallelogram':
        base = next((v for i, v in on_edge.items() if horizontal(i)), None)
        slant = next((v for i, v in on_edge.items() if not horizontal(i)), None)
        if base is None or slant is None:
            return None
        if not wants_area:
            return pick_number(rec, 2 * (base + slant))
        if not loose:
            return None
        return pick_number(rec, base * loose[0])

    # trapezoid: the two parallel edges, and a height that is either written
    # loose or is the side standing perpendicular to them
    par = None
    for i in range(4):
        j = (i + 2) % 4
        a = (edges[i][2][1][0] - edges[i][2][0][0], edges[i][2][1][1] - edges[i][2][0][1])
        b = (edges[j][2][1][0] - edges[j][2][0][0], edges[j][2][1][1] - edges[j][2][0][1])
        if abs(a[0] * b[1] - a[1] * b[0]) < 0.02 * math.hypot(*a) * math.hypot(*b):
            par = (i, j)
            break
    if par is None or len(on_edge) < 4 and not wants_area:
        return None
    if not wants_area:
        return pick_number(rec, sum(on_edge[i] for i in range(4)))
    i, j = par
    if i not in on_edge or j not in on_edge:
        return None
    height = loose[0] if loose else None
    if height is None:
        for k in (i + 1) % 4, (i + 3) % 4:
            a = (edges[i][2][1][0] - edges[i][2][0][0], edges[i][2][1][1] - edges[i][2][0][1])
            b = (edges[k][2][1][0] - edges[k][2][0][0], edges[k][2][1][1] - edges[k][2][0][1])
            if abs(a[0] * b[0] + a[1] * b[1]) < 0.02 * math.hypot(*a) * math.hypot(*b) and k in on_edge:
                height = on_edge[k]
                break
    if height is None:
        return None
    return pick_number(rec, (on_edge[i] + on_edge[j]) * height / 2)


def solve_tri_area_bh(rec):
    """Q43 -- the drawn height and the base it belongs to."""
    F = fig_numbers(rec)
    if len(F) < 4:
        return None
    height, base = F[0], F[1]
    want = base * height / 2
    got = pick_number(rec, want)
    if got:
        return got
    # fall back on the three sides, in case the picture lists them differently
    sides = sorted(F)[-3:]
    return pick_number(rec, heron(*sides), rel=0.03)


def solve_plate_hole(rec):
    """Q44 -- a right-triangular hole; the picture gives both legs and the
    hypotenuse, and only two of the three are legs."""
    F = fig_numbers(rec)
    if len(F) < 3:
        return None
    a, b, c = sorted(F[:3])
    if not close(a * a + b * b, c * c, rel=0.01):
        return None
    return pick_number(rec, a * b / 2)


def solve_tri_kind(rec):
    """45-57 -- by angles or by sides, from the drawing or from the sentence."""
    body = rec['body'].lower()
    by_angles = 'according to its angles' in body
    nums = stem_numbers(rec) if not rec['figure'] else None

    if nums is None:                                   # read the drawing
        labels = rec['labels']
        angs = [float(m.group(1)) for L in labels
                for m in [re.match(r'(\d+(?:\.\d+)?)\^\\circ', L)] if m]
        sides = [L for L in labels if not re.match(r'\d+(?:\.\d+)?\^\\circ', L)]
        if by_angles:
            if len(angs) >= 3:
                return pick_word(rec, classify_by_angles(angs) + ' triangle')
            pts = triangle_shape(rec)
            return pick_word(rec, classify_by_angles(angles_of(pts)) + ' triangle') if pts else None
        # By sides. A square corner in the drawing is not the answer here: the
        # 3-4-5 triangle is a right triangle, but asked about its SIDES the
        # paper wants "scalene", and the key says so in all three versions.
        vals = [v for L in sides for v in numbers_in(L)] or None
        names = [L for L in sides if re.fullmatch(r'\$?[a-z]\$?', L)]
        if vals and len(vals) >= 3:
            u = len(set(round(v, 6) for v in vals[:3]))
            return pick_word(rec, {1: 'Equilateral', 2: 'Isosceles', 3: 'Scalene'}[u] + ' triangle')
        if names:
            u = len(set(names))
            return pick_word(rec, {1: 'Equilateral', 2: 'Isosceles'}.get(u, 'Scalene') + ' triangle')
        return None

    # from the sentence: a set of three angles or three sides
    if len(nums) < 3:
        return None
    if by_angles:
        return pick_word(rec, classify_by_angles(nums[:3]) + ' triangle')
    u = len(set(round(v, 6) for v in nums[:3]))
    return pick_word(rec, {1: 'Equilateral', 2: 'Isosceles', 3: 'Scalene'}[u] + ' triangle')


def solve_pythagoras(rec):
    """58-62 -- one side of a right triangle from the other two.

    Whether the unknown is a leg or the hypotenuse is read off the drawing: the
    unknown is the side carrying the letter, and it is the hypotenuse exactly
    when that side is the one opposite the square corner. Guessing instead --
    trying the leg first and falling back -- silently picks the decoy, because
    these papers put the other calculation among the options on purpose.
    """
    F = fig_numbers(rec)
    pts = triangle_shape(rec)
    if pts and len(F) >= 2:
        on_edge, _ = geom.attach(rec, pts, max_dist=1.2)
        angs = angles_of(pts)
        # the edge opposite the square corner
        right_vertex = next((i for i, a in enumerate(angs) if abs(a - 90) <= 1.0), None)
        if right_vertex is not None and len(on_edge) == 2:
            edges = geom.sides_of(pts)
            opposite = None
            for i, (_, _, (p, q)) in enumerate(edges):
                if pts[right_vertex] not in (p, q):
                    opposite = i
            unknown = next(i for i in range(3) if i not in on_edge)
            a, b = (on_edge[i] for i in sorted(on_edge))
            want = math.hypot(a, b) if unknown == opposite else math.sqrt(abs(b * b - a * a))
            got = pick_number(rec, want, rel=0.01)
            if got:
                return got

    if rec['n'] == 60 and len(F) >= 2:
        # A brace across a rectangular support: its diagonal.
        return pick_number(rec, math.hypot(F[0], F[1]), rel=0.01)

    S = stem_numbers(rec)
    if len(S) >= 2:
        # the current triangle: the total current is the hypotenuse
        a, b = sorted(S[:2])
        return pick_number(rec, math.sqrt(b * b - a * a), rel=0.01)
    return None


def solve_tri_area(rec):
    """63-66 -- base and drawn height when the picture gives one, otherwise the
    three sides through Heron's formula."""
    F = fig_numbers(rec)
    if not F:
        return None
    if rec['n'] == 64:                       # isosceles right triangle, one leg
        leg = F[0]
        area = leg * leg / 2
        perim = 2 * leg + math.hypot(leg, leg)
        return pick_numbers(rec, [area, perim], rel=0.005)
    if rec['n'] == 65:                       # two equal sides and the base
        side, base = F[0], F[1]
        h = math.sqrt(max(0.0, side * side - (base / 2) ** 2))
        return pick_number(rec, base * h / 2, rel=0.05)
    if len(F) == 4:                          # two slants, a height, a base
        want = F[3] * F[2] / 2
        got = pick_number(rec, want, rel=0.02)
        if got:
            return got
    if len(F) >= 3:
        return pick_number(rec, heron(*F[:3]), rel=0.03)
    return None


def solve_tri_angles(rec):
    """67-71 -- the angles of a triangle sum to 180."""
    n = rec['n']
    labels = rec['labels']
    angs = [float(m.group(1)) for L in labels
            for m in [re.match(r'(\d+(?:\.\d+)?)\^\\circ', L)] if m]
    sides = [L for L in labels if not re.match(r'\d+(?:\.\d+)?\^\\circ', L)
             and not re.fullmatch(r'[a-zA-Z]', L)]

    if n == 71:
        return solve_crossed_triangles(rec)

    pts = triangle_shape(rec)
    right = pts is not None and any(abs(a - 90) <= 0.5 for a in angles_of(pts))

    if len(angs) == 2:                                   # two angles given
        return pick_number(rec, 180 - sum(angs))
    if len(angs) == 1 and right:                         # one angle plus a square corner
        return pick_number(rec, 90 - angs[0])
    if len(angs) == 1 and sides and pts:
        return solve_isosceles_angles(rec, pts, angs[0])
    if not angs and sides:                               # equilateral
        vals = numbers_in(' '.join(sides))
        if vals and len(set(vals)) == 1:
            return pick_number(rec, 60)
    return None


def solve_isosceles_angles(rec, pts, given):
    """Q68 -- two sides marked equal, one angle printed, two named unknowns.

    Which unknown is which is the whole question: the two equal sides meet at
    one corner, and that corner's angle is the odd one out. The paper offers the
    two values swapped as a distractor, so the letters have to be placed on the
    drawing rather than assumed.
    """
    edges = geom.sides_of(pts)
    on_edge, _ = geom.attach(rec, pts, max_dist=1.3)
    equal = [i for i in on_edge if list(on_edge.values()).count(on_edge[i]) > 1]
    if len(equal) != 2:
        return None
    shared = set(edges[equal[0]][2]) & set(edges[equal[1]][2])
    if len(shared) != 1:
        return None
    apex = shared.pop()

    # Which corner each named unknown sits at. Only the letters are placed --
    # a side length written mid-edge is nearest a corner too, and would
    # otherwise claim it.
    at = {}
    for text, pos in geom.labels_with_positions(rec):
        t = text.strip().replace('$', '')
        if not re.fullmatch(r'[a-z]', t):
            continue
        best = min(pts, key=lambda p: math.hypot(pos[0] - p[0], pos[1] - p[1]))
        at.setdefault(best, t)

    base_angle = given
    apex_angle = 180 - 2 * base_angle
    wants = {}
    for p, t in at.items():
        if re.fullmatch(r'[a-z]', t):
            wants[t] = apex_angle if p == apex else base_angle
    return pick_named(rec, wants) if len(wants) == 2 else None


def solve_crossed_triangles(rec):
    """Q71 -- two triangles meeting at a point, one angle wanted in the far one.

    The angle at the crossing is shared (vertical angles), so the far triangle's
    third angle is 180 minus the crossing angle minus its own known angle.
    """
    angs = sorted(float(m.group(1)) for L in rec['labels']
                  for m in [re.match(r'(\d+(?:\.\d+)?)\^\\circ', L)] if m)
    if len(angs) != 3:
        return None
    for shared in angs:
        for known in angs:
            if known is shared:
                continue
            got = pick_number(rec, 180 - shared - known)
            if got:
                return got
    return None


def solve_similar(rec):
    n, F, S = rec['n'], fig_numbers(rec), stem_numbers(rec)
    if n == 72:                       # DE parallel to BC, AE = EB, DE given
        if len(F) < 3:
            return None
        return pick_number(rec, F[2] * 2)
    if n == 73:                       # crossed similar triangles
        return solve_crossed_similar(rec)
    if n == 74:                       # similar rectangles, three sides in the text
        if len(S) < 3:
            return None
        ab, bc, xy = S[0], S[1], S[2]
        return pick_number(rec, bc * xy / ab)
    if n == 75:                       # a ramp braced at equal intervals
        if len(F) < 4:
            return None
        height, step = F[0], F[1]
        total = step * (len(F) - 1)
        return pick_number(rec, height * (2 * step) / total)
    if n == 76:                       # shadows
        if len(S) < 3:
            return None
        shadow, rod, rod_shadow = S[0], S[1], S[2]
        return pick_number(rec, shadow * rod / rod_shadow)
    if n == 77:
        return solve_similar_right(rec)
    if n == 78:
        return solve_similar_apex(rec)
    return None


def solve_similar_right(rec):
    """Q77 -- a right triangle ABC with DE dropped parallel to the leg BC.

    Three lengths are printed: BC on the upright leg, and AD and AB measured
    along the base, AD being the shorter of the two because D lies between.
    """
    pts = triangle_shape(rec)
    if not pts:
        return None
    on_edge, loose = geom.attach(rec, pts, max_dist=1.3)
    edges = geom.sides_of(pts)
    upright = [i for i in range(3)
               if abs(edges[i][2][1][0] - edges[i][2][0][0]) < 0.05 * edges[i][1]]
    if len(upright) != 1 or upright[0] not in on_edge:
        return None
    bc = on_edge[upright[0]]
    spans = sorted([v for i, v in on_edge.items() if i != upright[0]] + loose)
    if len(spans) != 2:
        return None
    ad, ab = spans
    de = bc * ad / ab
    ae = math.hypot(ab, bc) * ad / ab
    return pick_named(rec, {'DE': de, 'AE': ae})


def solve_similar_apex(rec):
    """Q78 -- triangle ABC with DE parallel to the base AB, D on CA, E on CB.

    Each of the two split sides carries two printed pieces; which piece is the
    one next to the apex is decided by where the label is written, not by the
    order the figure happens to list them.
    """
    pts = triangle_shape(rec)
    if not pts:
        return None
    apex = max(pts, key=lambda p: p[1])
    base = [p for p in pts if p is not apex]
    labelled = []
    for text, pos in geom.labels_with_positions(rec):
        vals = numbers_in(text)
        if len(vals) == 1 and not re.fullmatch(r'[A-Z]', text.strip().replace('$', '')):
            labelled.append((vals[0], pos))
    if len(labelled) != 4:
        return None

    def d(p, q):
        return math.hypot(p[0] - q[0], p[1] - q[1])

    # the base is the one label lying nearest the segment between the two base corners
    base_mid = ((base[0][0] + base[1][0]) / 2, (base[0][1] + base[1][1]) / 2)
    ab_val, ab_pos = min(labelled, key=lambda t: d(t[1], base_mid))
    rest = [t for t in labelled if t is not (ab_val, ab_pos) and t[1] != ab_pos]
    if len(rest) != 3:
        return None
    # of the two written along CA, the one nearer the apex is DC
    side = {}
    for corner in base:
        near = sorted(rest, key=lambda t: d(t[1], corner))
        side[corner] = near
    left, right = base[0], base[1]
    ca = sorted(rest, key=lambda t: d(t[1], left))[:2]
    cb = [t for t in rest if t not in ca]
    if len(cb) != 1:
        return None
    dc = max(ca, key=lambda t: -d(t[1], apex))[0] if False else min(ca, key=lambda t: d(t[1], apex))[0]
    ad = next(v for v, p in ca if v != dc)
    ce = cb[0][0]
    total = ad + dc
    de = ab_val * dc / total
    bc = ce * total / dc
    return pick_named(rec, {'DE': de, 'BC': bc})


def solve_crossed_similar(rec):
    """Q73 -- CD from two similar triangles that meet at O."""
    vals = []
    for L in rec['labels']:
        m = re.fullmatch(r'\\sqrt\{(\d+(?:\.\d+)?)\}', L)
        if m:
            vals.append(math.sqrt(float(m.group(1))))
        else:
            vals += numbers_in(L)
    if len(vals) < 3:
        return None
    ab, ob, oc = vals[0], vals[1], vals[2]
    return pick_number(rec, ab * oc / ob, rel=0.03)


def solve_hole(rec):
    """79-82 -- a shape with a piece cut out of it."""
    n, F = rec['n'], fig_numbers(rec)
    if n == 79:                       # trapezoid, triangular hole
        if len(F) < 5:
            return None
        top, bottom, height, base, h = F
        return pick_number(rec, (top + bottom) * height / 2 - base * h / 2)
    if n in (80, 81):                 # parallelogram, rectangular hole
        if len(F) < 5:
            return None
        slant, base, height, hw, hh = F
        punched = hw * hh
        if 'punched' in rec['body'].lower():
            return pick_number(rec, punched)
        return pick_number(rec, base * height - punched)
    if n == 82:                       # rectangle, triangular hole
        if len(F) < 4:
            return None
        w, h, th, tb = F
        return pick_number(rec, w * h - tb * th / 2)
    return None


# --------------------------------------------------------------------------
def check():
    # The paper must have the same shape in every version, or a solver written
    # for question n in one version would be answering a different question in
    # another.
    for n in range(1, 83):
        lessons = {D[v][n]['lesson'] for v in 'ABCD'}
        assert len(lessons) == 1, f'Q{n} has different lesson codes: {lessons}'

    agree = disagree = unsolved = 0
    wrong, blank = [], []
    for v in 'BCD':
        for n in range(1, 83):
            got = solve(D[v][n])
            want = KEY[n][v]
            if got is None:
                unsolved += 1
                blank.append((v, n))
            elif got == want:
                agree += 1
            else:
                disagree += 1
                wrong.append((v, n, got, want))
    print(f'B/C/D: {agree} agree with the official key, {disagree} disagree, {unsolved} not solved')
    if wrong:
        print('  disagreements:')
        for v, n, got, want in wrong[:40]:
            print(f'    {v} Q{n}: computed ({got}) but the key says ({want})')
    if blank:
        from collections import Counter
        c = Counter(n for _, n in blank)
        print('  unsolved question numbers:', sorted(c))
    return wrong, blank


if __name__ == '__main__':
    check()
