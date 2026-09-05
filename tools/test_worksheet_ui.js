/* Exporting a session as an interactive worksheet, in a real browser.
 *
 * The point of this file is the last section: the .tex the BROWSER produced is
 * written to disk and run through pdflatex. A generator tested only against its
 * own expectations proves nothing -- the thing that matters is whether the file
 * an instructor downloads actually compiles, and whether the PDF that comes out
 * marks itself with the right key. */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE = 'http://127.0.0.1:8902/energytech-mathquiz/index.html';
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

let overleafPosts = [];

function route(p) {
  return p.route(/script\.google\.com/, r => {
    const req = r.request();
    if (req.method() === 'POST') return r.fulfill({ status: 200, body: 'ok' });
    const q = Object.fromEntries(new URL(req.url()).searchParams);
    let d = { ok: true, message: 'ok' };
    if (q.action === 'auth_login') d = { ok: true, token: 'ADMTOK', username: 'adnen',
      displayName: 'Adnane Khalifa', role: 'admin' };
    if (q.action === 'admin_list_instructors') d = { ok: true, instructors: [] };
    if (q.action === 'roster_list') d = { ok: true,
      intakes: [{ label: 'JAN26', status: 'active' }],
      groups: [{ intake: 'JAN26', name: 'G1', trainees: 4, withAccount: 4 }] };
    if (q.action === 'trainee_list') d = { ok: true, trainees: [] };
    if (q.action === 'session_list') d = { ok: true, sessions: [] };
    if (q.action === 'session') d = { ok: true, session: { sessionCode: q.code } };
    return r.fulfill({ status: 200, contentType: 'application/javascript',
      body: q.callback + '(' + JSON.stringify(d) + ');' });
  });
}

/* Overleaf is never actually called: the form is caught here so the test can
 * read what would have been posted. Routed on the CONTEXT, not the page -- the
 * form opens in a new tab, and a page-level route does not see it. */
function routeOverleaf(ctx) {
  return ctx.route(/overleaf\.com\/docs/, async r => {
    const req = r.request();
    overleafPosts.push({ method: req.method(), body: req.postData() || '' });
    await r.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>overleaf stub</body></html>' });
  });
}

const visible = (p, sel) => p.evaluate(s => {
  const el = document.querySelector(s);
  return Boolean(el && el.offsetParent !== null);
}, sel);

const textOf = (p, sel) => p.evaluate(s => {
  const el = document.querySelector(s);
  return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
}, sel);

/* Tick a chapter in the question tree, set a size, and press Create.
 *
 * The seed is pinned. Left alone the app seeds from Date.now(), so the paper is
 * a different random draw every run -- and which questions are drawn decides
 * which branch of the export is taken, because only a paper carrying
 * photographs is posted as a zip. This test used to pass or fail on that
 * accident: a Chapter 03 draw that happened to include none of the sixteen
 * picture questions sent bare LaTeX, and the zip assertions below failed on a
 * file that was never a zip. Each section now states which branch it expects
 * and checks the paper really is that shape before relying on it. */
async function makeSession(p, { label, count, mode, name, seed }) {
  await p.evaluate(s => {
    const el = document.getElementById('seedInput');
    if (el) { el.value = s; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, seed || 'WS-TEST-SEED');
  await p.evaluate(t => {
    const box = [...document.querySelectorAll('#questionTree input[type=checkbox]')]
      .find(b => {
        const row = b.closest('label') || b.parentElement;
        return row && row.textContent.includes(t);
      });
    if (!box) throw new Error('no tick box matching ' + t);
    if (!box.checked) box.click();
  }, label);
  await p.waitForTimeout(250);
  await p.evaluate(n => {
    const el = document.getElementById('questionCount');
    el.value = String(n);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, count);
  if (name) await p.evaluate(v => {
    const el = document.getElementById('sessionName');
    if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, name);
  await p.selectOption('#sessionMode', mode || 'practice');
  await p.click('#createSessionBtn');
  await p.waitForSelector('#worksheetExport:not([hidden])', { timeout: 15000 });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsui-'));
  const browser = await chromium.launch({ executablePath: EXEC });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await route(p);
  await routeOverleaf(ctx);

  await p.goto(BASE);
  await p.click('#teacherModeBtn');
  await p.fill('#teacherLoginUsername', 'adnen');
  await p.fill('#teacherLoginPassword', 'x');
  await p.click('#teacherLoginBtn');
  await p.waitForSelector('#teacherInterface:not([hidden])');

  console.log('\n=== 1. Nothing to export before there is a session ===');
  ok(!(await visible(p, '#worksheetExport')), 'the export panel is not on screen yet');

  console.log('\n=== 2. Creating a session offers the worksheet ===');
  await makeSession(p, { label: 'Chapters 01 & 02', count: 12, mode: 'practice', name: 'Week 3 practice' });
  ok(await visible(p, '#worksheetExport'), 'the export panel appears with the code');
  // Stated, not assumed: everything in section 4 rests on this being the
  // no-photographs branch.
  eq(await p.evaluate(() => WorksheetExport.imagesUsedBy(currentQuiz).length), 0,
    'this paper carries no photographs, so the export can post bare LaTeX');
  ok(await visible(p, '#overleafExportBtn'), 'Open in Overleaf is offered');
  ok(await visible(p, '#texExportBtn'), 'and a .tex download as well');

  console.log('\n=== 3. The warning is part of the control, not a footnote ===');
  // The key has to be in the file for the PDF to mark itself. An instructor who
  // hands the file out early hands out the answers, so this must be said where
  // the buttons are, every time, not buried in a README.
  const warn = await textOf(p, '#worksheetWarning');
  ok(/answer key is inside the file/i.test(warn || ''), 'the export says the key travels with it');
  ok(/before they have sat/i.test(warn || ''), 'and what that means in practice');
  ok(await visible(p, '#worksheetWarning'), 'and it is on screen, not hidden behind a toggle');

  console.log('\n=== 4. Open in Overleaf posts the worksheet ===');
  overleafPosts = [];
  await p.click('#overleafExportBtn');
  await p.waitForTimeout(1200);
  eq(overleafPosts.length, 1, 'one POST to Overleaf');
  const post = overleafPosts[0] || { method: '', body: '' };
  eq(post.method, 'POST', 'posted, not linked');
  const fields = new URLSearchParams(post.body);
  eq(fields.get('engine'), 'pdflatex', 'the engine is named, because the machinery is pdfTeX-only');
  const snip = fields.get('snip') || '';
  ok(snip.length > 500, `the LaTeX itself is in the body (${snip.length} chars)`);
  ok(/\\begin\{wsq\}/.test(snip), 'with the question environments');
  ok(/var ANSWER = \[/.test(snip), 'and the answer key');
  ok(/Week 3 practice/.test(snip), 'and the session name');
  // The browser is where this went wrong: two scripts sharing one global scope,
  // both defining splitChoices, and app.js loading second. Every option came
  // out as "[object Object]" and the worksheet still compiled.
  ok(!/\[object Object\]/.test(snip), 'and no option was stringified into an object');
  const optCount = (snip.match(/\\opt\{/g) || []).length;
  const wantOpts = await p.evaluate(() =>
    currentQuiz.reduce((a, q) => a + String(q.choices || '').split(/\\item\s+/).filter(s => s.trim()).length, 0));
  eq(optCount, wantOpts, 'one \\opt per choice, taken from the questions themselves');
  const firstOption = await p.evaluate(() =>
    String(currentQuiz[0].choices || '').split(/\\item\s+/).map(s => s.trim()).filter(Boolean)[0]);
  ok(snip.includes(`\\opt{${firstOption}}`), `and the text is the real option (${firstOption.slice(0, 24)})`);

  console.log('\n=== 5. The paper in the file is the paper the trainees get ===');
  // Not a fresh draw: the same questions, in the same order, as the reference
  // copy the app built when the code was created.
  const onScreen = await p.evaluate(() => currentQuiz.map(q => q.answer).join(','));
  const inFile = (snip.match(/var ANSWER = \[([\s\S]*?)\];/) || [, ''])[1]
    .split(',').map(s => s.trim().replace(/"/g, '')).filter(Boolean).join(',');
  eq(inFile, onScreen, 'the exported key is the reference paper, question for question');
  const nq = Number((snip.match(/var NQ = (\d+);/) || [, 0])[1]);
  eq(nq, await p.evaluate(() => currentQuiz.length), 'and the count agrees');

  console.log('\n=== 6. Downloading gives a compilable file ===');
  const dl = await Promise.all([p.waitForEvent('download'), p.click('#texExportBtn')]);
  const file = dl[0];
  const code = await p.evaluate(() => currentSession.sessionCode);
  eq(file.suggestedFilename(), `worksheet_${code.replace(/[^\w-]/g, '')}.tex`,
    'the file is named after the session code');
  const texPath = path.join(tmp, 'worksheet.tex');
  await file.saveAs(texPath);
  ok(fs.statSync(texPath).size > 5000, 'and is a real file, not an empty one');

  console.log('\n=== 7. pdflatex actually compiles what the browser produced ===');
  // The whole feature rests on this. Everything above could pass while the file
  // fails to build.
  let compiled = false, pdfPath = path.join(tmp, 'worksheet.pdf');
  try {
    for (let pass = 0; pass < 2; pass++) {
      execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'worksheet.tex'],
        { cwd: tmp, stdio: 'pipe' });
    }
    compiled = fs.existsSync(pdfPath);
  } catch (err) {
    const log = fs.existsSync(path.join(tmp, 'worksheet.log'))
      ? fs.readFileSync(path.join(tmp, 'worksheet.log'), 'utf8') : '';
    const bang = (log.match(/^!.*$/m) || ['(no ! line)'])[0];
    console.log('    pdflatex said: ' + bang);
  }
  ok(compiled, 'the downloaded worksheet compiles with pdflatex');

  if (compiled) {
    const fieldDump = execFileSync('pdftk', [pdfPath, 'dump_data_fields'], { encoding: 'utf8' });
    const names = [...fieldDump.matchAll(/^FieldName: (.+)$/gm)].map(m => m[1]);
    const radios = names.filter(n => /^Q\d+$/.test(n));
    eq(radios.length, nq, 'the PDF has one radio group per question');
    ['Total', 'Score', 'Percent', 'WrongList', 'BlankList', 'CalcBtn', 'ResetBtn'].forEach(f =>
      ok(names.includes(f), `the score panel has ${f}`));
    ok(names.some(n => /^M\d+$/.test(n)), 'and the mastery table has its cells');

    // The name tree lives inside a compressed object stream, so grepping the
    // bytes finds nothing even when the scripts are there. Ask a PDF library.
    const probe = execFileSync('python3', ['-c', `
import sys, re, warnings; warnings.filterwarnings('ignore')
import pypdf
r = pypdf.PdfReader(sys.argv[1])
names = r.trailer['/Root']['/Names']['/JavaScript']['/Names']
blobs = {str(names[i]): names[i+1].get_object()['/JS'].get_data().decode('latin-1')
         for i in range(0, len(names), 2)}
key = blobs.get('ETW01key', '')
letters = re.findall(r'"(\\w)"', (re.search(r'var ANSWER = \\[(.*?)\\];', key, re.S) or [None,''])[1] if re.search(r'var ANSWER = \\[(.*?)\\];', key, re.S) else '')
print(len(blobs), ','.join(letters))
print('etFeedback' in blobs.get('ETW02lib',''))
`, pdfPath], { encoding: 'utf8' }).trim().split('\n');
    const [scriptCount, keyInPdf] = probe[0].split(' ');
    eq(Number(scriptCount), 2, 'the PDF carries both document-level scripts');
    eq(keyInPdf, onScreen, 'and the key inside the PDF is the paper the app built');
    eq(probe[1], 'True', 'and the grading engine came with it');
  }

  console.log('\n=== 8. A paper with photographs travels with them ===');
  // Chapter 03 questions carry JPEGs. Those cannot be posted as bare LaTeX, so
  // the export switches to a zip -- and the zip has to contain the pictures, or
  // the compile fails on a missing file.
  await p.evaluate(() => {
    document.querySelectorAll('#questionTree input[type=checkbox]').forEach(b => { if (b.checked) b.click(); });
  });
  await p.waitForTimeout(300);
  // The whole of Chapter 03, so all sixteen picture questions are on the paper
  // whatever the draw does -- the zip branch has to be reached by construction,
  // not by luck.
  await makeSession(p, { label: 'Chapter 03', count: 9999, mode: 'assessment', name: 'Ch03 exam' });
  const picCount = await p.evaluate(() => WorksheetExport.imagesUsedBy(currentQuiz).length);
  ok(picCount > 0, `this paper carries photographs (${picCount}), so the export must zip them`);
  overleafPosts = [];
  await p.waitForTimeout(900);          // let the images prefetch
  await p.click('#overleafExportBtn');
  await p.waitForTimeout(1500);
  eq(overleafPosts.length, 1, 'one POST for the picture paper too');
  const f2 = new URLSearchParams(overleafPosts[0].body);
  const uri = f2.get('snip_uri') || '';
  ok(/^data:application\/zip;base64,/.test(uri), 'sent as a base64 zip rather than bare LaTeX');
  eq(f2.get('main_document'), 'worksheet.tex', 'and names which file to build');

  const zipPath = path.join(tmp, 'bundle.zip');
  fs.writeFileSync(zipPath, Buffer.from(uri.replace(/^data:application\/zip;base64,/, ''), 'base64'));
  const listing = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' }).trim().split('\n');
  ok(listing.includes('worksheet.tex'), 'the zip holds the worksheet');
  const pics = listing.filter(n => /\.(jpg|png)$/i.test(n));
  ok(pics.length > 0, `and the pictures it needs (${pics.length})`);

  const zipDir = path.join(tmp, 'zipbuild');
  fs.mkdirSync(zipDir, { recursive: true });
  execFileSync('unzip', ['-o', zipPath, '-d', zipDir], { stdio: 'pipe' });
  let zipCompiled = false;
  try {
    for (let pass = 0; pass < 2; pass++) {
      execFileSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'worksheet.tex'],
        { cwd: zipDir, stdio: 'pipe' });
    }
    zipCompiled = fs.existsSync(path.join(zipDir, 'worksheet.pdf'));
  } catch {
    const log = path.join(zipDir, 'worksheet.log');
    if (fs.existsSync(log)) console.log('    pdflatex said: ' + ((fs.readFileSync(log, 'utf8').match(/^!.*$/m) || [''])[0]));
  }
  ok(zipCompiled, 'and the zip compiles as posted, pictures and all');

  console.log('\n=== 9. An exam exports too, and says the same thing about the key ===');
  // The instructor chose to have exams export a self-marking paper as well, so
  // the only protection is the warning -- which must therefore still be there.
  ok(await visible(p, '#worksheetWarning'), 'the warning is shown for an exam as well');
  ok(/Ch03 exam/.test(Buffer.from(uri.replace(/^data:application\/zip;base64,/, ''), 'base64').toString('latin1')),
    'and the exam name is in the worksheet');

  console.log('\n=== 10. No page errors ===');
  ok(errs.length === 0, errs.length ? errs.join(' | ') : 'none');

  await browser.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})();
