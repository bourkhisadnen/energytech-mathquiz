/* Exporting a session as an interactive LaTeX worksheet.
 *
 * The question bank is already LaTeX -- \dfrac, \calcstack, whole tikzpicture
 * environments -- because that is what the printed worksheets were set in. So
 * the honest export is not a picture of a paper, it is the paper: the bodies
 * and choices go through untouched and pdfTeX sets them exactly as the original
 * worksheet does. Nothing here re-implements a fraction.
 *
 * What this file adds around them is the interactive machinery: one PDF radio
 * group per question, a document-level JavaScript grader, the score panel and
 * the objective mastery table. That machinery is lifted from the worksheet the
 * instructor already compiles by hand, so a session exported here and a
 * worksheet written by hand behave identically in Acrobat.
 *
 * The answer key travels inside the file, in plain text, as it must for the PDF
 * to mark itself. Anyone who opens the PDF in an editor can read it. Every
 * caller is expected to say so.
 */

/* Everything below is private to this file and reaches the app as one object,
 * WorksheetExport. The app loads its scripts as plain <script> tags into one
 * shared global scope, so a bare `function splitChoices` here would have
 * collided with app.js's own splitChoices -- and did: app.js loads second, its
 * version won, and this exporter silently rendered every answer option as
 * "[object Object]". The worksheet still compiled and still had four radio
 * buttons per question, which is exactly why it went unnoticed. One namespace,
 * and the collision cannot come back. */
(function (root) {
'use strict';

/* ------------------------------------------------------------------ escaping
 * Question bodies are LaTeX and are NOT escaped. Everything the instructor
 * typed -- session name, group, intake -- is, or a stray & or _ in a session
 * name takes the compile down with it. */
function texEscape(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/* The bank stores two things the browser understands and pdfTeX does not: the
 * [[DIAGRAM]] placeholder, and the <br> left in two hand-edited bodies. */
function texBody(q, diagramTex) {
  let s = String(q.body || '');
  s = s.replace(/\[\[DIAGRAM\]\]/g, diagramTex || '');
  s = s.replace(/<br\s*\/?>/gi, '\\par ');
  // Twenty-four bodies run a paragraph break straight into the next sentence:
  // "\parRound your answer", "\parA car's gas tank". The browser's renderer
  // does a plain string replace of \par and never notices; TeX reads the whole
  // thing as one undefined control sequence and stops. Only a following capital
  // is split -- \parbox and \parindent are real macros and must survive, even
  // though the bank happens not to use them today.
  s = s.replace(/\\par(?=[A-Z])/g, '\\par ');
  return s;
}

/* `choices` is one string of \item entries, in the order the trainee sees them
 * -- shuffleChoicesOf has already run when the session shuffles per launch, and
 * it moves the answer letter with them, so splitting here preserves the pairing
 * of option and key. */
function splitOptionList(raw) {
  return String(raw || '')
    .split(/\\item\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/* ------------------------------------------------------------------ diagrams
 * Ten questions carry their tikzpicture in the body and need nothing: the
 * placeholder is absent and the picture is already there. The rest are one of
 * three kinds. */
function diagramTexFor(q) {
  const d = q && q.diagram;
  if (!d) return '';
  if (d.type === 'tape') {
    return `\\par\\vspace{2pt}\\centerline{\\taperuler{${Number(d.start)}}{${Number(d.end)}}{${Number(d.reading)}}}\\vspace{1pt}`;
  }
  if (d.type === 'circuit') {
    const pairs = list => (list || []).map(rv => `${Number(rv[0])}/${Number(rv[1])}`).join(',');
    return `\\par\\vspace{2pt}\\centerline{\\etcircuit{${pairs(d.top)}}{${pairs(d.bottom)}}}\\vspace{1pt}`;
  }
  if (d.type === 'image') {
    // Bundled beside the .tex, so the path is the file name and nothing else.
    const file = String(d.src).replace(/^.*\//, '');
    return `\\par\\vspace{2pt}\\centerline{\\includegraphics[max width=\\linewidth,max height=95pt]{${file}}}\\vspace{1pt}`;
  }
  return '';
}

/* Which image files a given paper actually needs, so a worksheet of pure
 * arithmetic ships as one .tex and only a paper that uses pictures pays for
 * them. */
function imagesUsedBy(questions) {
  const out = [];
  (questions || []).forEach(q => {
    if (q && q.diagram && q.diagram.type === 'image' && q.diagram.src) {
      if (out.indexOf(q.diagram.src) === -1) out.push(q.diagram.src);
    }
  });
  return out;
}

/* --------------------------------------------------------- mastery table rows
 * The attachment lists its objectives by hand. Here they are whatever the
 * session actually drew, in the order the questions appear, with the question
 * numbers collapsed into ranges so a row reads "Q1--Q4, Q71" rather than as
 * eleven separate numbers. */
function collapseRuns(nums) {
  const sorted = nums.slice().sort((a, b) => a - b);
  const parts = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    if (j - i >= 2) parts.push(`Q${sorted[i]}--Q${sorted[j]}`);
    else for (let k = i; k <= j; k++) parts.push(`Q${sorted[k]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

function masteryRows(questions) {
  const order = [];
  const byLesson = {};
  (questions || []).forEach((q, idx) => {
    const lesson = String((q && q.lesson) || '?');
    if (!byLesson[lesson]) { byLesson[lesson] = []; order.push(lesson); }
    byLesson[lesson].push(idx + 1);
  });
  order.sort();
  return order.map(lesson => ({
    lesson,
    count: byLesson[lesson].length,
    questions: collapseRuns(byLesson[lesson])
  }));
}

/* ------------------------------------------------------------------ preamble
 * String.raw throughout: the whole point is that backslashes are literal. The
 * one sequence that cannot appear anywhere below is ${, which JavaScript would
 * read as interpolation -- LaTeX never needs it, and a test checks. */
const WORKSHEET_GRADER_JS = String.raw`
// EnergyTech self-grading engine -------------------------------------
// ANSWER[] and NQ are supplied by the companion key script.

function etFmt(a) {
    var s = [];
    for (var i = 0; i < a.length; i++) { s.push("Q" + a[i]); }
    return s.join(",  ");
}

function etPick(doc, i) {
    var f = doc.getField("Q" + i);
    if (f == null) { return "Off"; }
    var v = f.value;
    if (v == null) { return "Off"; }
    return v;
}

function etScore(doc) {
    var right = 0;
    for (var i = 1; i <= NQ; i++) {
        var v = etPick(doc, i);
        if (v != "Off" && v != "" && v == ANSWER[i - 1]) { right++; }
    }
    return right;
}

function etFeedback(doc) {
    var wrong = [], blank = [], right = 0;
    for (var i = 1; i <= NQ; i++) {
        var v = etPick(doc, i);
        if (v == "Off" || v == "") { blank.push(i); }
        else if (v == ANSWER[i - 1]) { right++; }
        else { wrong.push(i); }
    }
    var pct = Math.round(right * 1000 / NQ) / 10;
    doc.getField("Score").value   = right + " / " + NQ;
    doc.getField("Percent").value = pct + " %";
    doc.getField("WrongList").value =
        (wrong.length == 0) ? "None." : etFmt(wrong);
    doc.getField("BlankList").value =
        (blank.length == 0) ? "None - every question was answered."
                            : etFmt(blank);
    etMastery(doc);
}

function etRamp(r) {
    if (r < 0) { r = 0; }
    if (r > 1) { r = 1; }
    var a, b, t;
    if (r < 0.5) {
        t = r / 0.5;   a = [0.90, 0.42, 0.40];  b = [0.99, 0.85, 0.42];
    } else {
        t = (r - 0.5) / 0.5; a = [0.99, 0.85, 0.42]; b = [0.48, 0.80, 0.52];
    }
    return ["RGB", a[0] + (b[0] - a[0]) * t,
                   a[1] + (b[1] - a[1]) * t,
                   a[2] + (b[2] - a[2]) * t];
}

function etMastery(doc) {
    for (var k = 0; k < OBJROW.length; k++) {
        var code = OBJROW[k];
        if (code == "") { continue; }
        var f = doc.getField("M" + (k + 1));
        if (f == null) { continue; }
        var tot = 0, ok = 0;
        for (var i = 1; i <= NQ; i++) {
            if (OBJ[i - 1] != code) { continue; }
            tot++;
            var v = etPick(doc, i);
            if (v != "Off" && v != "" && v == ANSWER[i - 1]) { ok++; }
        }
        try {
            if (tot == 0) {
                f.value = "-";
                f.fillColor = ["RGB", 0.93, 0.93, 0.93];
            } else {
                var r = ok / tot;
                f.value = ok + "/" + tot + "  " + Math.round(r * 100) + "%";
                f.fillColor = etRamp(r);
                f.textColor = color.black;
            }
        } catch (e) { console.println("Mastery " + code + ": " + e); }
    }
}

function etClearMastery(doc) {
    for (var k = 0; k < OBJROW.length; k++) {
        if (OBJROW[k] == "") { continue; }
        var f = doc.getField("M" + (k + 1));
        if (f != null) { f.value = ""; f.fillColor = ["RGB", 0.93, 0.93, 0.93]; }
    }
}

// "Clear all" clears the answers. It names the fields to reset rather than
// calling resetForm() bare, because a bare reset also empties the name, group
// and ID in the header -- and someone who wants another go at the questions has
// not stopped being themselves.
function etReset(doc) {
    var fields = [];
    for (var i = 1; i <= NQ; i++) { fields.push("Q" + i); }
    fields.push("Total");
    fields.push("Score");
    fields.push("Percent");
    fields.push("WrongList");
    fields.push("BlankList");
    doc.resetForm(fields);
    etClearMastery(doc);
}
`;

const WORKSHEET_PREAMBLE = String.raw`\documentclass[10pt,a4paper]{article}

\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{mathptmx}
\usepackage{helvet}
\renewcommand{\familydefault}{\sfdefault}
\usepackage{textcomp}
\usepackage{amsmath}

% The question bank was written for the browser, so a handful of characters are
% literal Unicode rather than LaTeX commands -- a real minus sign, superscript
% digits, degrees, micro. \ensuremath so each works whether it lands in text or
% in math: "m²" in a sentence and "$0.5\,µm$" in a formula both occur.
%
% On TeX Live 2023 only U+2212 and U+2074 are strictly needed; the kernel knows
% the others already. The rest are kept deliberately, because Overleaf lets a
% project pin an older TeX Live and those releases did not. They cost nothing
% and they are the difference between compiling and not on somebody else's
% machine. Only the two load-bearing ones are covered by a mutation, because
% only those two can be shown to fail here.
\DeclareUnicodeCharacter{2026}{\dots}
\DeclareUnicodeCharacter{00B2}{\ensuremath{^{2}}}
\DeclareUnicodeCharacter{00B3}{\ensuremath{^{3}}}
\DeclareUnicodeCharacter{2074}{\ensuremath{^{4}}}
\DeclareUnicodeCharacter{00B0}{\ensuremath{^{\circ}}}
\DeclareUnicodeCharacter{00B5}{\ensuremath{\mu}}
\DeclareUnicodeCharacter{2212}{\ensuremath{-}}
\DeclareUnicodeCharacter{00D7}{\ensuremath{\times}}
\DeclareUnicodeCharacter{2019}{\textquoteright}
% headheight has room for a session name that runs to two lines; instructors
% name sittings things like "Midterm exam -- Chapters 1 & 2".
\usepackage[a4paper,top=2.95cm,bottom=1.1cm,left=1.15cm,right=1.15cm,
            headheight=66pt,headsep=8pt]{geometry}
\usepackage{xcolor}
\usepackage{graphicx}
\usepackage[export]{adjustbox}
\usepackage{tikz}
\usepackage{multicol}
\usepackage{colortbl}
\usepackage{tcolorbox}
\tcbuselibrary{skins,breakable}
\usepackage{fancyhdr}
\usepackage{hyperref}

\definecolor{etnavy}{HTML}{1F3864}
\definecolor{etblue}{HTML}{1F6FB2}
\definecolor{etgreen}{HTML}{35B08E}
\definecolor{etgrey}{HTML}{7F7F7F}
\definecolor{masred}{HTML}{E66B66}
\definecolor{masmid}{HTML}{FCD96B}
\definecolor{masgreen}{HTML}{7ACC85}

% Some bodies use math commands outside math mode -- "170\dfrac{2}{3} gal" with
% no dollar signs around it. The browser gets away with it because its renderer
% treats every string as math-ish; TeX does not, and stops with "Missing $".
% Rather than trying to work out from the outside which \dfrac is inside math
% and which is not, the commands are made safe in both: \ensuremath is a no-op
% in math mode and switches into it in text.
\let\ETdfrac\dfrac  \renewcommand{\dfrac}[2]{\ensuremath{\ETdfrac{#1}{#2}}}
\let\ETfrac\frac    \renewcommand{\frac}[2]{\ensuremath{\ETfrac{#1}{#2}}}
\let\ETtfrac\tfrac  \renewcommand{\tfrac}[2]{\ensuremath{\ETtfrac{#1}{#2}}}
\let\ETtimes\times  \renewcommand{\times}{\ensuremath{\ETtimes}}
\let\ETcdot\cdot    \renewcommand{\cdot}{\ensuremath{\ETcdot}}
\let\ETdiv\div      \renewcommand{\div}{\ensuremath{\ETdiv}}
\let\ETOmega\Omega  \renewcommand{\Omega}{\ensuremath{\ETOmega}}

% -- unit shorthands the question bank uses -----------------------------
\newcommand{\gal}{\mathrm{gal}}
\newcommand{\mi}{\mathrm{mi}}
\newcommand{\inunit}{\mathrm{in}}
\newcommand{\ftcubed}{\mathrm{ft}^{3}}

% -- column arithmetic, as the printed worksheet sets it ----------------
\newcommand{\calcstack}[1]{%
  \par\vspace{2pt}\centerline{$\begin{array}{r}#1\end{array}$}\vspace{1pt}}

% -- tape measure: \taperuler{<start cm>}{<end cm>}{<reading cm>} -------
\newcommand{\taperuler}[3]{%
\begin{tikzpicture}[x=1cm,y=1cm,scale=0.60,baseline=0pt]
  \pgfmathtruncatemacro{\tpspan}{#2-#1}
  \pgfmathtruncatemacro{\tpticks}{(#2-#1)*10}
  \fill[yellow!80!orange]   (0,0) rectangle (\tpspan,0.95);
  \fill[yellow!55!orange!70](0,0) rectangle (\tpspan,0.14);
  \draw[black!55,line width=0.3pt] (0,0) rectangle (\tpspan,0.95);
  \foreach \i in {0,...,\tpticks}{%
    \draw[black!80,line width=0.22pt] (\i/10,0.95) -- (\i/10,0.80);
    \draw[black!80,line width=0.22pt] (\i/10,0.14) -- (\i/10,0.27);}
  \foreach \i in {0,...,\tpspan}{%
    \pgfmathtruncatemacro{\tphalf}{\i*10+5}
    \ifnum\tphalf<\tpticks
      \draw[black!80,line width=0.25pt] (\tphalf/10,0.95) -- (\tphalf/10,0.72);
    \fi}
  \foreach \i in {0,...,\tpspan}{%
    \draw[black,line width=0.35pt] (\i,0.95) -- (\i,0.62);
    \draw[black,line width=0.35pt] (\i,0.14) -- (\i,0.42);}
  \foreach \i in {0,...,\tpspan}{%
    \pgfmathtruncatemacro{\tplabel}{#1+\i}
    \node[font=\bfseries\small,inner sep=1pt,fill=yellow!80!orange,
          text=black] at (\i,0.49) {\tplabel};}
  \node[font=\bfseries\tiny,red!80!black] at (0.28,-0.22) {cm};
  \draw[-latex,line width=1.1pt,cyan!55!blue]
        ({#3-#1},2.05) -- ({#3-#1},1.08);
\end{tikzpicture}}

% -- series circuit: \etcircuit{<n/ohms,...>}{<n/ohms,...>} -------------
% Two rows of four resistors, drawn from the values the question carries.
\newcommand{\etcircuit}[2]{%
\begin{tikzpicture}[x=1cm,y=1cm,scale=0.52,baseline=(current bounding box.center),
                    line cap=round,line join=round,font=\tiny]
  \draw[gray!65,line width=0.7pt] (0,0) -- (0,2.9) -- (0.7,2.9);
  \draw[gray!65,line width=0.7pt] (8.9,2.9) -- (10.0,2.9) -- (10.0,0) -- (0,0);
  \foreach \b/\h in {1.45/0.38,1.18/0.54,0.92/0.38,0.65/0.54}{
    \draw[line width=0.8pt] ({-\h/2+0.09},\b) -- ({\h/2+0.09},\b);}
  \foreach \n/\r [count=\i from 0] in {#1}{
    \pgfmathsetmacro{\xa}{0.7+\i*2.05}
    \draw[gray!65,line width=0.7pt] (\xa,2.9) -- ({\xa+0.25},2.9);
    \draw[fill=white,line width=0.7pt] ({\xa+0.25},2.66) rectangle ({\xa+1.35},3.14);
    \draw[gray!65,line width=0.7pt] ({\xa+1.35},2.9) -- ({\xa+1.8},2.9);
    \node at ({\xa+0.8},2.9) {$R_{\n}$};
    \node[below=1pt] at ({\xa+0.8},2.62) {\r\,$\Omega$};}
  \draw[gray!65,line width=0.7pt] (0.7,2.9) -- (0.7,2.9);
  \foreach \n/\r [count=\i from 0] in {#2}{
    \pgfmathsetmacro{\xa}{0.7+\i*2.05}
    \draw[gray!65,line width=0.7pt] (\xa,0.9) -- ({\xa+0.25},0.9);
    \draw[fill=white,line width=0.7pt] ({\xa+0.25},0.66) rectangle ({\xa+1.35},1.14);
    \draw[gray!65,line width=0.7pt] ({\xa+1.35},0.9) -- ({\xa+1.8},0.9);
    \node at ({\xa+0.8},0.9) {$R_{\n}$};
    \node[below=1pt] at ({\xa+0.8},0.62) {\r\,$\Omega$};}
  \draw[gray!65,line width=0.7pt] (0.7,2.9) -- (0.7,0.9);
  \draw[gray!65,line width=0.7pt] (8.9,0.9) -- (10.0,0.9);
\end{tikzpicture}}
`;

/* The interactive machinery: radio groups written as real PDF fields, and the
 * key exported to a document-level script at \end{document}. Lifted from the
 * hand-written worksheet so the two behave the same in Acrobat. */
const WORKSHEET_MACHINERY = String.raw`\makeatletter

\AtBeginDocument{%
  \immediate\pdfobj stream
    attr{/Type/XObject/Subtype/Form/BBox[0 0 11 11]/Resources<<>>}
    {q 1 g 0.12 0.22 0.39 RG 0.8 w
     9.4 5.5 m 9.4 7.65 7.65 9.4 5.5 9.4 c 3.35 9.4 1.6 7.65 1.6 5.5 c
     1.6 3.35 3.35 1.6 5.5 1.6 c 7.65 1.6 9.4 3.35 9.4 5.5 c B Q}%
  \xdef\ws@apoff{\the\pdflastobj\space 0 R}%
  \immediate\pdfobj stream
    attr{/Type/XObject/Subtype/Form/BBox[0 0 11 11]/Resources<<>>}
    {q 1 g 0.12 0.22 0.39 RG 0.8 w
     9.4 5.5 m 9.4 7.65 7.65 9.4 5.5 9.4 c 3.35 9.4 1.6 7.65 1.6 5.5 c
     1.6 3.35 3.35 1.6 5.5 1.6 c 7.65 1.6 9.4 3.35 9.4 5.5 c B
     0.12 0.22 0.39 rg
     7.7 5.5 m 7.7 6.71 6.71 7.7 5.5 7.7 c 4.29 7.7 3.3 6.71 3.3 5.5 c
     3.3 4.29 4.29 3.3 5.5 3.3 c 6.71 3.3 7.7 4.29 7.7 5.5 c f Q}%
  \xdef\ws@apon{\the\pdflastobj\space 0 R}%
}

\newcounter{wsq}
\newcounter{wsopt}
\newcounter{wsobj}

% -- who is sitting the paper, as fillable fields ----------------------
% Dotted rules meant the worksheet could be answered on screen but only named
% with a pen. These are real text fields: the trainee types their name where
% they answer the questions, and the viewer keeps it when they save the file.
%
% They sit in the running header, which ships out once per page, so each one
% needs a widget on every page. hyperref's \TextField cannot do that -- called
% from a header it emits a separate top-level field per page, all carrying the
% same /T, which the PDF spec does not allow among siblings and which leaves
% every viewer to guess for itself that the six boxes are one box.
%
% So they are built the way the radio groups above are built: a parent object
% reserved the first time the field is seen, one widget appended per page, and
% the parent written at the end with every widget as a kid. One field, one
% value: type on page one and it is on page four.
\gdef\ws@textnames{}
\newcommand\ws@textparent[1]{%
  \expandafter\ifx\csname ws@tp@#1\endcsname\relax
    \pdfobj reserveobjnum
    \expandafter\xdef\csname ws@tp@#1\endcsname{\the\pdflastobj}%
    \expandafter\gdef\csname ws@tk@#1\endcsname{}%
  \fi}
% The annotation goes inside a \makebox, exactly as the radio widgets above do.
% Left bare in a horizontal list its rectangle comes out one slot early -- the
% Name box landed at the start of the line and the Group box landed on top of
% the word "Group:".
\newcommand\etline[2]{%
  \leavevmode\makebox[#2][l]{%
  \ws@textparent{#1}%
  \pdfannot width #2 height 11bp depth 3bp{%
    /Subtype/Widget /FT/Tx /F 4
    /Parent \csname ws@tp@#1\endcsname\space 0 R
    /MK<</BC[0.12 0.43 0.70]/BG[0.96 0.98 1]>>
    /BS<</W 0.6/S/S>>
    /DA(0 0 0 rg /Helv 9 Tf)
  }%
  \expandafter\xdef\csname ws@tk@#1\endcsname{%
    \csname ws@tk@#1\endcsname\space\the\pdflastannot\space 0 R}%
  }%
}
% Closed only after the last page has shipped out -- see the \clearpage in
% \AtEndDocument, without which the final page's widget is orphaned.
\newcommand\ws@closetext[1]{%
  \expandafter\ifx\csname ws@tp@#1\endcsname\relax\else
    \immediate\pdfobj useobjnum \csname ws@tp@#1\endcsname
      {<</FT/Tx/T(#1)/V()/DV()/Ff 0/DA(0 0 0 rg /Helv 9 Tf)
         /Kids[\csname ws@tk@#1\endcsname]>>}%
    \xdef\HyField@afields{\HyField@afields\space
      \csname ws@tp@#1\endcsname\space 0 R}%
  \fi}

\newcommand\ws@openfield{%
  \pdfobj reserveobjnum
  \xdef\ws@parent{\the\pdflastobj}%
  \gdef\ws@kids{}%
}
\newcommand\ws@widget[1]{%
  \pdfannot width 10bp height 8.5bp depth 1.5bp{%
    /Subtype/Widget /FT/Btn /F 4 /Parent \ws@parent\space 0 R /AS/Off
    /MK<</BC[0.12 0.22 0.39]/BG[1 1 1]>>
    /BS<</W 1/S/S>>
    /AP<</N<</Off \ws@apoff /#1 \ws@apon>>>>
  }%
  \xdef\ws@kids{\ws@kids\space\the\pdflastannot\space 0 R}%
}
\newcommand\ws@closefield{%
  \immediate\pdfobj useobjnum \ws@parent
    {<</FT/Btn/Ff 49152/T(Q\thewsq)/V/Off/DV/Off/Kids[\ws@kids]>>}%
  \xdef\HyField@afields{\HyField@afields\space\ws@parent\space 0 R}%
}

\newcommand\opt[1]{%
  \stepcounter{wsopt}%
  \par\vspace{0.6pt}\noindent
  \makebox[13bp][l]{\ws@widget{\alph{wsopt}}}%
  \normalcolor\upshape\alph{wsopt}) #1%
}

% #1 is the objective code and #2 the correct letter. Neither is accumulated
% here: the key is written straight into etkey.js by the exporter, from the same
% list and in the same order these environments are emitted in. Letting TeX
% collect it meant one \write per array, and \write breaks its output at
% max_print_line -- 79 characters on a stock TeX Live. A paper long enough to
% pass that would have had a comma turned into a newline somewhere in the middle
% of its answer key, and grading would have gone quietly wrong from that
% question on. #2 is still taken so the environment reads the same as the
% hand-written worksheet's.
\newenvironment{wsq}[2]{%
  \refstepcounter{wsq}%
  \begin{tcolorbox}[qbox]%
  \setcounter{wsopt}{0}%
  \ws@openfield
  {\bfseries\color{etblue}Q\thewsq:}\,{\scriptsize\underline{#1}}\par
  \nopagebreak\color{etblue}%
}{%
  \ws@closefield
  \end{tcolorbox}%
}

\AtEndDocument{%
  % LaTeX runs this hook BEFORE its own \clearpage, so without this the last
  % page has not shipped out yet and its header widgets are not in the kid
  % lists below -- the name box on the final page would belong to no field.
  \clearpage
  \ws@closetext{Name}%
  \ws@closetext{Group}%
  \ws@closetext{EnergyTechID}%
  \immediate\pdfobj stream file {etkey.js}%
  \immediate\pdfobj{<</S/JavaScript/JS \the\pdflastobj\space 0 R>>}%
  \edef\ws@jskey{\the\pdflastobj}%
  \immediate\pdfobj stream file {etgrader.js}%
  \immediate\pdfobj{<</S/JavaScript/JS \the\pdflastobj\space 0 R>>}%
  \edef\ws@jslib{\the\pdflastobj}%
  \pdfnames{/JavaScript<</Names[%
      (ETW01key) \ws@jskey\space 0 R%
      (ETW02lib) \ws@jslib\space 0 R]>>}%
}

\newcommand{\objcell}[3]{%
  \stepcounter{wsobj}%
  #1 & #2 & #3 &
  \TextField[name=M\thewsobj,width=2.05cm,height=11.5pt,align=1,readonly,
    charsize=8pt,bordercolor=black!50,borderwidth=0.6,
    backgroundcolor=black!7,value={}]{}%
}
\makeatother

\tcbset{qbox/.style={
  enhanced jigsaw, sharp corners, breakable=false,
  colframe=etblue!45, colback=white, boxrule=0.4pt,
  left=4pt, right=3pt, top=3pt, bottom=3pt, boxsep=1pt,
  before skip=2.5pt, after skip=2.5pt,
  fontupper=\linespread{1.06}\selectfont
}}

\setlength{\columnsep}{8pt}
\setlength{\parindent}{0pt}
\pagestyle{fancy}
\fancyhf{}
\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

\newcommand{\etlogo}{%
  \begin{tikzpicture}[baseline]
    \node[font=\Large\bfseries\sffamily,text=etnavy,inner sep=0pt]
         (t) at (0,0) {EnergyTech};
    \fill[etnavy] ([xshift=5pt]t.east) -- ++(15pt,0) -- ++(0,-14pt)
                  -- ++(-7.5pt,-8pt) -- ++(-7.5pt,8pt) -- cycle;
    \fill[etgreen] ([xshift=13pt,yshift=1pt]t.east) rectangle ++(7pt,7pt);
  \end{tikzpicture}%
}

`;

/* ---------------------------------------------------------------- the export
 * `session` is the object the instructor just created; `questions` is what
 * selectQuestionsFor returned for it, in the order the trainees will meet them.
 */
function buildWorksheetTex(session, questions) {
  session = session || {};
  questions = questions || [];
  if (!questions.length) throw new Error('There are no questions to export.');

  const name = texEscape(session.sessionName || session.sessionCode || 'Worksheet');
  const code = texEscape(session.sessionCode || '');
  const intake = texEscape(session.intake || '');
  const group = texEscape(session.group || '');
  const covers = texEscape(session.questionSet || '');
  const mode = String(session.mode || 'practice') === 'assessment' ? 'Assessment' : 'Practice';

  const header = String.raw`
\makeatletter
\newcommand{\etheader}{%
  {\color{etnavy}%
   \setlength{\fboxrule}{1.1pt}\setlength{\fboxsep}{5pt}%
   \fbox{\parbox{\dimexpr\textwidth-2\fboxsep-2\fboxrule\relax}{%
     \normalcolor
     % Name gets a line to itself: the roster is full of names like
     % "Mohammed Abdullah Saleh Al-Otaibi", and a box that clips one is worse
     % than a dotted rule.
     \begin{minipage}[c]{0.54\linewidth}
       \sffamily\small
       \textcolor{etblue}{\bfseries Name:}\ \etline{Name}{7.6cm}\\[5pt]
       \textcolor{etblue}{\bfseries EnergyTech ID:}\ \etline{EnergyTechID}{2.7cm}\quad
       \textcolor{etblue}{\bfseries Group:}\ \etline{Group}{1.3cm}
     \end{minipage}\hfill
     \begin{minipage}[c]{0.43\linewidth}
       \sffamily\raggedleft\etlogo\par\vspace{2pt}
       {\bfseries\color{etblue}` + name + String.raw`}\par\vspace{1pt}
       {\scriptsize\color{etgrey}` + code +
         (intake || group ? String.raw` \textperiodcentered\ ` + intake + ' / ' + group : '') +
         String.raw`}
     \end{minipage}}}}%
}
\makeatother
\fancyhead[C]{\etheader}
`;

  const body = questions.map(q => {
    const opts = splitOptionList(q.choices).map(c => `\\opt{${c}}`).join('');
    return `\\begin{wsq}{${texEscape(q.lesson || '?')}}{${String(q.answer || 'a').trim()}}\n`
      + texBody(q, diagramTexFor(q)) + '\n'
      + opts + '\n\\end{wsq}\n';
  }).join('\n');

  const rows = masteryRows(questions);

  /* The key, written from here rather than collected by TeX. Question n in this
   * array is question n on the paper because both come from the same list in
   * the same order. Chunked only so the file stays readable. */
  const jsArray = (name, values) => {
    const lines = [];
    for (let i = 0; i < values.length; i += 16) {
      lines.push('  ' + values.slice(i, i + 16).map(v => JSON.stringify(String(v))).join(', ') +
                 (i + 16 < values.length ? ',' : ''));
    }
    return `var ${name} = [\n${lines.join('\n')}\n];`;
  };
  const keyJs = [
    '// Answer key for this worksheet, written by the EnergyTech MathQuiz app.',
    '// ANSWER[n-1] is the correct letter for question n.',
    jsArray('ANSWER', questions.map(q => String(q.answer || 'a').trim())),
    jsArray('OBJ', questions.map(q => String(q.lesson || '?'))),
    jsArray('OBJROW', rows.map(r => r.lesson)),
    `var NQ = ${questions.length};`
  ].join('\n');

  // Two objective rows per table row, as the printed worksheet lays them out.
  const tableRows = [];
  for (let i = 0; i < rows.length; i += 2) {
    const a = rows[i], b = rows[i + 1];
    const cell = r => `\\objcell{${texEscape(r.lesson)}}{${r.count}}{${r.questions}}`;
    tableRows.push(b ? `${cell(a)} & ${cell(b)} \\\\\\hline`
                     : `${cell(a)} & & & & \\\\\\hline`);
  }

  const doc = `%=====================================================================
%  EnergyTech - interactive worksheet
%  Session : ${session.sessionName || ''} (${session.sessionCode || ''})
%  Mode    : ${mode}
%  Covers  : ${session.questionSet || ''}
%  Drawn   : ${questions.length} question${questions.length === 1 ? '' : 's'}
%
%  Exported by the EnergyTech MathQuiz app. Compile TWICE with pdflatex:
%      pdflatex worksheet.tex
%      pdflatex worksheet.tex
%  pdfLaTeX only -- this uses pdfTeX's \\pdfannot and \\pdfobj primitives.
%  Open the result in Adobe Acrobat Reader; form JavaScript is what marks it.
%
%  NOTE: the answer key is embedded in the PDF so it can grade itself. Anyone
%  who opens the file in a text editor can read it. Do not hand this file to
%  trainees before they have sat the paper.
%=====================================================================
\\begin{filecontents*}[overwrite]{etgrader.js}${WORKSHEET_GRADER_JS}\\end{filecontents*}

\\begin{filecontents*}[overwrite]{etkey.js}
${keyJs}
\\end{filecontents*}

${WORKSHEET_PREAMBLE}
\\hypersetup{
  pdftitle={EnergyTech - ${name}},
  pdfsubject={${covers}},
  pdfauthor={EnergyTech Training Institute},
  hidelinks, pdfstartview={FitH}
}

${WORKSHEET_MACHINERY}
${header}
%=====================================================================
\\begin{document}
\\begin{Form}
\\small

{\\scriptsize\\itshape\\color{etgrey}%
Select one answer per question by clicking the button next to it. The total
score updates automatically; press \\textbf{Calculate Score} at the end of the
worksheet for detailed feedback.\\par}
\\vspace{3pt}

\\raggedcolumns
\\begin{multicols}{2}

${body}
\\end{multicols}

%=====================================================================
%  SCORE PANEL
%=====================================================================
\\vspace{2pt}
\\begin{tcolorbox}[enhanced jigsaw,sharp corners,colframe=etnavy,
  colback=etblue!4,boxrule=1pt,left=8pt,right=8pt,top=6pt,bottom=6pt]

{\\sffamily\\bfseries\\large\\color{etnavy} Total Score}\\hfill
{\\scriptsize\\itshape\\color{etgrey}
 The total updates automatically as you select answers.}

\\vspace{4pt}
\\TextField[name=Total,width=2.2cm,height=15pt,align=1,readonly,
  charsize=11pt,bordercolor=etnavy,backgroundcolor=white,borderwidth=1,
  value={0},calculate={event.value = etScore(this);}]{}\\ %
{\\large\\bfseries\\ /\\ \\thewsq}

\\vspace{6pt}\\par\\noindent\\rule{\\linewidth}{0.4pt}\\par\\vspace{2pt}

{\\sffamily\\bfseries\\large\\color{etnavy} Detailed feedback}\\hfill
{\\scriptsize\\itshape\\color{etgrey}
 Press \\textbf{Calculate Score} after answering, or after any change.}

\\vspace{5pt}
\\begin{minipage}[t]{0.30\\linewidth}
  \\textbf{Score:}\\ \\TextField[name=Score,width=2.4cm,height=15pt,align=1,
    readonly,charsize=10pt,bordercolor=etblue!60,borderwidth=0.6,
    backgroundcolor=white,value={}]{}
\\end{minipage}%
\\begin{minipage}[t]{0.30\\linewidth}
  \\textbf{Percentage:}\\ \\TextField[name=Percent,width=2.2cm,height=15pt,
    align=1,readonly,charsize=10pt,bordercolor=etblue!60,borderwidth=0.6,
    backgroundcolor=white,value={}]{}
\\end{minipage}%
\\begin{minipage}[t]{0.38\\linewidth}\\raggedleft
  \\PushButton[name=CalcBtn,bordercolor=etnavy,backgroundcolor=etblue!25,
    borderwidth=1,charsize=10pt,
    onclick={etFeedback(this);}]{\\ Calculate Score\\ }\\ %
  \\PushButton[name=ResetBtn,bordercolor=etnavy,backgroundcolor=etblue!8,
    borderwidth=1,charsize=10pt,
    onclick={etReset(this);}]{\\ Clear all\\ }
\\end{minipage}

\\vspace{7pt}
\\textbf{Wrong questions:}\\\\[2pt]
\\TextField[name=WrongList,width=\\linewidth,height=34pt,multiline,readonly,
  charsize=9pt,bordercolor=etblue!60,borderwidth=0.6,
  backgroundcolor=white,value={}]{}

\\vspace{4pt}
\\textbf{Unanswered questions:}\\\\[2pt]
\\TextField[name=BlankList,width=\\linewidth,height=34pt,multiline,readonly,
  charsize=9pt,bordercolor=etblue!60,borderwidth=0.6,
  backgroundcolor=white,value={}]{}

\\vspace{4pt}
{\\scriptsize\\itshape\\color{etgrey}
Each correct answer is worth 1 point. Wrong or unanswered choices are
worth 0 points. Interactive scoring requires Adobe Acrobat Reader.}
\\end{tcolorbox}

\\vspace{8pt}
{\\sffamily\\bfseries\\color{etnavy} Objective coverage \\& mastery}\\hfill
{\\scriptsize\\itshape\\color{etgrey}
 Colours appear after pressing \\textbf{Calculate Score}}

\\vspace{3pt}
{\\footnotesize
\\setlength{\\tabcolsep}{3.5pt}\\renewcommand{\\arraystretch}{1.45}
\\begin{tabular}{|l|c|l|c||l|c|l|c|}
\\hline
\\rowcolor{etblue!12}
\\textbf{Obj.} & \\textbf{It.} & \\textbf{Questions} & \\textbf{Result} &
\\textbf{Obj.} & \\textbf{It.} & \\textbf{Questions} & \\textbf{Result}\\\\\\hline
${tableRows.join('\n')}
\\end{tabular}}

\\vspace{5pt}
{\\footnotesize
\\begin{tikzpicture}[baseline=-2pt]
  \\shade[left color=masred,middle color=masmid,right color=masgreen]
        (0,0) rectangle (4.6,0.26);
  \\draw[black!45,line width=0.3pt] (0,0) rectangle (4.6,0.26);
  \\foreach \\x in {1.15,2.3,3.45}{\\draw[black!45,line width=0.3pt] (\\x,0)--(\\x,0.26);}
  \\node[font=\\scriptsize,anchor=east] at (-0.15,0.13) {0\\%};
  \\node[font=\\scriptsize,anchor=west] at (4.75,0.13) {100\\%};
\\end{tikzpicture}\\quad
{\\scriptsize\\itshape\\color{etgrey}
 Red = objective not yet mastered, green = mastered.
 Focus remediation on the reddest rows.}}

\\end{Form}
\\end{document}
`;

  return { tex: doc, images: imagesUsedBy(questions), questionCount: questions.length };
}

/* ----------------------------------------------------------------- zipping
 * A worksheet that uses photographs has to travel with them, and both places it
 * can go -- a download and Overleaf's importer -- take a zip. Entries are
 * stored, not deflated: JPEG and PNG are already compressed, the .tex is small,
 * and a STORE-only writer is thirty lines instead of a dependency. */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0 ^ (-1);
  for (let i = 0; i < bytes.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ bytes[i]) & 0xFF];
  return (c ^ (-1)) >>> 0;
}

/* files: [{ name, data: Uint8Array }] -> Uint8Array of a zip archive. */
function buildZip(files) {
  const enc = s => {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    return Uint8Array.from(Buffer.from(s, 'utf8'));
  };
  const chunks = [];
  const central = [];
  let offset = 0;
  const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

  files.forEach(f => {
    const nameBytes = enc(f.name);
    const crc = crc32(f.data);
    const local = [].concat(
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(f.data.length), u32(f.data.length),
      u16(nameBytes.length), u16(0));
    chunks.push(Uint8Array.from(local), nameBytes, f.data);
    central.push({ crc, size: f.data.length, nameBytes, offset });
    offset += local.length + nameBytes.length + f.data.length;
  });

  const dirStart = offset;
  central.forEach(e => {
    const head = [].concat(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(e.crc), u32(e.size), u32(e.size),
      u16(e.nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(e.offset));
    chunks.push(Uint8Array.from(head), e.nameBytes);
    offset += head.length + e.nameBytes.length;
  });

  chunks.push(Uint8Array.from([].concat(
    u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
    u32(offset - dirStart), u32(dirStart), u16(0))));

  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  chunks.forEach(c => { out.set(c, p); p += c.length; });
  return out;
}

const WorksheetExport = {
  buildWorksheetTex, texEscape, texBody, splitOptionList,
  diagramTexFor, imagesUsedBy, masteryRows, collapseRuns, crc32, buildZip
};

root.WorksheetExport = WorksheetExport;
if (typeof module !== 'undefined' && module.exports) module.exports = WorksheetExport;

})(typeof window !== 'undefined' ? window : globalThis);
