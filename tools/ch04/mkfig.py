import re

SRC = {
 'A': '/tmp/energytech_app/ch04new/Ch04A_questions.tex',
 'B': '/tmp/energytech_app/ch04new/Ch04B_questions.tex',
 'C': '/tmp/energytech_app/ch04new/Ch04C_questions.tex',
 'D': '/tmp/energytech_app/ch04new/Ch04D_questions.tex',
}


def preamble(path):
    t = open(path, encoding='utf-8').read()
    return t[:t.index('\\begin{document}')]


def fig_macros(pre):
    """Names of every \\newcommand{\\figXxx} defined with no arguments, except
    the \\figbox wrapper macro itself (that one takes an argument and just
    frames whichever concrete figure it's given -- it is not a figure)."""
    return [n for n in re.findall(r'\\newcommand\{\\(fig[A-Za-z]+)\}\{', pre) if n != 'figbox']


if __name__ == '__main__':
    for v, p in SRC.items():
        pre = preamble(p)
        print(v, len(fig_macros(pre)), 'fig macros defined')
