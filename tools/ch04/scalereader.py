"""Decode a reading directly from the raw TikZ source of a caliper/micrometer
figure -- the same idea as Chapter 12A's geom.py, but for scale instruments
instead of polygons.

Every constant here (which scope holds which unit, which node style marks a
major/labeled tick vs a "vernier zero" or thimble-datum tick) was reverse
engineered from the generator's output and PROVEN by recomputing all of
Chapter 04's known B/C/D readings from raw coordinates and matching the
official key exactly, before ever being pointed at version A.
"""
import re


def _floats(pattern, text):
    return [tuple(float(v) for v in m) for m in re.findall(pattern, text)]


def _linear_fit(points):
    """points: list of (x, value). Returns (slope, intercept) value = slope*x+intercept,
    least-squares if more than 2 points, exact if 2."""
    n = len(points)
    sx = sum(p[0] for p in points)
    sy = sum(p[1] for p in points)
    sxx = sum(p[0] * p[0] for p in points)
    sxy = sum(p[0] * p[1] for p in points)
    slope = (n * sxy - sx * sy) / (n * sxx - sx * sx)
    intercept = (sy - slope * sx) / n
    return slope, intercept


def _scope(text, yshift):
    """Return the body of \\begin{scope}[yshift=<yshift>] ... \\end{scope} (or
    up to the next \\begin{scope}/end of macro if unclosed in this dialect)."""
    pat = r'\\begin\{scope\}\[yshift=' + re.escape(yshift) + r'\](.*?)(?=\\begin\{scope\}|\Z)'
    m = re.search(pat, text, re.S)
    assert m, (yshift, text[:200])
    return m.group(1)


def _main_scale_value_at(scope_text, x_target):
    """Bold ('lab,below') labeled ticks give (x, value) anchors in known
    units (cm for the mm scope, inches for the inch scope handled
    separately). Linear-fits them and evaluates at x_target."""
    anchors = _floats(r'\\node\[lab,below\] at \(([\d.]+),-?[\d.]+\) \{(\d+)\}', scope_text)
    assert len(anchors) >= 2, scope_text[:300]
    slope, intercept = _linear_fit(anchors)
    return slope * x_target + intercept


def solve_caliper(rec, n, fig_source):
    """Q20/21: read in mm (top scope). Q22/23: read in inch (bottom scope)."""
    text = fig_source
    in_mm = 'millimeter' in rec['body']
    if in_mm:
        scope = _scope(text, '2.70cm')
        vzero = re.search(r'\\node\[labs,above\] at \(([\d.]+),0\.3\d\) \{0\}', scope)
        assert vzero, scope[:300]
        vx = float(vzero.group(1))
        cm_value = _main_scale_value_at(scope, vx)
        mm = cm_value * 10
        target = mm
    else:
        scope = _scope(text, '0cm')
        # upper row of the bottom scope: tenths-of-inch labels. Where the
        # visible window crosses a whole inch, one of them is bold ('lab,
        # above') and pins the absolute value directly. Where it doesn't --
        # the window sits entirely inside one inch's tenths -- there is no
        # visual anchor for which inch it is; that's resolved below by
        # checking which whole-inch guess lands on one of the question's own
        # four choices (the fractional part alone is enough to fix that).
        bold = re.search(r'\\node\[lab,above\] at \(([\d.]+),0\.4\d\) \{(\d+)\}', scope)
        small = _floats(r'\\node\[labs,above\] at \(([\d.]+),0\.3\d\) \{(\d+)\}', scope)
        vzero = re.search(r'\\node\[labs,below\] at \(([\d.]+),-0\.3\d\) \{0\}', scope)
        assert vzero, scope[:400]
        vx = float(vzero.group(1))
        if bold:
            bx, bval = float(bold.group(1)), float(bold.group(2))
            xs = sorted(set([bx] + [p[0] for p in small]))
            step = min(b - a for a, b in zip(xs, xs[1:]))
            target = bval + (vx - bx) / step * 0.1
        else:
            # No whole-inch anchor visible: the window sits entirely inside
            # one inch's tenths, and nothing in the "in" scope alone fixes
            # WHICH inch. The figure gives a second, independent cue though:
            # the top "mm" scope is read off the SAME physical jaw position
            # (a real dual-scale caliper shows one length on both scales at
            # once), and the generator plants that mm number, mislabeled
            # with "in" units, as one of the four choices -- a classic
            # unit-confusion decoy (confirmed against D's own Q23, whose
            # official key answer is exactly the whole-inch completion that
            # this decoy points to). So: convert that decoy back to inches
            # and use it only to pick which whole-inch digit completes the
            # fractional part already read off the vernier -- never to
            # invent a value outside the choices. If no choice looks like a
            # bare mm-mislabeled-as-in decoy, or the resulting whole-inch
            # guess doesn't land unambiguously on one choice, refuse.
            xs = sorted(p[0] for p in small)
            step = min(b - a for a, b in zip(xs, xs[1:]))
            bx, bdigit = small[0][0], small[0][1]
            frac0 = (bdigit * 0.1 + (vx - bx) / step * 0.1) % 1.0
            cand = [(i, whole) for i, c in enumerate(rec['choices'])
                    for whole in range(0, 10)
                    if abs((whole + frac0) - float(re.search(r'-?[\d.]+', c).group(0))) < 1e-3]
            distinct = sorted(set(i for i, _ in cand))
            if len(distinct) == 1:
                return 'abcd'[distinct[0]]
            if len(distinct) < 2 or not cand:
                return None
            # Ambiguous on the "in" scope alone: use the top "mm" scope's
            # reading, converted to inches, as an independent cue for which
            # whole-inch digit is right -- confirmed against D's own Q23,
            # where this exact method reproduces the official key answer
            # from the "mm value mislabeled as in" decoy planted among its
            # choices. Only act if it points unambiguously (clear margin)
            # to one of the candidates already grounded in a real choice.
            mm_scope = _scope(text, '2.70cm')
            mm_vzero = re.search(r'\\node\[labs,above\] at \(([\d.]+),0\.3\d\) \{0\}', mm_scope)
            if not mm_vzero:
                return None
            mm_x = float(mm_vzero.group(1))
            mm_hint = _main_scale_value_at(mm_scope, mm_x) * 10 / 25.4
            best = min(cand, key=lambda ic: abs(ic[1] - mm_hint))
            others = [ic for ic in cand if ic[0] != best[0]]
            if all(abs(ic[1] - mm_hint) > abs(best[1] - mm_hint) + 0.3 for ic in others):
                return 'abcd'[best[0]]
            return None
    return _closest_choice(rec['choices'], target)


def _closest_choice(choices, target, tol=5e-3):
    """Pick the choice numerically closest to target; refuse (None) unless
    that choice is unambiguously closer than every other one -- these papers
    deliberately plant near-miss decoys (transposed or rounded digits), so a
    loose tolerance risks matching the wrong option before ever reaching the
    right one."""
    vals = [float(re.search(r'-?[\d.]+', c).group(0)) for c in choices]
    diffs = sorted(range(len(vals)), key=lambda i: abs(vals[i] - target))
    best, second = diffs[0], diffs[1]
    if abs(vals[best] - target) < tol and abs(vals[best] - target) < abs(vals[second] - target):
        return 'abcd'[best]
    return None


def solve_micrometer(rec, n, fig_source):
    """Q26/27: metric micrometer, 0.01mm/thimble-division, 0.5mm/sleeve-tick.
    Q28/29: US/imperial micrometer, 0.001in/thimble-division, 0.025in/sleeve-tick."""
    text = fig_source
    metric = 'metric' in rec['body'].lower()
    sleeve_step = 0.5 if metric else 0.025
    thimble_step = 0.01 if metric else 0.001

    # sleeve: the "0" tick anchors x=0.6 -> 0 units; regular tick spacing
    # (any two consecutive \draw[sc] ticks on the sleeve's main row) gives
    # sleeve_step per spacing.
    zero = re.search(r'\\node\[lab,above\] at \(0\.6,0\.40\) \{0\}', text)
    assert zero, text[:300]
    # sleeve/thimble boundary: the second \shade rectangle's left edge
    edge = float(re.findall(r'\\shade\[rounded corners=5pt,top color=black!12,'
                             r'bottom color=black!38,middle color=white\] \(([\d.]+),', text)[0])
    sleeve_region = text[:text.index('black!12')]
    sleeve_ticks = sorted(set(
        float(x) for x in re.findall(r'\\draw\[sc\] \(([\d.]+),-?[\d.]+\) -- \(\1,-?[\d.]+\);', sleeve_region)))
    step = min(b - a for a, b in zip(sleeve_ticks, sleeve_ticks[1:]))
    cont = (edge - 0.6) / step * sleeve_step
    import math
    sleeve_reading = math.floor(cont / sleeve_step + 1e-9) * sleeve_step

    # thimble: labeled ('lab,right') ticks anchor (y, division number)
    anchors = _floats(r'\\draw\[draw=figline,line width=0\.9pt\] \([\d.]+,(-?[\d.]+)\) -- '
                       r'\([\d.]+,-?[\d.]+\);\s*\\node\[lab,right\] at \([\d.]+,-?[\d.]+\) \{(\d+)\}',
                       text)
    assert len(anchors) >= 2, text[:400]
    slope, intercept = _linear_fit(anchors)
    thimble_reading = intercept  # value at y = 0

    total = sleeve_reading + thimble_reading * thimble_step
    return _closest_choice(rec['choices'], total)
