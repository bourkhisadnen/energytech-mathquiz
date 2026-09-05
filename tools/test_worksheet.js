/* The worksheet exporter, without a browser.
 *
 * Two halves. The first checks the pieces -- escaping, diagram substitution,
 * the mastery table. The second is the one that matters: it picks the questions
 * in the bank that are known to be awkward for pdfTeX and runs them through
 * pdflatex for real. Every hazard here was found by compiling, not by reading:
 * a bank written for a browser renderer is full of LaTeX that only nearly
 * works, and the only way to know is to build it. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const APP = '/tmp/energytech_app/energytech_quiz_app_session_sync_fixed';
global.window = {};
require(APP + '/question_bank.js');
require(APP + '/question_bank_ch03.js');
const W = require(APP + '/worksheet_tex.js');

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

const BANK = [];
for (const [k, v] of Object.entries(window.QUESTION_BANK_SETS || {}))
  v.questions.forEach(q => BANK.push(Object.assign({ __set: 'ch12:' + k }, q)));
for (const [k, v] of Object.entries(window.QUESTION_BANK_SETS_CH03 || {}))
  v.questions.forEach(q => BANK.push(Object.assign({ __set: 'ch03:' + k }, q)));

const SESSION = { sessionCode: 'G1-9001', sessionName: 'Midterm exam', intake: 'JAN26',
                  group: 'G1', mode: 'assessment', questionSet: 'Chapters 01 & 02' };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wstex-'));

/* Build a paper and run it through pdflatex twice, as the instructions say to.
 * Returns { compiled, errors, pdf } -- never throws, so one bad case does not
 * hide the rest. */
function compile(label, questions, session) {
  const dir = path.join(tmp, label);
  fs.mkdirSync(dir, { recursive: true });
  const out = W.buildWorksheetTex(session || SESSION, questions);
  fs.writeFileSync(path.join(dir, 'worksheet.tex'), out.tex);
  out.images.forEach(src => fs.copyFileSync(path.join(APP, src), path.join(dir, src.replace(/^.*\//, ''))));
  let compiled = false;
  for (let pass = 0; pass < 2; pass++) {
    try { execFileSync('pdflatex', ['-interaction=nonstopmode', 'worksheet.tex'], { cwd: dir, stdio: 'pipe' }); }
    catch { /* nonstopmode keeps going; the log is the verdict */ }
  }
  const logPath = path.join(dir, 'worksheet.log');
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  const errors = (log.match(/^!.*$/gm) || []);
  compiled = fs.existsSync(path.join(dir, 'worksheet.pdf'));
  return { compiled, errors, dir, out, firstError: errors[0] || '' };
}

console.log('\n=== 1. Escaping what the instructor typed ===');
// Question bodies are LaTeX and must not be touched. Everything a person types
// into a form must be, or one ampersand in a session name kills the compile.
eq(W.texEscape('R&D 50% _test_ #1 {x} $5'),
   'R\\&D 50\\% \\_test\\_ \\#1 \\{x\\} \\$5', 'the characters TeX reserves are escaped');
eq(W.texEscape('a~b^c'), 'a\\textasciitilde{}b\\textasciicircum{}c', 'and the two that need commands');
eq(W.texEscape(null), '', 'nothing becomes nothing, not the word null');

console.log('\n=== 2. What the browser leaves behind ===');
eq(W.texBody({ body: 'See it.\\par[[DIAGRAM]]\\par done' }, '\\PICTURE'),
   'See it.\\par\\PICTURE\\par done', 'the diagram placeholder is replaced');
eq(W.texBody({ body: 'one<br>two' }, ''), 'one\\par two', 'a stray <br> becomes a paragraph break');
// "\parRound your answer" is one undefined control sequence to TeX.
eq(W.texBody({ body: 'x\\parRound to 2dp' }, ''), 'x\\par Round to 2dp',
   'a paragraph break run into a capital is separated');
eq(W.texBody({ body: 'a\\parbox{1cm}{b}' }, ''), 'a\\parbox{1cm}{b}',
   'but \\parbox, a real macro, is left alone');

console.log('\n=== 3. Choices and diagrams ===');
eq(W.splitOptionList('\\item 686 \\item 1,454 \\item 200'), ['686', '1,454', '200'], 'choices split on \\item');
eq(W.splitOptionList(''), [], 'and nothing splits to nothing');
ok(/\\taperuler\{11\}\{17\}\{14\.6\}/.test(
     W.diagramTexFor({ diagram: { type: 'tape', start: 11, end: 17, reading: 14.6 } })),
   'a tape ruler carries its own scale and reading, in that order');
ok(/\\etcircuit\{1\/420,2\/680\}\{8\/1800\}/.test(
     W.diagramTexFor({ diagram: { type: 'circuit', top: [[1, 420], [2, 680]], bottom: [[8, 1800]] } })),
   'a circuit carries its resistor values');
ok(/\{original_q07_circuit\.png\}/.test(
     W.diagramTexFor({ diagram: { type: 'image', src: 'images/original_q07_circuit.png' } })),
   'an image is referenced by name only, because it is bundled beside the .tex');
eq(W.diagramTexFor({}), '', 'and a question with no diagram adds nothing');

console.log('\n=== 4. The mastery table is built from the paper, not hardcoded ===');
eq(W.collapseRuns([1, 2, 3, 4, 7, 9, 10, 11]), 'Q1--Q4, Q7, Q9--Q11', 'runs collapse, pairs do not');
eq(W.collapseRuns([5, 6]), 'Q5, Q6', 'two in a row stay separate, which reads better than a range of two');
const rows = W.masteryRows([{ lesson: '1-2' }, { lesson: '1-1' }, { lesson: '1-2' }, { lesson: '1-1' }]);
eq(rows.map(r => `${r.lesson}:${r.count}:${r.questions}`), ['1-1:2:Q2, Q4', '1-2:2:Q1, Q3'],
   'each objective counts its own questions, by their number on the paper');

console.log('\n=== 5. The key is the paper, in order ===');
const five = BANK.slice(0, 5);
const built = W.buildWorksheetTex(SESSION, five);
const keyIn = (built.tex.match(/var ANSWER = \[([\s\S]*?)\];/) || [, ''])[1]
  .split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
eq(keyIn, five.map(q => String(q.answer)), 'ANSWER[n-1] is the answer to question n');
ok(/var NQ = 5;/.test(built.tex), 'and NQ is the number of questions');
// Reordering the paper must reorder the key with it.
const flipped = W.buildWorksheetTex(SESSION, five.slice().reverse());
const keyFlip = (flipped.tex.match(/var ANSWER = \[([\s\S]*?)\];/) || [, ''])[1]
  .split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean);
eq(keyFlip, five.map(q => String(q.answer)).reverse(), 'a reordered paper gets a reordered key');
let threw = '';
try { W.buildWorksheetTex(SESSION, []); } catch (e) { threw = e.message; }
ok(/no questions/i.test(threw), 'an empty paper is refused rather than exported blank');

console.log('\n=== 5b. The options on the paper are the options in the bank ===');
// This is not obvious padding. The exporter once shared a function name with
// one in app.js, app.js won in the browser, and every option came out as
// "[object Object]". The worksheet still compiled and still had four radio
// buttons per question, so nothing else in this file noticed.
five.forEach((q, i) => {
  W.splitOptionList(q.choices).forEach(opt => {
    ok(built.tex.includes(`\\opt{${opt}}`), `Q${i + 1} keeps its option ${JSON.stringify(opt.slice(0, 24))}`);
  });
});
ok(!/\[object Object\]/.test(built.tex), 'and nothing was stringified into an object');
eq((built.tex.match(/\\opt\{/g) || []).length,
   five.reduce((a, q) => a + W.splitOptionList(q.choices).length, 0),
   'with one \\opt per choice, no more and no fewer');

console.log('\n=== 6. The session is named on the paper ===');
const named = W.buildWorksheetTex(
  Object.assign({}, SESSION, { sessionName: 'R&D review #2' }), five);
ok(/R\\&D review \\#2/.test(named.tex), 'and a name with reserved characters is escaped, not dropped');
ok(/G1-9001/.test(named.tex) && /JAN26/.test(named.tex), 'with the code and intake beside it');

console.log('\n=== 7. Only the images the paper actually uses ===');
const withPics = BANK.filter(q => q.diagram && q.diagram.type === 'image').slice(0, 4);
const dup = W.imagesUsedBy(withPics.concat(withPics));
eq(dup.length, new Set(dup).size, 'each image is listed once however often it is used');
eq(W.imagesUsedBy(BANK.filter(q => !q.diagram).slice(0, 20)), [],
   'and a paper of pure arithmetic carries none');

console.log('\n=== 8. The zip is a real zip ===');
const zip = W.buildZip([{ name: 'a.txt', data: Uint8Array.from(Buffer.from('hello')) },
                        { name: 'b.bin', data: Uint8Array.from([0, 1, 2, 253, 254, 255]) }]);
const zipPath = path.join(tmp, 'r.zip');
fs.writeFileSync(zipPath, Buffer.from(zip));
let zipOk = false;
try { execFileSync('unzip', ['-t', zipPath], { stdio: 'pipe' }); zipOk = true; } catch {}
ok(zipOk, 'unzip accepts it, checksums and all');
const outDir = path.join(tmp, 'unz');
fs.mkdirSync(outDir, { recursive: true });
execFileSync('unzip', ['-o', zipPath, '-d', outDir], { stdio: 'pipe' });
eq(fs.readFileSync(path.join(outDir, 'a.txt'), 'utf8'), 'hello', 'text comes back unchanged');
eq([...fs.readFileSync(path.join(outDir, 'b.bin'))], [0, 1, 2, 253, 254, 255], 'and bytes come back unchanged');

/* -------------------------------------------------------------------------
 * The compiling half. Each case is a hazard the bank actually contains.
 * ---------------------------------------------------------------------- */
console.log('\n=== 9. The awkward corners of the bank actually compile ===');

const find = (pred, n) => BANK.filter(pred).slice(0, n);

/* Every character in the bank that pdfLaTeX has to be told about, and a
 * question that actually contains it. Missing one means its declaration is
 * carried by nothing. */
const UNICODE_CHARS = ['…', '²', '³', '°', 'µ', '−', '×', '⁴', '’'];
const UNICODE_SAMPLE = [];
UNICODE_CHARS.forEach(ch => {
  const q = BANK.find(x => ((x.body || '') + (x.choices || '')).includes(ch));
  ok(Boolean(q), `the bank still has a question containing U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
  if (q && UNICODE_SAMPLE.indexOf(q) === -1) UNICODE_SAMPLE.push(q);
});
const CASES = [
  ['runon_par', find(q => /\\par[A-Z]/.test(q.body || ''), 6),
   'a paragraph break run into the next sentence'],
  // One question per character, not the first eight that match any of them:
  // superscript two is everywhere and would crowd out the degree sign, leaving
  // that declaration untested. Which is exactly what happened.
  ['unicode', UNICODE_SAMPLE, 'every non-ASCII character the bank uses'],
  ['bare_frac', find(q => /\\dfrac|\\frac/.test(q.choices || '') && !/\$/.test(q.choices || ''), 6),
   'a fraction used outside math mode'],
  ['tape', find(q => q.diagram && q.diagram.type === 'tape', 4), 'drawn tape measures'],
  ['circuit', find(q => q.diagram && q.diagram.type === 'circuit', 2), 'drawn series circuits'],
  ['pictures', find(q => q.diagram && q.diagram.type === 'image', 4), 'bundled photographs'],
  ['inline_tikz', find(q => /\\begin\{tikzpicture\}/.test(q.body || ''), 4), 'tikz already in the body'],
  ['calcstack', find(q => /\\calcstack/.test(q.body || ''), 4), 'column arithmetic']
];

for (const [label, qs, what] of CASES) {
  if (!qs.length) { ok(false, `${what} — no such question found in the bank`); continue; }
  const res = compile(label, qs);
  ok(res.compiled && !res.errors.length,
     `${what} (${qs.length} q)` + (res.errors.length ? ` — ${res.firstError.slice(0, 90)}` : ''));
}

console.log('\n=== 10. And the whole of one paper does too ===');
// A single set end to end, so nothing passes only because it was left out of a
// hand-picked sample.
const wholeSet = BANK.filter(q => q.__set === 'ch03:original_pdf');
const whole = compile('whole', wholeSet);
ok(whole.compiled && !whole.errors.length,
   `every question of ch03 original (${wholeSet.length} q)`
   + (whole.errors.length ? ` — ${whole.firstError.slice(0, 90)}` : ''));

if (whole.compiled) {
  const dump = execFileSync('pdftk', [path.join(whole.dir, 'worksheet.pdf'), 'dump_data_fields'],
    { encoding: 'utf8' });
  const names = [...dump.matchAll(/^FieldName: (.+)$/gm)].map(m => m[1]);
  eq(names.filter(n => /^Q\d+$/.test(n)).length, wholeSet.length,
     'one radio group per question, in the PDF itself');
  const key = execFileSync('python3', ['-c', `
import sys, re, warnings; warnings.filterwarnings('ignore')
import pypdf
r = pypdf.PdfReader(sys.argv[1])
names = r.trailer['/Root']['/Names']['/JavaScript']['/Names']
blobs = {str(names[i]): names[i+1].get_object()['/JS'].get_data().decode('latin-1')
         for i in range(0, len(names), 2)}
m = re.search(r'var ANSWER = \\[(.*?)\\];', blobs['ETW01key'], re.S)
print(','.join(re.findall(r'"(\\w)"', m.group(1))))
`, path.join(whole.dir, 'worksheet.pdf')], { encoding: 'utf8' }).trim();
  eq(key, wholeSet.map(q => String(q.answer).trim()).join(','),
     'and the key inside the compiled PDF is the bank key, question for question');
}

console.log('\n=== 11. The header is filled in on screen, not with a pen ===');
if (whole.compiled) {
  const pdf = path.join(whole.dir, 'worksheet.pdf');
  const pages = wholeSet.length && Number(execFileSync('python3', ['-c', `
import sys, warnings; warnings.filterwarnings('ignore')
import pypdf
print(len(pypdf.PdfReader(sys.argv[1]).pages))
`, pdf], { encoding: 'utf8' }).trim());

  // Structure: one field per name, one widget per page, and the boxes must not
  // sit on top of each other -- an annotation left outside a \makebox comes out
  // one slot early and the Group box lands on the word "Group:".
  const probe = execFileSync('python3', ['-c', `
import sys, warnings; warnings.filterwarnings('ignore')
import pypdf
r = pypdf.PdfReader(sys.argv[1])
acro = r.trailer['/Root']['/AcroForm']
want = ('Name', 'Group', 'EnergyTechID')
ent, kid, ft = {}, {}, {}
for f in acro['/Fields']:
    o = f.get_object(); t = str(o.get('/T', ''))
    if t in want:
        ent[t] = ent.get(t, 0) + 1
        kid[t] = len(o.get('/Kids') or [])
        ft[t] = str(o.get('/FT'))
print('|'.join(f'{k}:{ent.get(k,0)}:{kid.get(k,0)}:{ft.get(k,"-")}' for k in want))
rects = {}
for a in (r.pages[0].get('/Annots') or []):
    o = a.get_object(); par = o.get('/Parent')
    t = str(par.get_object().get('/T')) if par else str(o.get('/T'))
    if t in want: rects[t] = [float(x) for x in o['/Rect']]
def overlaps(a, b):
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])
pairs = [(x, y) for i, x in enumerate(want) for y in want[i+1:] if x in rects and y in rects]
print(sum(1 for x, y in pairs if overlaps(rects[x], rects[y])))
print(int(all(rects[k][2] > rects[k][0] and rects[k][3] > rects[k][1] for k in rects)))
`, pdf], { encoding: 'utf8' }).trim().split('\n');

  probe[0].split('|').forEach(part => {
    const [nm, entries, kids, type] = part.split(':');
    eq(Number(entries), 1, `${nm} is one field, not one per page`);
    eq(Number(kids), pages, `${nm} has a widget on every page (${pages})`);
    eq(type, '/Tx', `${nm} is a text field the trainee can type into`);
  });
  eq(Number(probe[1]), 0, 'and no two header boxes overlap each other');
  eq(Number(probe[2]), 1, 'each box has a real rectangle');

  // The point of the whole thing: type, save, and it is still there.
  const roundTrip = execFileSync('python3', ['-c', `
import sys, warnings, os; warnings.filterwarnings('ignore')
import pypdf
from pypdf.generic import TextStringObject, NameObject
src, out = sys.argv[1], sys.argv[2]
w = pypdf.PdfWriter(clone_from=src)
vals = {'Name': 'Mohammed Al-Otaibi', 'Group': 'G1', 'EnergyTechID': 'ET1001'}
for f in w._root_object['/AcroForm']['/Fields']:
    o = f.get_object(); t = str(o.get('/T', ''))
    if t in vals: o[NameObject('/V')] = TextStringObject(vals[t])
w.write(out)
got = pypdf.PdfReader(out).get_fields()
print('|'.join(str(got[k].get('/V')) for k in ('Name', 'Group', 'EnergyTechID')))
print(pypdf.PdfReader(out).trailer['/Root']['/AcroForm'].get('/NeedAppearances'))
`, pdf, path.join(whole.dir, 'filled.pdf')], { encoding: 'utf8' }).trim().split('\n');
  eq(roundTrip[0], 'Mohammed Al-Otaibi|G1|ET1001',
     'what is typed into the header survives being saved and reopened');
  eq(roundTrip[1], 'True',
     'and NeedAppearances is set, so a viewer draws the text it was given');

  // Clearing the answers must not clear who you are.
  const graderJs = execFileSync('python3', ['-c', `
import sys, warnings; warnings.filterwarnings('ignore')
import pypdf
r = pypdf.PdfReader(sys.argv[1])
names = r.trailer['/Root']['/Names']['/JavaScript']['/Names']
blobs = {str(names[i]): names[i+1].get_object()['/JS'].get_data().decode('latin-1')
         for i in range(0, len(names), 2)}
print(blobs.get('ETW02lib', ''))
`, pdf], { encoding: 'utf8' });
  const reset = (graderJs.match(/function etReset\(doc\)[\s\S]*?\n\}/) || [''])[0];
  ok(/resetForm\(fields\)/.test(reset), 'Clear all resets a named list of fields');
  ok(!/resetForm\(\s*\)/.test(reset), 'and never bare resetForm(), which would wipe the header too');
  ['Name', 'Group', 'EnergyTechID'].forEach(f =>
    ok(!new RegExp(`push\\("${f}"\\)`).test(reset), `${f} is not in the list Clear all empties`));
  ok(/push\("Q" \+ i\)/.test(reset), 'while every question answer is');
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
