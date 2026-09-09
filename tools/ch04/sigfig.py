"""Significant-figures / precision / greatest-possible-error rules for
decimal and fractional measurements, as used by Chapter 04.

A decimal measurement is represented as a DecNum: the digit string with no
separators, the position of the decimal point (digits-after-point count, or
None if it's a whole number with no decimal point), and the 0-indexed
position (from the left) of an overlined ("bar") digit, if any.
"""
import re
from fractions import Fraction


class DecNum:
    def __init__(self, raw):
        self.raw = raw
        s = raw.replace('{,}', '').replace(',', '')
        # overline: \overline{0} marks that one digit as significant
        bar_pos = None
        m = re.search(r'\\overline\{(\d)\}', s)
        if m:
            bar_digit = m.group(1)
            pre = s[:m.start()]
            # count digits before the bar to find its index
            digits_before = re.sub(r'[^\d]', '', pre)
            bar_pos = len(digits_before)
            s = re.sub(r'\\overline\{(\d)\}', r'\1', s)
        s = s.strip()
        if '.' in s:
            whole, frac = s.split('.')
            self.digits = (whole + frac).lstrip() or '0'
            # strip only leading zeros that are not part of "0.xxx"
            self.decimals = len(frac)
        else:
            self.digits = s
            self.decimals = None
        # normalize digits: keep as-is (leading zeros meaningful for locating sig start)
        self.all_digits = re.sub(r'[^\d]', '', s)
        self.bar_pos = bar_pos

    def sig_figs(self):
        d = self.all_digits
        first = next((i for i, c in enumerate(d) if c != '0'), None)
        if first is None:
            return 1  # a measurement of 0 -- shouldn't occur in this chapter
        if self.decimals is not None:
            last = len(d) - 1
        else:
            if self.bar_pos is not None:
                last = self.bar_pos
            else:
                last_nonzero = max(i for i, c in enumerate(d) if c != '0')
                last = last_nonzero
        return last - first + 1

    def precision(self):
        """Value of the place of the last significant digit."""
        d = self.all_digits
        if self.decimals is not None:
            return Fraction(1, 10 ** self.decimals)
        else:
            if self.bar_pos is not None:
                last = self.bar_pos
            else:
                last = max(i for i, c in enumerate(d) if c != '0')
            place_exp = len(d) - 1 - last  # power of ten of that digit's place
            return Fraction(10 ** place_exp)

    def gpe(self):
        return self.precision() / 2

    def value(self):
        d = self.all_digits
        if self.decimals is not None:
            return Fraction(int(d), 10 ** self.decimals)
        return Fraction(int(d))


def parse_measurement(text):
    """Extract the leading number (possibly with \\overline) from a LaTeX
    snippet like '873{,}000' or '$49\\overline{0}0$' or '17.00'."""
    s = text.strip().strip('$')
    m = re.match(r'^[\d,{}\\overline ]*[\d}]', s)
    # simpler: grab the number token up to first letter/space-unit
    m = re.match(r'^([\d{},.]|\\overline\{\d\})+', s)
    assert m, text
    return DecNum(m.group(0))


def parse_fraction_measurement(text):
    """Extract N\\frac{a}{b} -> (whole, num, den)."""
    m = re.search(r'(\d+)\\frac\{(\d+)\}\{(\d+)\}', text) or re.search(r'(\d+)\\overline\{\}', text)
    m = re.search(r'(\d+)\\frac\{(\d+)\}\{(\d+)\}', text)
    assert m, text
    whole, num, den = int(m.group(1)), int(m.group(2)), int(m.group(3))
    return whole, num, den


def fmt_frac(f):
    """Format a Fraction as \\dfrac{1}{N} style string for comparison purposes,
    returning (num, den) in lowest terms."""
    f = Fraction(f).limit_denominator(10**9)
    return f.numerator, f.denominator
