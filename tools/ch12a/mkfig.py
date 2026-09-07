import re, os, subprocess, sys, json, hashlib

SRC = {
 'version_a': '/root/.claude/uploads/31b6d1fd-3b78-5915-86b3-6a23229c570d/b3cf3f1e-Ch12A_questions.tex',
 'version_b': '/root/.claude/uploads/31b6d1fd-3b78-5915-86b3-6a23229c570d/8c1d69db-Ch12B_questions.tex',
 'version_c': '/root/.claude/uploads/31b6d1fd-3b78-5915-86b3-6a23229c570d/9dc181d8-Ch12C_questions.tex',
 'version_d': '/root/.claude/uploads/31b6d1fd-3b78-5915-86b3-6a23229c570d/e1b85db4-Ch12D_questions.tex',
}

def preamble(path):
    t = open(path, encoding='utf-8').read()
    return t[:t.index('\\begin{document}')]

def fig_macros(pre):
    """Names of every \newcommand{\figXxx} defined with no arguments."""
    return re.findall(r'\\newcommand\{\\(fig[A-Za-z]+)\}\{', pre)

if __name__ == '__main__':
    for v, p in SRC.items():
        pre = preamble(p)
        print(v, len(fig_macros(pre)), 'fig macros defined')
