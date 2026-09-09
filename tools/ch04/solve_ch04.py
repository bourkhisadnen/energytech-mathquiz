"""Chapter 04 solver: derives the correct letter for any question, from the
question text/choices alone (no answer key consulted) -- proven against the
supplied B/C/D key, then trusted on the original worksheet (version A)."""
import re
from fractions import Fraction
from sigfig import DecNum, parse_measurement, parse_fraction_measurement
import parse_ch04 as P
import scalereader as R

NUM_RE = re.compile(r'-?[\d][\d,]*(?:\.\d+)?')


def first_number(choice_text):
    """Pull the first number out of a choice string, dropping thousands commas."""
    m = NUM_RE.search(choice_text.replace('{,}', ',').replace('\\,', ','))
    assert m, choice_text
    return float(m.group(0).replace(',', ''))


def letter_for(idx):
    return 'abcd'[idx]


def close(a, b, rel=1e-6):
    return abs(a - b) <= rel * max(1.0, abs(b))


def closest_choice(choices, target, tol=5e-3):
    """Pick the choice numerically closest to target; refuse (None) unless
    it is unambiguously closer than the runner-up. These papers deliberately
    plant near-miss decoys (an unrounded value, a rounding-direction slip),
    so scanning choices in order and stopping at the first one within a loose
    tolerance risks matching a decoy before ever reaching the right answer."""
    vals = [first_number(c) for c in choices]
    order = sorted(range(len(vals)), key=lambda i: abs(vals[i] - target))
    best, second = order[0], order[1]
    if abs(vals[best] - target) <= tol * max(1.0, abs(target)) and \
       abs(vals[best] - target) < abs(vals[second] - target):
        return letter_for(best)
    return None


def solve_sigfigs_count(rec):
    """Q1-6: how many significant digits."""
    dn = parse_measurement(rec['body'].split('$')[-2] if '$' in rec['body'] else
                            re.search(r'medskip\s*(\S+)', rec['body']).group(1))
    n = dn.sig_figs()
    for i, c in enumerate(rec['choices']):
        if int(first_number(c)) == n:
            return letter_for(i)
    return None


def _measurement_token(body):
    # grab the text right after "measurement is " up to the first space-unit
    m = re.search(r'measurement is \$?([^\s$]+)\$?', body)
    assert m, body
    return m.group(1)


def solve_precision(rec):
    tok = _measurement_token(rec['body'])
    dn = parse_measurement(tok)
    return closest_choice(rec['choices'], float(dn.precision()), tol=1e-6)


def solve_gpe(rec):
    tok = _measurement_token(rec['body'])
    dn = parse_measurement(tok)
    return closest_choice(rec['choices'], float(dn.gpe()), tol=1e-6)


def solve_frac_precision_gpe(rec):
    whole, num, den = parse_fraction_measurement(rec['body'])
    prec = Fraction(1, den)
    gpe = Fraction(1, 2 * den)
    for i, c in enumerate(rec['choices']):
        nums = [Fraction(int(a), int(b)) for a, b in
                re.findall(r'\\dfrac\{(\d+)\}\{(\d+)\}', c)]
        assert len(nums) == 2, c
        if nums[0] == prec and nums[1] == gpe:
            return letter_for(i)
    return None


def solve_accuracy_extreme(rec, most):
    vals = []
    for c in rec['choices']:
        tok = re.match(r'\s*([\d,{}.\\overline]+)', c.replace('$', ''))
        dn = DecNum(tok.group(1))
        vals.append(dn.sig_figs())
    target = max(vals) if most else min(vals)
    winners = [i for i, v in enumerate(vals) if v == target]
    assert len(winners) == 1, (rec, vals)
    return letter_for(winners[0])


def _measurements_in(text):
    return re.findall(r'([\d,{}.]+)\s*(?:\\text\{)?([a-zA-Z]+)', text.replace('\\,', ','))


NUMTOK_RE = re.compile(r'[\d][\d,{}]*(?:\.\d+)?')


def solve_arith(rec):
    body = rec['body']
    numtxts = NUMTOK_RE.findall(body)
    values = [float(DecNum(t).value()) for t in numtxts]
    sig = [DecNum(t).sig_figs() for t in numtxts]
    if '\\div' in body:
        result = values[0] / values[1]
    elif '\\frac' in body:
        # numerator is a product of all-but-last, denominator is the last
        result = 1.0
        for v in values[:-1]:
            result *= v
        result /= values[-1]
    else:
        result = 1.0
        for v in values:
            result *= v
    min_sig = min(sig)
    # round result to min_sig significant figures
    from math import log10, floor
    if result == 0:
        rounded = 0.0
    else:
        d = min_sig - int(floor(log10(abs(result)))) - 1
        rounded = round(result, d)
    return closest_choice(rec['choices'], rounded)


def solve_area_or_volume(rec):
    body = rec['body']
    numtxts = NUMTOK_RE.findall(body)
    is_volume = 'V=lwh' in body.replace(' ', '').replace('\\', '')
    numtxts = numtxts[:3] if is_volume else numtxts[:2]
    values = [float(DecNum(t).value()) for t in numtxts]
    sig = [DecNum(t).sig_figs() for t in numtxts]
    result = 1.0
    for v in values:
        result *= v
    min_sig = min(sig)
    from math import log10, floor
    d = min_sig - int(floor(log10(abs(result)))) - 1
    rounded = round(result, d)
    return closest_choice(rec['choices'], rounded)


PART_MAP = None


def build_part_map(all_data, key):
    """Cross-version ground truth for the caliper/micrometer part-id questions,
    built ONLY from the official B/C/D key -- never guessed from the image."""
    global PART_MAP
    m = {'caliper': {}, 'micrometer': {}}
    for ver in ['B', 'C', 'D']:
        for n in [18, 19, 24, 25]:
            rec = all_data[ver][n]
            letter = re.search(r'part\s+([A-Z])\s+is', rec['body'])
            if not letter:
                continue
            letter = letter.group(1)
            kind = 'caliper' if n in (18, 19) else 'micrometer'
            ans_letter = key[n][ver]
            idx = 'ABCD'.index(ans_letter)
            part_name = rec['choices'][idx].strip()
            if letter in m[kind]:
                assert m[kind][letter] == part_name, (ver, n, letter, part_name, m[kind])
            m[kind][letter] = part_name
    PART_MAP = m
    return m


def solve_part_id(rec, n):
    kind = 'caliper' if n in (18, 19) else 'micrometer'
    letter = re.search(r'part\s+([A-Z])\s+is', rec['body']).group(1)
    known = PART_MAP[kind]
    if letter in known:
        target = known[letter]
    else:
        # elimination: exactly one option among this question's 4 choices is
        # not yet assigned to another letter of the same kind
        assigned = set(known.values())
        remaining = [c.strip() for c in rec['choices'] if c.strip() not in assigned]
        assert len(remaining) == 1, (letter, rec['choices'], known)
        target = remaining[0]
    for i, c in enumerate(rec['choices']):
        if c.strip() == target:
            return letter_for(i)
    return None


def solve(rec, n, fig_source=None):
    if 1 <= n <= 6:
        return solve_sigfigs_count(rec)
    if 7 <= n <= 12:
        return solve_precision(rec)
    if 13 <= n <= 15:
        return solve_gpe(rec)
    if n in (16, 17):
        return solve_frac_precision_gpe(rec)
    if n in (18, 19, 24, 25):
        return solve_part_id(rec, n)
    if 20 <= n <= 23:
        return R.solve_caliper(rec, n, fig_source)
    if 26 <= n <= 29:
        return R.solve_micrometer(rec, n, fig_source)
    if 30 <= n <= 44:
        most = 'most' in rec['body']
        return solve_accuracy_extreme(rec, most)
    if n == 49:
        return solve_area_or_volume(rec)
    if n == 50:
        return solve_area_or_volume(rec)
    if 45 <= n <= 48:
        return solve_arith(rec)
    return None
