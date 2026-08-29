#!/usr/bin/env python3
"""Independently re-derive the Chapters 01 & 02 answer keys.

Nothing here reads the stored answer until it has computed its own. Anything it
cannot compute is reported as unchecked rather than quietly passed -- a verifier
that silently skips what it cannot do is worse than none, because it reads as
coverage it does not have.
"""
import json, re, sys, collections
from fractions import Fraction
from decimal import Decimal, ROUND_HALF_UP

BANK = '/tmp/energytech_app/energytech_quiz_app_session_sync_fixed/question_bank.js'

# ---------------------------------------------------------------- parsing ----

def strip_tex(s):
    s = s.replace('\\,', ' ').replace('\\;', ' ').replace('{,}', '').replace('\\!', '')
    # The fill-in-the-blank idiom, before the generic command stripper turns it
    # into stray braces that then look like part of the sentence.
    s = s.replace('\\$', '$')
    s = re.sub(r'\\underline\{\\hspace\{[^}]*\}\}', ' ', s)
    s = re.sub(r'\\(?:hspace|rule)\{[^}]*\}(\{[^}]*\})?', ' ', s)
    s = re.sub(r'\\(displaystyle|centerline|par|vspace\{[^}]*\}|hline|left|right)', ' ', s)
    s = re.sub(r'\\[a-zA-Z]+', ' ', s)          # stray unit macros: \ftcubed, \gal
    s = s.replace('$', ' ').replace('\\(', ' ').replace('\\)', ' ')
    return re.sub(r'\s+', ' ', s).strip()

def split_choices(raw):
    parts = [p.strip() for p in raw.split('\\item') if p.strip()]
    return parts

NUM = r'-?[\d,]+(?:\.\d+)?'
# \frac{a}{b}, \dfrac ab, \dfrac a{b}, \dfrac{a}b -- all four appear in the papers.
FRACPAT = r'\\[dt]?frac\s*(?:\{(\d+)\}|(\d))\s*(?:\{(\d+)\}|(\d))'
def _fp_raw(m, base=0):
    n = m.group(base + 1) or m.group(base + 2)
    d = m.group(base + 3) or m.group(base + 4)
    return int(n), int(d)

def _fp(m, base=0):
    n, d = _fp_raw(m, base)
    return Fraction(n, d)

def clean_choice(t):
    """Strip the wrappers and unit macros a choice may be dressed in, so the
    number inside can be read. Anything left over is the caller's problem."""
    t = t.strip()
    t = t.replace('\\(', '').replace('\\)', '').replace('\\$', '').replace('$', '')
    t = t.replace('\\,', ' ').replace('\\;', ' ').replace('\\!', '')
    t = t.replace('{,}', '').replace('\\%', '%')
    t = re.sub(r'\\(?:mathrm|text|textbf)\{([^}]*)\}', r'\1', t)
    return t.strip()

def strip_units(t):
    """Drop a trailing unit: 'km/L', 'ft', '\\ftcubed', 'in.'"""
    t = re.sub(r'\\[a-zA-Z]+\s*$', '', t).strip()          # \ftcubed, \gal
    t = re.sub(r'[A-Za-z][A-Za-z/. ]*$', '', t).strip()     # km/L, mi, in.
    return t

def as_fraction(text):
    """A choice as an exact value, or None when it is not a plain number."""
    t = clean_choice(text)
    # a\frac{b}{c} or a\dfrac bc  (mixed) -- before the bare fraction
    m = re.fullmatch(r'(-?\d[\d,]*)\s*' + FRACPAT + r'\s*.*', t)
    if m:
        whole = Fraction(int(m.group(1).replace(',', '')))
        frac = _fp(m, 1)
        return whole + frac if whole >= 0 else whole - frac
    # \frac{a}{b} or \dfrac ab
    m = re.fullmatch(r'(-?)' + FRACPAT + r'\s*.*', t)
    if m:
        v = _fp(m, 1)
        return -v if m.group(1) == '-' else v
    # a\times10^{n}, a\times10^n, a\times10
    m = re.fullmatch(r'(' + NUM + r')\s*\\times\s*10(?:\^\{?(-?\d+)\}?)?\s*', t)
    if m:
        e = int(m.group(2)) if m.group(2) is not None else 1
        return Fraction(Decimal(m.group(1).replace(',', ''))) * Fraction(10) ** e
    # a percentage
    m = re.fullmatch(r'(' + NUM + r')\s*%\s*', t)
    if m:
        return ('PCT', Fraction(Decimal(m.group(1).replace(',', ''))))
    # a R b
    m = re.fullmatch(r'(-?\d[\d,]*)\s*R\s*(\d+)\s*', t)
    if m:
        return ('R', int(m.group(1).replace(',', '')), int(m.group(2)))
    # a plain number, with or without a unit after it
    bare = strip_units(t)
    m = re.fullmatch(NUM, bare)
    if m:
        return Fraction(Decimal(bare.replace(',', '')))
    return None

# ------------------------------------------------------------------ form ----
# Several questions offer options that are numerically equal but written
# differently -- 67/16 beside 4 3/16, or 25.86x10^4 beside 2.586x10^5. Only one
# is in the form the question asks for, so value alone cannot pick the answer.

def power_of_ten(t):
    """10^{k} or 1/10^{k} as an exact value."""
    t = clean_choice(t)
    m = re.fullmatch(r'10\^\{?(-?\d+)\}?\s*', t)
    if m:
        return Fraction(10) ** int(m.group(1))
    m = re.fullmatch(r'\\[dt]?frac\{1\}\{10\^\{?(-?\d+)\}?\}\s*', t)
    if m:
        return Fraction(1, 1) / (Fraction(10) ** int(m.group(1)))
    # 10^0 and 10^1 are written plainly as 1 and 10
    if re.fullmatch(r'1\s*', t):
        return Fraction(1)
    if re.fullmatch(r'10\s*', t):
        return Fraction(10)
    return None

def written_number(t):
    """The bare numeral in a choice, or None."""
    bare = strip_units(clean_choice(t))
    return bare.replace(',', '') if re.fullmatch(NUM, bare) else None

def decimals_of(t):
    n = written_number(t)
    return None if n is None else (len(n.split('.')[1]) if '.' in n else 0)

def sig_digits_of(t):
    n = written_number(t)
    if n is None:
        return None
    n = n.lstrip('-')
    if '.' in n:
        whole, frac = n.split('.')
        digits = (whole + frac).lstrip('0')
        return len(digits) if digits else 1
    return len(n.rstrip('0')) if n.strip('0') else 1

def is_mixed(t):
    return re.fullmatch(r'-?\d[\d,]*\s*' + FRACPAT + r'\s*.*', clean_choice(t)) is not None

def is_bare_fraction(t):
    return re.fullmatch(r'-?' + FRACPAT + r'\s*.*', clean_choice(t)) is not None

def is_reduced_fraction(t):
    m = re.fullmatch(r'-?' + FRACPAT + r'\s*', clean_choice(t))
    if not m:
        return False
    from math import gcd
    n, d = _fp_raw(m)
    return gcd(n, d) == 1

def is_proper_sci(t):
    m = re.fullmatch(r'(' + NUM + r')\s*\\times\s*10(?:\^\{?(-?\d+)\}?)?\s*', clean_choice(t))
    if not m:
        return False
    mant = abs(Decimal(m.group(1).replace(',', '')))
    return Decimal(1) <= mant < Decimal(10)

def form_decimals(n):
    return lambda t: decimals_of(t) == n

def form_sig(n):
    return lambda t: sig_digits_of(t) == n

def match_value(choices, want, form=None):
    """Which choice letters equal `want`."""
    hits = []
    for i, c in enumerate(choices):
        if form is not None and not form(c):
            continue
        # A power of ten is written as 10^k or 1/10^k, neither of which the
        # ordinary number parser reads, so it is checked before that parser.
        if isinstance(want, tuple) and want[0] == 'FTIN':
            v = ft_in(c)
            if v is not None and v == want[1]:
                hits.append('abcd'[i])
            continue
        if isinstance(want, tuple) and want[0] == 'WORDS':
            if norm_words(c) == want[1]:
                hits.append('abcd'[i])
            continue
        if isinstance(want, tuple) and want[0] == 'TEXT':
            if norm_words(c).startswith(want[1]):
                hits.append('abcd'[i])
            continue
        if isinstance(want, tuple) and want[0] == 'ODD_ONE_OUT':
            v = as_fraction(c)
            if v is not None and not isinstance(v, tuple) and v != want[1]:
                hits.append('abcd'[i])
            continue
        if isinstance(want, tuple) and want[0] == 'SCI3':
            v = as_fraction(c)
            if v is not None and not isinstance(v, tuple) and v == want[1]:
                hits.append('abcd'[i])
            continue
        if isinstance(want, tuple) and want[0] == 'POW':
            pv = power_of_ten(c)
            if pv is not None and pv == want[1]:
                hits.append('abcd'[i])
            continue
        v = as_fraction(c)
        if v is None:
            continue
        if isinstance(v, tuple) and v[0] == 'PCT':
            v = v[1]
        if isinstance(want, tuple) and want[0] == 'PCT':
            want_cmp = want[1]
        else:
            want_cmp = want
        if isinstance(v, tuple) or isinstance(want_cmp, tuple):
            if v == want_cmp:
                hits.append('abcd'[i])
            continue
        if v == want_cmp:
            hits.append('abcd'[i])
    return hits

def num(s):
    return Fraction(Decimal(s.replace(',', '').replace(' ', '')))

# --------------------------------------------------------------- matchers ----
# Each returns the value the question asks for, or None to decline.

def m_sci_to_decimal(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Write (' + NUM + r') ?\\?times ?10\^?\{?(-?\d+)\}? in decimal form\.?', body.replace('\\times', ' \\times ').replace('$', '').replace('{,}', '').strip())
    if not m:
        m2 = re.fullmatch(r'Write (' + NUM + r')\s*10\s*(-?\d+) in decimal form\.?', b)
        if not m2:
            return None
        m = m2
    return num(m.group(1)) * Fraction(10) ** int(m.group(2)), None

def m_decimal_to_sci(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Write (' + NUM + r') in scientific notation\.?', b)
    if not m:
        m = re.fullmatch(r'The scientific notation form of (' + NUM + r') is\.?', b)
    if not m:
        return None
    return num(m.group(1)), is_proper_sci

def m_round_place(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Round (' + NUM + r') to the nearest (\w+)\.?', b)
    if not m:
        return None
    places = {'whole': 0, 'unit': 0, 'one': 0, 'ones': 0, 'tenth': 1, 'hundredth': 2,
              'thousandth': 3, 'ten': -1, 'hundred': -2, 'thousand': -3}
    if m.group(2) not in places:
        return None
    p = places[m.group(2)]
    d = Decimal(m.group(1).replace(',', ''))
    q = Decimal(1).scaleb(-p)
    return Fraction(d.quantize(q, rounding=ROUND_HALF_UP)), form_decimals(max(p, 0))

WORDS = {'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8}

def m_round_sig(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Round the number to (\w+) significant digits?\.? (' + NUM + r')', b)
    if not m:
        return None
    n = WORDS.get(m.group(1))
    if not n:
        return None
    d = Decimal(m.group(2).replace(',', ''))
    if d == 0:
        return Fraction(0)
    from decimal import Context
    return Fraction(Context(prec=n, rounding=ROUND_HALF_UP).create_decimal(d)), form_sig(n)

def m_percent_to_fraction(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Change (' + NUM + r') ?% to a (fraction|decimal)\.?', b)
    if not m:
        return None
    return (num(m.group(1)) / 100), (is_reduced_fraction if m.group(2) == 'fraction' else None)

def m_fraction_to_percent(body, ch):
    raw = body.replace('\\(', '$').replace('\\)', '$')
    m = re.fullmatch(r'Change \$(-?\d*)\s*' + FRACPAT + r'\$ to a percent\.?', raw.strip())
    if not m:
        return None
    whole = int(m.group(1)) if m.group(1) else 0
    v = whole + _fp(m, 1)
    return ('PCT', v * 100), None

def m_simplify(body, ch):
    raw = body.replace('\\(', '$').replace('\\)', '$').strip()
    m = re.fullmatch(r'Simplify: \$\\?[dt]?frac\{(\d+)\}\{(\d+)\}\$', raw)
    if not m:
        return None
    return Fraction(int(m.group(1)), int(m.group(2))), is_reduced_fraction

def m_to_mixed(body, ch):
    raw = body.replace('\\(', '$').replace('\\)', '$').strip()
    m = re.fullmatch(r'Change \$\\?[dt]?frac\{(\d+)\}\{(\d+)\}\$ to a mixed number\.?', raw)
    if not m:
        return None
    return Fraction(int(m.group(1)), int(m.group(2))), is_mixed

def m_to_improper(body, ch):
    raw = body.replace('\\(', '$').replace('\\)', '$').strip()
    m = re.fullmatch(r'Change \$(\d+)\\?[dt]?frac\{(\d+)\}\{(\d+)\}\$ to an improper fraction\.?', raw)
    if not m:
        return None
    return int(m.group(1)) + Fraction(int(m.group(2)), int(m.group(3))), is_bare_fraction

def m_common_fraction_to_decimal(body, ch):
    raw = body.replace('\\(', '$').replace('\\)', '$')
    m = re.search(r'Change the common fraction to decimal\..*?\\?[dt]?frac\{(\d+)\}\{(\d+)\}', raw, re.S)
    if not m:
        return None
    return Fraction(int(m.group(1)), int(m.group(2))), None

def m_calcstack(body, ch):
    m = re.search(r'\\calcstack\{(.+?)\}', body, re.S)
    if not m:
        return None
    rows = [r.strip() for r in m.group(1).replace('\\hline', '').split('\\\\') if r.strip()]
    op = '+'
    total = None
    for r in rows:
        r = r.replace('\\,', '').replace('{,}', '').replace(',', '').strip()
        sign = None
        if r.startswith('+'):
            sign, r = '+', r[1:].strip()
        elif r.startswith('-'):
            sign, r = '-', r[1:].strip()
        if not re.fullmatch(r'\d+(\.\d+)?', r):
            return None
        v = Fraction(Decimal(r))
        if total is None:
            total = v
        else:
            total = total + v if (sign or op) == '+' else total - v
        if sign:
            op = sign
    # The operation is named above the stack; a subtraction stack has a - row.
    return total, None

def m_inline_arith(body, ch):
    b = strip_tex(body)
    # Multiply / Divide / sum written inline
    m = re.search(r'(' + NUM + r')\s*(?:\\times|×)\s*(' + NUM + r')', body.replace('{,}', ''))
    if m and re.match(r'\s*Multiply', b):
        return num(m.group(1)) * num(m.group(2)), None
    m = re.search(r'(' + NUM + r')\s*(?:\\div|÷)\s*(' + NUM + r')', body.replace('{,}', ''))
    if m and re.match(r'\s*Divide', b) and 'remainder' not in b.lower():
        return num(m.group(1)) / num(m.group(2)), None
    return None

def m_divide_remainder(body, ch):
    b = strip_tex(body)
    if 'remainder form' not in b:
        return None
    m = re.search(r'(\d[\d,]*)\s*(?:\\div|÷)\s*(\d+)', body.replace('{,}', ''))
    if not m:
        return None
    a, d = int(m.group(1).replace(',', '')), int(m.group(2))
    return ('R', a // d, a % d), None

def m_signed_chain(body, ch):
    """8+(-1)+(-9)+(-14)+35   and   -7+6-8-3+4-9-1"""
    b = strip_tex(body)
    if not re.search(r'(Compute the value|Perform the indicated operation|Find the sum|Add|Subtract)', b, re.I):
        return None
    m = re.search(r'\$([^$]*)\$', body.replace('\\displaystyle', ''))
    expr = m.group(1) if m else None
    if not expr:
        m = re.search(r'centerline\{([^}]*)\}', body)
        expr = m.group(1) if m else None
    if not expr:
        return None
    expr = expr.replace('{,}', '').replace(',', '').replace('\\,', '').replace(' ', '')
    if not re.fullmatch(r'[-+()\d]+', expr):
        return None
    try:
        return Fraction(eval(expr, {'__builtins__': {}}, {})), None
    except Exception:
        return None

def m_sign_product(body, ch):
    """(-3)(-4)(-5)(-2)(-2)(+3)"""
    b = strip_tex(body)
    if not re.match(r'\s*Multiply', b):
        return None
    m = re.search(r'centerline\{\$([^$]*)\$\}', body)
    expr = m.group(1) if m else None
    if not expr or ')(' not in expr:
        return None
    nums = re.findall(r'\(([-+]?\d+)\)', expr.replace(' ', ''))
    if len(nums) < 2:
        return None
    out = Fraction(1)
    for n in nums:
        out *= Fraction(int(n))
    return out, None

# --- unit conversions inside one system -------------------------------------
UNITS = {   # to a base unit
    'in': Fraction(1), 'ft': Fraction(12), 'yd': Fraction(36), 'mi': Fraction(63360),
    'oz': Fraction(1), 'lb': Fraction(16), 'ton': Fraction(32000),
    'sec': Fraction(1), 'min': Fraction(60), 'hr': Fraction(3600), 'h': Fraction(3600),
    'pt': Fraction(1), 'qt': Fraction(2), 'gal': Fraction(8),
}
FAMILY = {'in': 'len', 'ft': 'len', 'yd': 'len', 'mi': 'len',
          'oz': 'wt', 'lb': 'wt', 'ton': 'wt',
          'sec': 't', 'min': 't', 'hr': 't', 'h': 't',
          'pt': 'v', 'qt': 'v', 'gal': 'v'}

def m_unit_change(body, ch):
    """Change 10 ft 6 in = ____ in."""
    b = strip_tex(body).rstrip(' .')
    m = re.fullmatch(r'Change ((?:' + NUM + r'\s+[a-z]+\.?\s*)+)=\s*([a-z]+)', b)
    if not m:
        return None
    pairs = [(a, u.rstrip('.')) for a, u in re.findall(r'(' + NUM + r')\s+([a-z]+\.?)', m.group(1))]
    target = m.group(2)
    if target not in UNITS or not pairs:
        return None
    fams = {FAMILY.get(u) for _, u in pairs} | {FAMILY.get(target)}
    if None in fams or len(fams) != 1:
        return None
    base = sum(num(v) * UNITS[u] for v, u in pairs)
    return base / UNITS[target], None

# --- laws of exponents: everything is a power of ten ------------------------

def m_exponent_laws(body, ch):
    """Powers of ten only, in the four shapes the paper uses:
         (10^a / 10^b)^k     1 / 10^a     (10^a)^b     10^a div/times 10^b
       The result is wanted with a positive exponent, so a negative result must
       be written as 1/10^k -- which is a form question as well as a value one."""
    if 'laws of exponents' not in strip_tex(body):
        return None
    m = re.search(r'centerline\{(.*)\}\s*$', body, re.S)
    if not m:
        return None
    x = m.group(1).replace('\\displaystyle', '').replace('\\left', '').replace('\\right', '')
    x = x.replace('$', '').strip()
    P = r'10\^\{?(-?\d+)\}?'
    e = None

    mm = re.fullmatch(r'\(\s*\\[dt]?frac\{' + P + r'\}\{' + P + r'\}\s*\)\s*\^\{?(-?\d+)\}?', x)
    if mm:
        e = (int(mm.group(1)) - int(mm.group(2))) * int(mm.group(3))
    if e is None:
        mm = re.fullmatch(r'\\[dt]?frac\{1\}\{' + P + r'\}', x)
        if mm:
            e = -int(mm.group(1))
    if e is None:
        mm = re.fullmatch(r'\\[dt]?frac\{' + P + r'\}\{' + P + r'\}', x)
        if mm:
            e = int(mm.group(1)) - int(mm.group(2))
    if e is None:
        mm = re.fullmatch(r'\(\s*' + P + r'\s*\)\s*\^\{?(-?\d+)\}?', x)
        if mm:
            e = int(mm.group(1)) * int(mm.group(2))
    if e is None:
        mm = re.fullmatch(P + r'\s*\\div\s*' + P, x)
        if mm:
            e = int(mm.group(1)) - int(mm.group(2))
    if e is None:
        mm = re.fullmatch(P + r'\s*(?:\\times|\\cdot)\s*' + P, x)
        if mm:
            e = int(mm.group(1)) + int(mm.group(2))
    if e is None:
        return None

    def form(t):
        t = t.strip()
        as_frac = re.fullmatch(r'\$?\s*\\[dt]?frac\{1\}\{10\^\{?(-?\d+)\}?\}\s*\$?', t)
        as_pow = re.fullmatch(r'\$?\s*10\^\{?(-?\d+)\}?\s*\$?', t)
        if e < 0:
            return bool(as_frac) and int(as_frac.group(1)) > 0
        return bool(as_pow) and int(as_pow.group(1)) >= 0

    return ('POW', Fraction(10) ** e), form

# ===================== second batch of matchers =============================
# Everything below re-derives an answer from the question text. Where two
# options are numerically equal, a form check decides between them.

from math import gcd

def _lcm(a, b):
    return a * b // gcd(a, b)

# --- number words -----------------------------------------------------------

ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
        'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
        'seventeen', 'eighteen', 'nineteen']
TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
PLACES = {'tenths': 1, 'hundredths': 2, 'thousandths': 3, 'ten thousandths': 4,
          'hundred thousandths': 5, 'millionths': 6}

def int_words(n):
    """0..999999 in words, no 'and' anywhere -- 'and' is the decimal point."""
    if n < 20:
        return ONES[n]
    if n < 100:
        t, r = divmod(n, 10)
        return TENS[t] + ('-' + ONES[r] if r else '')
    if n < 1000:
        h, r = divmod(n, 100)
        return ONES[h] + ' hundred' + (' ' + int_words(r) if r else '')
    th, r = divmod(n, 1000)
    return int_words(th) + ' thousand' + (' ' + int_words(r) if r else '')

def norm_words(s):
    s = s.lower().replace('-', ' ').replace('.', ' ')
    s = re.sub(r'[^a-z ]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

WORD_VALUE = {w: i for i, w in enumerate(ONES)}
WORD_VALUE.update({w: i * 10 for i, w in enumerate(TENS) if w})

def words_to_int(text):
    """'three hundred five' -> 305. None if it is not a plain integer phrase."""
    words = norm_words(text).split()
    if not words:
        return None
    total, chunk = 0, 0
    for w in words:
        if w in WORD_VALUE:
            chunk += WORD_VALUE[w]
        elif w == 'hundred':
            chunk = (chunk or 1) * 100
        elif w == 'thousand':
            total += (chunk or 1) * 1000
            chunk = 0
        else:
            return None
    return total + chunk

def words_to_number(phrase):
    """'five hundred and sixty-three thousandths' -> Fraction(500063, 1000).

    'and' marks the decimal point -- the rule the worksheet is teaching -- so
    everything before it is whole and everything after it is the fraction."""
    p = norm_words(phrase)
    place = None
    for name in sorted(PLACES, key=len, reverse=True):
        if p.endswith(' ' + name) or p == name:
            place = name
            p = p[: len(p) - len(name)].strip()
            break
    if place is None:
        return None
    if ' and ' in p:
        whole_txt, frac_txt = p.split(' and ', 1)
        whole = words_to_int(whole_txt)
    else:
        whole, frac_txt = 0, p
    frac = words_to_int(frac_txt)
    if whole is None or frac is None:
        return None
    return Fraction(whole) + Fraction(frac, 10 ** PLACES[place])

def number_to_words(dec):
    """12.048 -> 'twelve and forty-eight thousandths'."""
    sign, digits, exp = dec.as_tuple()
    s = str(abs(dec))
    if '.' not in s:
        return int_words(int(s))
    whole_s, frac_s = s.split('.')
    place = len(frac_s)
    name = {v: k for k, v in PLACES.items()}.get(place)
    if name is None:
        return None
    frac_val = int(frac_s)
    words = int_words(frac_val) + ' ' + name
    whole = int(whole_s)
    if whole:
        words = int_words(whole) + ' and ' + words
    return words

def m_words_to_decimal(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Write the number as a decimal\.\s*(.+?)\.?', b)
    if not m:
        return None
    v = words_to_number(m.group(1))
    return None if v is None else (v, None)

def m_decimal_to_words(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Write (?:the decimal )?(' + NUM + r') in words\.?', b)
    if not m:
        m = re.fullmatch(r'Write the decimal in words\.\s*(' + NUM + r')', b)
    if not m:
        return None
    want = number_to_words(Decimal(m.group(1).replace(',', '')))
    if want is None:
        return None
    return ('WORDS', norm_words(want)), None

# --- fractions --------------------------------------------------------------

def _frac_in(text):
    m = re.search(r'\\[dt]?frac\{(\d+)\}\{(\d+)\}', text)
    if m:
        return Fraction(int(m.group(1)), int(m.group(2)))
    m = re.search(r'\\[dt]?frac(\d)(\d)', text)          # \dfrac34
    if m:
        return Fraction(int(m.group(1)), int(m.group(2)))
    return None

def _mixed_in(text):
    m = re.search(r'(\d+)\s*\\[dt]?frac\{(\d+)\}\{(\d+)\}', text)
    if m:
        return int(m.group(1)) + Fraction(int(m.group(2)), int(m.group(3)))
    return None

def is_simplified(t):
    """A simplified answer is either a reduced bare fraction, or a mixed number
    whose fractional part is proper and reduced. 'Simplify 4 18/5' offers both
    7 3/5 and 4 18/5 -- equal in value, and only the first is simplified."""
    c = clean_choice(t)
    m = re.fullmatch(r'(-?\d[\d,]*)\s*' + FRACPAT + r'\s*', c)
    if m:
        n, d = _fp_raw(m, 1)
        return n < d and gcd(n, d) == 1
    m = re.fullmatch(r'-?' + FRACPAT + r'\s*', c)
    if m:
        n, d = _fp_raw(m)
        return gcd(n, d) == 1
    return re.fullmatch(NUM, strip_units(c)) is not None      # a whole number is simplified

def m_equivalent_not(body, ch):
    b = strip_tex(body)
    if 'not' not in body.lower() or 'equivalent' not in b.lower():
        return None
    base = _frac_in(body)
    if base is None:
        return None
    return ('ODD_ONE_OUT', base), None

def m_equivalent_write(body, ch):
    b = strip_tex(body)
    if not re.match(r'Write (an|the) equivalent fraction', b):
        return None
    base = _frac_in(body)
    return None if base is None else (base, None)

def m_simplify_general(body, ch):
    b = strip_tex(body)
    if not re.match(r'Simplify', b):
        return None
    mixed_in = re.search(r'Simplify:?\s*(?:\$|\\\()?\s*(\d+)\\[dt]?frac\{(\d+)\}\{(\d+)\}', body)
    if mixed_in:
        v = int(mixed_in.group(1)) + Fraction(int(mixed_in.group(2)), int(mixed_in.group(3)))
        return v, is_simplified
    base = _frac_in(body)
    if base is None:
        return None
    if 'mixed number' in b:
        return base, is_mixed
    return base, is_reduced_fraction

def m_fraction_chain(body, ch):
    if 'simplest form' not in strip_tex(body):
        return None
    m = re.search(r'centerline\{(.*)\}', body, re.S)
    if not m:
        return None
    x = m.group(1).replace('\\displaystyle', '')
    parts = re.findall(r'(\\div|\\times)?\s*\\[dt]?frac\{(\d+)\}\{(\d+)\}', x)
    if len(parts) < 2:
        return None
    total = None
    for op, a, b_ in parts:
        f = Fraction(int(a), int(b_))
        if total is None:
            total = f
        elif op == '\\div':
            total /= f
        else:
            total *= f
    return total, None

def m_lcd(body, ch):
    b = strip_tex(body)
    if not re.match(r'Find the LCD', b):
        return None
    dens = [int(d) for _, d in re.findall(r'\\[dt]?frac\{(\d+)\}\{(\d+)\}', body)]
    if len(dens) < 2:
        return None
    out = dens[0]
    for d in dens[1:]:
        out = _lcm(out, d)
    return Fraction(out), None

def m_decimal_to_fraction(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Change the decimal (' + NUM + r') to a common fraction or a mixed number\.?', b)
    if not m:
        return None
    return num(m.group(1)), None

def m_improper_to_decimal(body, ch):
    b = strip_tex(body)
    if 'improper fraction' not in b or 'decimal' not in b:
        return None
    f = _frac_in(body)
    if f is None:
        return None
    places = 2 if 'hundredth' in b else None
    if places is None:
        return None
    d = (Decimal(f.numerator) / Decimal(f.denominator)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return Fraction(d), form_decimals(2)

def m_common_fraction_to_decimal2(body, ch):
    b = strip_tex(body)
    if not re.match(r'Change the common fraction to a? ?decimal', b):
        return None
    f = _frac_in(body)
    return None if f is None else (f, None)

# --- rounding, other phrasings ---------------------------------------------

PLACE_DP = {'whole': 0, 'unit': 0, 'one': 0, 'ones': 0, 'tenth': 1, 'hundredth': 2,
            'thousandth': 3, 'ten': -1, 'hundred': -2, 'thousand': -3}

def m_round_any(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Round (?:the number )?(' + NUM + r') to the nearest (\w+)\.?', b)
    if not m:
        m2 = re.fullmatch(r'Round the number to the nearest (\w+)\.\s*(' + NUM + r')', b)
        if not m2:
            return None
        place, number = m2.group(1), m2.group(2)
    else:
        number, place = m.group(1), m.group(2)
    if place not in PLACE_DP:
        return None
    p = PLACE_DP[place]
    d = Decimal(number.replace(',', ''))
    q = Decimal(1).scaleb(-p)
    return Fraction(d.quantize(q, rounding=ROUND_HALF_UP)), form_decimals(max(p, 0))

def m_round_sig_any(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Round the number (' + NUM + r') to (\w+) significant digits?\.?', b)
    if not m:
        m = re.fullmatch(r'Round the number to (\w+) significant digits?\.?\s*(' + NUM + r')', b)
        if not m:
            return None
        n, number = WORDS.get(m.group(1)), m.group(2)
    else:
        number, n = m.group(1), WORDS.get(m.group(2))
    if not n:
        return None
    from decimal import Context
    d = Decimal(number.replace(',', ''))
    return Fraction(Context(prec=n, rounding=ROUND_HALF_UP).create_decimal(d)), form_sig(n)

# --- percents ---------------------------------------------------------------

def m_percent_any(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Change (?:percent )?(' + NUM + r')\s*\\?% to (?:a )?(fraction|decimal|mixed number)\.?', b)
    if not m:
        return None
    v = num(m.group(1)) / 100
    kind = m.group(2)
    if kind == 'fraction':
        return v, is_reduced_fraction
    if kind == 'mixed number':
        return v, is_mixed
    return v, None

def m_decimal_to_percent(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Change (?:the )?decimal (' + NUM + r') to (?:a )?percent\.?', b)
    if not m:
        return None
    return ('PCT', num(m.group(1)) * 100), None

# --- signs ------------------------------------------------------------------

def m_sign_rule(body, ch):
    b = strip_tex(body).lower()
    m = re.match(r'if two numbers have (different|same) signs,? then their (products?|quotients?)\b', b)
    if not m:
        return None
    negative = m.group(1) == 'different'
    return ('TEXT', 'always negative' if negative else 'always positive'), None

def m_whole_div_fraction(body, ch):
    """Divide 32 by 3/7."""
    m = re.search(r'Divide\s*\\?\(?\$?\s*(\d[\d,]*)\s*\\div\s*' + FRACPAT, body)
    if not m:
        return None
    return num(m.group(1)) / _fp(m, 1), None

def m_divide_signed(body, ch):
    b = strip_tex(body)
    if not re.match(r'Divide', b):
        return None
    m = re.search(r'\\[dt]?frac\{(-?\d+)\}\{(-?\d+)\}', body)
    if m:
        return Fraction(int(m.group(1)), int(m.group(2))), None
    m = re.search(r'\(([-+]?\d+)\)\s*\\div\s*\(([-+]?\d+)\)', body)
    if m:
        return Fraction(int(m.group(1)), int(m.group(2))), None
    return None

# --- scientific notation, more phrasings ------------------------------------

def m_convert_sci(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Convert (' + NUM + r') into scientific notation\.?', b)
    if not m:
        return None
    return num(m.group(1)), is_proper_sci

def balanced_frac(x):
    """Split \\frac{A}{B} where A and B may themselves contain braces."""
    m = re.search(r'\\[dt]?frac\s*\{', x)
    if not m:
        return None
    def grab(i):
        depth, out = 0, []
        while i < len(x):
            c = x[i]
            if c == '{':
                depth += 1
                if depth == 1:
                    i += 1
                    continue
            elif c == '}':
                depth -= 1
                if depth == 0:
                    return ''.join(out), i + 1
            out.append(c)
            i += 1
        return None, i
    top, j = grab(m.end() - 1)
    if top is None:
        return None
    while j < len(x) and x[j] != '{':
        if not x[j].isspace():
            return None
        j += 1
    bottom, _ = grab(j)
    return None if bottom is None else (top, bottom)

def m_sci_arith(body, ch):
    b = strip_tex(body)
    if 'significant digits' not in b or 'indicated operation' not in b:
        return None
    m = re.search(r'centerline\{(.*)\}', body, re.S)
    if not m:
        return None
    x = m.group(1).replace('\\displaystyle', '')
    T = r'\(?\s*(' + NUM + r')\s*\\times\s*10\^\{?(-?\d+)\}?\s*\)?'

    def product(text):
        out = Fraction(1)
        found = re.findall(T, text)
        if not found:
            return None
        for mant, ex in found:
            out *= Fraction(Decimal(mant)) * Fraction(10) ** int(ex)
        return out

    fr = balanced_frac(x)
    if fr:
        top, bottom = product(fr[0]), product(fr[1])
        if top is None or bottom is None:
            return None
        val = top / bottom
    else:
        val = product(x)
        if val is None:
            return None
    from decimal import Context
    d = Context(prec=3, rounding=ROUND_HALF_UP).create_decimal(
        Decimal(val.numerator) / Decimal(val.denominator))
    return ('SCI3', Fraction(d)), is_proper_sci

def m_exponent_chain(body, ch):
    """10^{2}\\cdot10^{-3}\\cdot10^{4} and similar flat chains."""
    if 'laws of exponents' not in strip_tex(body):
        return None
    m = re.search(r'centerline\{(.*)\}\s*$', body, re.S)
    if not m:
        return None
    x = m.group(1).replace('\\displaystyle', '').replace('$', '').strip()
    if '\\frac' in x or '\\dfrac' in x or '(' in x:
        return None
    parts = re.split(r'(\\cdot|\\times|\\div)', x)
    if len(parts) < 3:
        return None
    e, op = None, None
    for p in parts:
        p = p.strip()
        if p in ('\\cdot', '\\times', '\\div'):
            op = p
            continue
        mm = re.fullmatch(r'10\^\{?(-?\d+)\}?', p)
        if not mm:
            return None
        k = int(mm.group(1))
        if e is None:
            e = k
        else:
            e = e - k if op == '\\div' else e + k

    def form(t):
        t = t.strip()
        as_frac = re.fullmatch(r'\$?\s*\\[dt]?frac\{1\}\{10\^\{?(-?\d+)\}?\}\s*\$?', t)
        as_pow = re.fullmatch(r'\$?\s*10\^\{?(-?\d+)\}?\s*\$?', t)
        if e < 0:
            return bool(as_frac) and int(as_frac.group(1)) > 0
        return bool(as_pow) and int(as_pow.group(1)) >= 0

    return ('POW', Fraction(10) ** e), form

# --- arithmetic word problems ----------------------------------------------

def m_round_sig_short(body, ch):
    """Round 0.00637567 to 4 significant digits.  (digit, not a word)"""
    b = strip_tex(body)
    m = re.fullmatch(r'Round (' + NUM + r') to (\w+) significant digits?\.?', b)
    if not m:
        return None
    word = m.group(2)
    n = WORDS.get(word) or (int(word) if word.isdigit() else None)
    if not n:
        return None
    from decimal import Context
    d = Decimal(m.group(1).replace(',', ''))
    return Fraction(Context(prec=n, rounding=ROUND_HALF_UP).create_decimal(d)), form_sig(n)

def m_price_each(body, ch):
    """A set of three cranes costs $564,800. Price per crane, to the nearest unit."""
    b = strip_tex(body)
    m = re.search(r'A set of (\w+) [\w ]*?(?:costs|cost) \$?(' + NUM + r')', b)
    if not m:
        return None
    count = WORDS.get(m.group(1)) or (int(m.group(1)) if m.group(1).isdigit() else None)
    if not count:
        return None
    total = num(m.group(2))
    if 'nearest unit' not in b:
        return None
    d = (Decimal(total.numerator) / Decimal(total.denominator) / Decimal(count)).quantize(
        Decimal(1), rounding=ROUND_HALF_UP)
    return Fraction(d), form_decimals(0)

def m_exponent_frac_chain(body, ch):
    """A \\frac whose halves are each a product of powers of ten, optionally
    raised to an outer power."""
    if 'laws of exponents' not in strip_tex(body):
        return None
    m = re.search(r'centerline\{(.*)\}\s*$', body, re.S)
    if not m:
        return None
    x = m.group(1).replace('\\displaystyle', '').replace('\\left', '').replace('\\right', '')
    fr = balanced_frac(x)
    if not fr:
        return None
    def total(part):
        ps = re.findall(r'10\^\{?(-?\d+)\}?', part)
        return None if not ps else sum(int(k) for k in ps)
    top, bottom = total(fr[0]), total(fr[1])
    if top is None or bottom is None:
        return None
    e = top - bottom
    outer = re.search(r'\}\s*\^\{?(-?\d+)\}?\s*$', x)
    if outer:
        e *= int(outer.group(1))

    def form(t):
        t = clean_choice(t)
        as_frac = re.fullmatch(r'\\[dt]?frac\{1\}\{10\^\{?(-?\d+)\}?\}\s*', t)
        as_pow = re.fullmatch(r'10\^\{?(-?\d+)\}?\s*', t)
        if e < 0:
            return bool(as_frac) and int(as_frac.group(1)) > 0
        return bool(as_pow) and int(as_pow.group(1)) >= 0

    return ('POW', Fraction(10) ** e), form

def m_subtract_from(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'Subtract (' + NUM + r') from (' + NUM + r')\.?', b)
    if not m:
        return None
    return num(m.group(2)) - num(m.group(1)), None

def m_pile(body, ch):
    b = strip_tex(body)
    m = re.fullmatch(r'How high is a pile of (' + NUM + r') metal sheets if each sheet is (' + NUM + r') in\.? thick\?', b)
    if not m:
        return None
    return num(m.group(1)) * num(m.group(2)), None

def m_gas_consumption(body, ch):
    b = strip_tex(body)
    m = re.search(r'travels (' + NUM + r') km and uses (' + NUM + r') L', b)
    if not m:
        return None
    return num(m.group(1)) / num(m.group(2)), None

def m_cylinder_used(body, ch):
    b = strip_tex(body)
    m = re.search(r'ordered a (' + NUM + r')\s*-?\s*(?:cylinder|\w* cylinder).*?only (' + NUM + r') remained', b)
    if not m:
        return None
    return num(m.group(1)) - num(m.group(2)), None

def m_rod_remainder(body, ch):
    b = strip_tex(body)
    m = re.search(r'rod (' + NUM + r') ft long is cut into four pieces\. The first three pieces are (' + NUM + r') ft, (' + NUM + r') ft, and (' + NUM + r') ft', b)
    if not m:
        return None
    total = num(m.group(1))
    return total - (num(m.group(2)) + num(m.group(3)) + num(m.group(4))), None

def m_pipe_total(body, ch):
    b = strip_tex(body)
    if 'lengths of' not in b or 'pieces' not in b:
        return None
    pairs = re.findall(r'(\d[\d,]*) pieces (\d[\d,]*) ft long', b)
    if len(pairs) < 2:
        return None
    return Fraction(sum(int(a.replace(',', '')) * int(l.replace(',', '')) for a, l in pairs)), None

# --- more unit conversions --------------------------------------------------

UNIT_WORD = {'inches': 'in', 'inch': 'in', 'feet': 'ft', 'foot': 'ft', 'yards': 'yd',
             'miles': 'mi', 'ounces': 'oz', 'pounds': 'lb', 'tons': 'ton',
             'in': 'in', 'ft': 'ft', 'yd': 'yd', 'mi': 'mi', 'oz': 'oz', 'lb': 'lb'}

def m_change_units_words(body, ch):
    """Change 7 yd to inches.   /   Change 96 in to ft."""
    b = strip_tex(body).rstrip(' .')
    m = re.fullmatch(r'Change (' + NUM + r')\s+([a-z]+) to ([a-z]+)', b)
    if not m:
        return None
    src = UNIT_WORD.get(m.group(2))
    dst = UNIT_WORD.get(m.group(3))
    if not src or not dst or FAMILY.get(src) != FAMILY.get(dst):
        return None
    return num(m.group(1)) * UNITS[src] / UNITS[dst], None

def m_convert_question(body, ch):
    """A plane at 26,400 ft -- how many miles?  /  8 lb of refrigerant -- ounces?"""
    b = strip_tex(body)
    m = re.search(r'(' + NUM + r')\s*(ft|lb|in|oz|yd|mi)\b.*?How many (\w+)', b, re.S)
    if not m:
        return None
    src = UNIT_WORD.get(m.group(2))
    dst = UNIT_WORD.get(m.group(3))
    if not src or not dst or FAMILY.get(src) != FAMILY.get(dst):
        return None
    return num(m.group(1)) * UNITS[src] / UNITS[dst], None

def m_remainder_any(body, ch):
    b = strip_tex(body)
    if 'remainder' not in b.lower():
        return None
    m = re.search(r'(\d[\d,]*)\s*(?:\\div|÷)\s*(\d+)', body.replace('{,}', ''))
    if not m:
        return None
    a, d = int(m.group(1).replace(',', '')), int(m.group(2))
    return ('R', a // d, a % d), None

def _pow_expr(x, i=0):
    """Recursive-descent over powers of ten. Returns (exponent, next index).

    Handles 10^{k}, (expr)^{k}, \\frac{expr}{expr}, and chains joined by
    \\cdot, \\times or \\div. Written out rather than pattern-matched because
    (10^{-3})^{-9} multiplies its exponents while 10^{3}\\cdot10^{-2} adds
    them, and one regex cannot tell those apart.
    """
    e, i = _pow_factor(x, i)
    if e is None:
        return None, i
    while i < len(x):
        m = re.match(r'\s*(\\cdot|\\times|\\div)\s*', x[i:])
        if not m:
            break
        op = m.group(1)
        j = i + m.end()
        rhs, j = _pow_factor(x, j)
        if rhs is None:
            return None, i
        e = e - rhs if op == '\\div' else e + rhs
        i = j
    return e, i


def _grab_group(x, i):
    """The contents of the {...} starting at i, and the index after it."""
    if i >= len(x) or x[i] != '{':
        return None, i
    depth, start = 0, i
    while i < len(x):
        if x[i] == '{':
            depth += 1
        elif x[i] == '}':
            depth -= 1
            if depth == 0:
                return x[start + 1:i], i + 1
        i += 1
    return None, i


def _trailing_power(x, i):
    """An optional ^{k} at position i."""
    m = re.match(r'\s*\^\s*\{?(-?\d+)\}?', x[i:])
    return (int(m.group(1)), i + m.end()) if m else (1, i)


def _pow_factor(x, i):
    m = re.match(r'\s*', x[i:])
    i += m.end()
    if i >= len(x):
        return None, i

    # \frac{...}{...}
    m = re.match(r'\\[dt]?frac\s*', x[i:])
    if m:
        j = i + m.end()
        top, j = _grab_group(x, j)
        if top is None:
            return None, i
        m2 = re.match(r'\s*', x[j:])
        j += m2.end()
        bottom, j = _grab_group(x, j)
        if bottom is None:
            return None, i
        te, _ = _pow_expr(top.strip(), 0)
        be, _ = _pow_expr(bottom.strip(), 0)
        if te is None or be is None:
            return None, i
        k, j = _trailing_power(x, j)
        return (te - be) * k, j

    # ( expr ) ^ k
    if x[i] == '(':
        depth, start = 0, i
        while i < len(x):
            if x[i] == '(':
                depth += 1
            elif x[i] == ')':
                depth -= 1
                if depth == 0:
                    break
            i += 1
        if i >= len(x):
            return None, start
        inner = x[start + 1:i]
        ie, _ = _pow_expr(inner.strip(), 0)
        if ie is None:
            return None, start
        k, j = _trailing_power(x, i + 1)
        return ie * k, j

    # 10^{k}  or  10
    m = re.match(r'10\s*\^\s*\{?(-?\d+)\}?', x[i:])
    if m:
        return int(m.group(1)), i + m.end()
    m = re.match(r'10(?![\d^])', x[i:])
    if m:
        return 1, i + m.end()
    m = re.match(r'1(?![\d^])', x[i:])
    if m:
        return 0, i + m.end()
    return None, i


def m_powers_of_ten(body, ch):
    """Every 2-5.1 question: evaluate the expression, then insist the answer is
    written with a positive exponent as the question asks."""
    if 'laws of exponents' not in strip_tex(body):
        return None
    m = re.search(r'centerline\{(.*)\}\s*$', body, re.S)
    if not m:
        return None
    x = m.group(1)
    for junk in ('\\displaystyle', '\\left', '\\right', '$', '\\,'):
        x = x.replace(junk, '')
    e, end = _pow_expr(x.strip(), 0)
    if e is None or x.strip()[end:].strip():
        return None                      # refuse anything not fully consumed

    def form(t):
        t = clean_choice(t)
        as_frac = re.fullmatch(r'\\[dt]?frac\{1\}\{10\^\{?(-?\d+)\}?\}\s*', t)
        as_pow = re.fullmatch(r'10\^\{?(-?\d+)\}?\s*', t)
        plain = re.fullmatch(r'(1|10)\s*', t)
        if e < 0:
            return bool(as_frac) and int(as_frac.group(1)) > 0
        if e in (0, 1) and plain:
            return True
        return bool(as_pow) and int(as_pow.group(1)) >= 0

    return ('POW', Fraction(10) ** e), form

# ===================== third batch: the last 65 ==============================

def quantities(text):
    """Every fraction or mixed number in a span, in order."""
    out = []
    for m in re.finditer(r'(?:(\d+)\s*)?' + FRACPAT, text):
        whole = int(m.group(1)) if m.group(1) else 0
        out.append(Fraction(whole) + _fp(m, 1))
    return out

def ft_in(text):
    """'6 ft 8 in' as inches."""
    m = re.fullmatch(r'(\d+)\s*ft\.?\s*(\d+)\s*in\.?\s*', clean_choice(text))
    return Fraction(int(m.group(1)) * 12 + int(m.group(2))) if m else None

# --- fraction word problems -------------------------------------------------

def m_barrel_fraction(body, ch):
    b = strip_tex(body)
    m = re.search(r'capacity of (' + NUM + r')\s*\w*\.?\s*How many .*?when it is', b, re.S)
    if not m:
        return None
    fr = quantities(body)
    if len(fr) != 1:
        return None
    return num(m.group(1)) * fr[0], None

def m_welded_total(body, ch):
    b = strip_tex(body)
    if 'welded together' not in b:
        return None
    fr = quantities(body)
    if len(fr) != 3:
        return None
    return sum(fr, Fraction(0)), None

def m_fuel_difference(body, ch):
    b = strip_tex(body)
    if 'difference in the fuel' not in b:
        return None
    fr = quantities(body)
    if len(fr) != 2:
        return None
    return abs(fr[0] - fr[1]), None

def m_subtract_mixed(body, ch):
    b = strip_tex(body)
    if not re.match(r'Subtract .* from ', b):
        return None
    fr = quantities(body)
    if len(fr) != 2:
        return None
    return fr[1] - fr[0], None

def m_add_two(body, ch):
    b = strip_tex(body)
    if not re.match(r'Add:', b):
        return None
    fr = quantities(body)
    if len(fr) != 2:
        return None
    return sum(fr, Fraction(0)), None

def m_service_time(body, ch):
    b = strip_tex(body)
    if 'total time was spent servicing' not in b:
        return None
    fr = quantities(body)
    if len(fr) != 3:
        return None
    return sum(fr, Fraction(0)), None

def m_shaft_ft_to_inches(body, ch):
    b = strip_tex(body)
    if not re.search(r'shaft .* ft long to inches', b):
        return None
    fr = quantities(body)
    if len(fr) != 1:
        return None
    m = re.search(r'shaft (\d+)', b)
    whole = Fraction(int(m.group(1))) if m and Fraction(int(m.group(1))) != fr[0] else Fraction(0)
    # quantities() already folds a leading whole number into the mixed value
    return fr[0] * 12, None

def m_rod_pieces(body, ch):
    b = strip_tex(body)
    m = re.search(r'rod (' + NUM + r') ft long is cut into four pieces: the first (' + NUM +
                  r') ft long, the second (' + NUM + r') ft long, and the third (' + NUM + r') ft long', b)
    if not m:
        return None
    return num(m.group(1)) - (num(m.group(2)) + num(m.group(3)) + num(m.group(4))), None

# --- compound and dotted unit conversions -----------------------------------

def m_height_ft_in(body, ch):
    b = strip_tex(body)
    m = re.search(r'is (' + NUM + r') in\.? in height\. Find its height in feet and inches', b)
    if not m:
        return None
    return ('FTIN', num(m.group(1))), None

def m_change_units_dotted(body, ch):
    """Change 7 mi. to ft.   /   Change 18480 ft. to mi."""
    b = strip_tex(body).rstrip(' .')
    m = re.fullmatch(r'Change (' + NUM + r')\s*([a-z]+)\.?\s+to\s+([a-z]+)', b)
    if not m:
        return None
    src = UNIT_WORD.get(m.group(2).rstrip('.'))
    dst = UNIT_WORD.get(m.group(3).rstrip('.'))
    if not src or not dst or FAMILY.get(src) != FAMILY.get(dst):
        return None
    return num(m.group(1)) * UNITS[src] / UNITS[dst], None

# --- the two malformed-operator shapes, once the bank is fixed --------------

def m_multiply_inline(body, ch):
    b = strip_tex(body)
    if not re.match(r'\s*Multiply', b):
        return None
    m = re.search(r'(' + NUM + r')\s*\\times\s*(' + NUM + r')', body.replace('{,}', ''))
    if not m:
        return None
    return num(m.group(1)) * num(m.group(2)), None

# --- diagrams ---------------------------------------------------------------

def m_circuit_total(body, ch, q=None):
    b = strip_tex(body)
    if 'total resistance' not in b:
        return None
    vals = []
    # values carried as structured data
    if q and isinstance(q.get('diagram'), dict) and q['diagram'].get('type') == 'circuit':
        for side in ('top', 'bottom'):
            vals += [v for _, v in q['diagram'].get(side, [])]
    # or inline in the picture: \foreach \x/\r/\v in {0.7/1/420, ...}
    if not vals:
        for lst in re.findall(r'\\foreach\s*\\x/\\r/\\v\s*in\s*\{([^}]*)\}', body):
            for triple in lst.split(','):
                parts = triple.strip().split('/')
                if len(parts) == 3 and re.fullmatch(r'\d+', parts[2]):
                    vals.append(int(parts[2]))
    if len(vals) < 2:
        return None
    return Fraction(sum(vals)), None

def tikz_labels(body):
    return re.findall(r'\{\\scriptsize\s+(.*?)\}\s*;', body, re.S)

def m_shaft_from_picture(body, ch):
    b = strip_tex(body)
    if 'length of the shaft' not in b:
        return None
    for lab in tikz_labels(body):
        if lab.count('+') >= 1:
            fr = quantities(lab)
            if len(fr) >= 2:
                return sum(fr, Fraction(0)), None
    return None

def m_missing_dimension(body, ch):
    """The overall span is the largest label; the missing part is what is left
    after the others are taken off it."""
    b = strip_tex(body)
    if not re.search(r'missing (dimension|side)', b):
        return None
    vals = []
    for lab in tikz_labels(body):
        fr = quantities(lab)
        if len(fr) == 1:
            vals.append(fr[0])
    if len(vals) < 3:
        return None
    total = max(vals)
    rest = [x for x in vals if x is not total]
    if len(rest) != len(vals) - 1:
        return None
    return total - sum(rest, Fraction(0)), None

# --- diagrams that exist only as images from the source PDF -----------------
# These carry no data a script can read: their numbers live in PNGs
# extracted from the worksheet. The values below were read off those images by
# eye and are recorded here so the keys are still checked, and so a later change
# to one of them cannot pass unnoticed.
HAND_READ = {
    # series circuit: 3600+560+75+100+2500+5+575+1200
    ('original_pdf', 7): Fraction(8615),
    # stepped shaft: 6 3/4 + 2 1/8, the two dimensions spanning it end to end
    ('original_pdf', 28): Fraction(71, 8),
    # bottom span: 2 1/16 + 2 17/32
    ('original_pdf', 31): Fraction(147, 32),
    # notched block, missing side A. The figure shipped with the app was a crop
    # that had lost both the overall width and the leading "6" of the left-hand
    # height, which left A underdetermined; the full figure was supplied and the
    # image replaced in v37. From the printed labels:
    #     A = 12 5/16 - 4 3/8 - 4 9/16 = 197/16 - 70/16 - 73/16 = 54/16 = 3 3/8
    ('original_pdf', 32): Fraction(27, 8),
}

def m_hand_read(body, ch, q=None, setid=None):
    key = (setid, q['original_number']) if q is not None else None
    if key not in HAND_READ:
        return None
    return HAND_READ[key], None

MATCHERS = [
    # words <-> decimals: the lesson where "and" means the decimal point
    ('words to a decimal', m_words_to_decimal),
    ('decimal to words', m_decimal_to_words),
    # rounding
    ('round to a place', m_round_any),
    ('round to significant digits', m_round_sig_any),
    ('round to significant digits', m_round_sig_short),
    # scientific notation
    ('scientific notation to decimal', m_sci_to_decimal),
    ('decimal to scientific notation', m_decimal_to_sci),
    ('convert to scientific notation', m_convert_sci),
    ('scientific notation arithmetic', m_sci_arith),
    # powers of ten
    ('laws of exponents', m_powers_of_ten),
    # fractions
    ('simplify a fraction', m_simplify_general),
    ('equivalent fraction', m_equivalent_write),
    ('the odd one out', m_equivalent_not),
    ('improper to mixed', m_to_mixed),
    ('mixed to improper', m_to_improper),
    ('lowest common denominator', m_lcd),
    ('fraction chain', m_fraction_chain),
    ('decimal to a fraction', m_decimal_to_fraction),
    ('improper fraction to a decimal', m_improper_to_decimal),
    ('common fraction to decimal', m_common_fraction_to_decimal),
    ('common fraction to decimal', m_common_fraction_to_decimal2),
    # percents
    ('percent conversion', m_percent_any),
    # redundant: m_percent_any above already claims every one of these.
    ('percent to fraction or decimal', m_percent_to_fraction),
    ('fraction to percent', m_fraction_to_percent),
    ('decimal to percent', m_decimal_to_percent),
    # signs
    ('sign rule', m_sign_rule),
    ('whole divided by a fraction', m_whole_div_fraction),
    ('signed division', m_divide_signed),
    ('signed product', m_sign_product),
    ('signed chain', m_signed_chain),
    # arithmetic
    ('division with a remainder', m_remainder_any),
    ('column arithmetic', m_calcstack),
    ('inline multiply or divide', m_inline_arith),
    ('subtract from', m_subtract_from),
    ('price each', m_price_each),
    # units
    ('unit conversion', m_unit_change),
    ('unit conversion (worded)', m_change_units_words),
    ('unit conversion (question)', m_convert_question),
    # read from the source images by eye, recorded so they stay checked
    ('diagram read by eye', m_hand_read),
    # word problems
    ('barrel part-full', m_barrel_fraction),
    ('welded length', m_welded_total),
    ('fuel difference', m_fuel_difference),
    ('subtract mixed numbers', m_subtract_mixed),
    ('add two fractions', m_add_two),
    ('total service time', m_service_time),
    ('shaft feet to inches', m_shaft_ft_to_inches),
    ('rod cut into pieces', m_rod_pieces),
    ('height in feet and inches', m_height_ft_in),
    ('unit conversion (dotted)', m_change_units_dotted),
    # redundant: m_inline_arith above already claims every one of these.
    ('inline multiply', m_multiply_inline),
    ('series circuit', m_circuit_total),
    ('shaft from the picture', m_shaft_from_picture),
    ('missing dimension', m_missing_dimension),
    ('stack of sheets', m_pile),
    ('fuel consumption', m_gas_consumption),
    ('gas used from a cylinder', m_cylinder_used),
    ('remaining length of a rod', m_rod_remainder),
    ('total length of pipe', m_pipe_total),
]

# ------------------------------------------------------------------- run ----

def main():
    s = open(BANK, encoding='utf-8').read()
    data = json.loads(s[s.index('{'):s.rindex('}') + 1])

    checked = 0
    unchecked = collections.Counter()
    by_matcher = collections.Counter()
    problems = []

    for setid, st in data.items():
        for q in st['questions']:
            choices = split_choices(q['choices'])
            if len(choices) != 4:
                problems.append((setid, q['original_number'], 'does not have four choices'))
                continue
            derived = None
            form = None
            used = None
            for name, fn in MATCHERS:
                try:
                    if fn is m_circuit_total:
                        v = fn(q['body'], choices, q)
                    elif fn is m_hand_read:
                        v = fn(q['body'], choices, q, setid)
                    else:
                        v = fn(q['body'], choices)
                except Exception:
                    v = None
                if v is not None:
                    derived, form = v
                    used = name
                    break
            if derived is None:
                unchecked[q['lesson']] += 1
                continue

            hits = match_value(choices, derived, form)
            checked += 1
            by_matcher[used] += 1
            if not hits:
                problems.append((setid, q['original_number'],
                    f'[{used}] computed {derived} but no option offers it: {choices}'))
            elif len(hits) > 1:
                problems.append((setid, q['original_number'],
                    f'[{used}] computed {derived}; more than one option matches: {hits}'))
            elif hits[0] != q['answer']:
                problems.append((setid, q['original_number'],
                    f'[{used}] computed {derived} = option ({hits[0]}), but the key says ({q["answer"]}): {choices}'))

    total = sum(len(st['questions']) for st in data.values())
    print(f'Questions in Chapters 01 & 02, all four versions : {total}')
    print(f'Independently re-derived and checked             : {checked}')
    print(f'Not machine-checkable by this script             : {total - checked}')
    print()
    print('Checked, by question type:')
    for k, v in by_matcher.most_common():
        print(f'  {v:4d}  {k}')
    print()
    print('Unchecked, by lesson (word problems, definitions, diagrams):')
    for k, v in sorted(unchecked.items(), key=lambda x: -x[1])[:12]:
        print(f'  {v:4d}  {k}')
    print()
    if problems:
        print(f'!! {len(problems)} PROBLEM(S) FOUND')
        for setid, n, msg in problems:
            print(f'  {setid} Q{n}: {msg}')
        return 1
    print('Every machine-checkable answer agrees with an independent calculation.')
    return 0

if __name__ == '__main__':
    sys.exit(main())
