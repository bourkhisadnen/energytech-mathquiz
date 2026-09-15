/* Exporting a session as an interactive worksheet, in a real browser -- against
 * the REAL energytech-api backend (Express + Postgres). Repointed for Phase 6
 * from the mocked-Apps-Script version this file used to be; see
 * test_roster.js's header for the shared mechanics (served from public/ via
 * src/app.js, seeded/asserted through TEST_DATABASE_URL, never DATABASE_URL).
 * Login is the only thing that now goes through the real backend -- paper
 * building, scoring and worksheet export are entirely client-side (D1/D2) and
 * the migration never touched them.
 *
 * The point of this file is the last section: the .tex the BROWSER produced is
 * written to disk and run through pdflatex. A generator tested only against its
 * own expectations proves nothing -- the thing that matters is whether the file
 * an instructor downloads actually compiles, and whether the PDF that comes out
 * marks itself with the right key. */
const path = require('path');
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const ENERGYTECH_API_ROOT = path.join(__dirname, '..', '..', 'energytech-api');
require('dotenv').config({ path: path.join(ENERGYTECH_API_ROOT, '.env') });

const { resetDb, insertInstructor, pool } = require(path.join(ENERGYTECH_API_ROOT, 'tests', 'helpers', 'db'));
const { hashPasswordForStorage } = require(path.join(ENERGYTECH_API_ROOT, 'src', 'lib', 'passwords'));
const app = require(path.join(ENERGYTECH_API_ROOT, 'src', 'app'));

let failures = [], checks = 0;
const ok = (c, l) => { checks++; console.log((c ? '  PASS  ' : '  FAIL  ') + l); if (!c) failures.push(l); };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b), `${l} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

async function seedInstructor(username, displayName, role, password) {
  const { passwordHash, passwordSalt, passwordAlgo } = await hashPasswordForStorage(password);
  await insertInstructor({ username, displayName, role, passwordHash, passwordSalt, passwordAlgo });
}

// MiKTeX on Windows refuses \openout on any extension in this list -- the
// exact reason etgrader.js/etkey.js had to become etgrader.js.dat/etkey.js.dat
// (claude/08-interactive-worksheet-export.md, "The embedded scripts are
// .js.dat, not .js"). Overleaf compiles either way, so nothing on that path
// would ever catch one of the two names drifting back to a blocked extension
// -- this scan of the actual generated .tex is the only thing that does.
const WINDOWS_AUTORUN_EXTENSIONS = ['com', 'exe', 'bat', 'cmd', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'msc'];
function filesWrittenByFilecontents(tex) {
  return [...tex.matchAll(/\\begin\{filecontents\*\}\[overwrite\]\{([^}]+)\}/g)].map(m => m[1]);
}
function assertNoAutorunExtensions(tex, label) {
  const written = filesWrittenByFilecontents(tex);
  ok(written.length > 0, `${label}: writes at least one embedded file (${written.length})`);
  written.forEach(name => {
    const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
    ok(!WINDOWS_AUTORUN_EXTENSIONS.includes(ext),
      `${label}: ${name} does not use a Windows-autorun extension (.${ext})`);
  });
}

let overleafPosts = [];

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
async function makeSession(p, { label, paperKey, count, mode, name, seed }) {
  await p.evaluate(s => {
    const el = document.getElementById('seedInput');
    if (el) { el.value = s; el.dispatchEvent(new Event('input', { bubbles: true })); }
  }, seed || 'WS-TEST-SEED');
  // paperKey selects one exact paper's checkbox by its data-paper key
  // (e.g. "ch12a:original_pdf"), which label-text matching can no longer do
  // now that several chapters share the "Original PDF worksheet" label --
  // label stays available for chapter-level rows, whose text is unique.
  if (paperKey) {
    await p.evaluate(k => {
      const box = document.querySelector(`#questionTree input[data-level="paper"][data-paper="${k}"]`);
      if (!box) throw new Error('no tick box for paper ' + k);
      if (!box.checked) box.click();
    }, paperKey);
  } else {
    await p.evaluate(t => {
      const box = [...document.querySelectorAll('#questionTree input[type=checkbox]')]
        .find(b => {
          const row = b.closest('label') || b.parentElement;
          return row && row.textContent.includes(t);
        });
      if (!box) throw new Error('no tick box matching ' + t);
      if (!box.checked) box.click();
    }, label);
  }
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
  await resetDb();
  await seedInstructor('adnen', 'Adnane Khalifa', 'admin', '1231234');

  const server = app.listen(0);
  const { port } = server.address();
  const BASE = `http://127.0.0.1:${port}/index.html`;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsui-'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await routeOverleaf(ctx);

  await p.goto(BASE);
  await p.click('#teacherModeBtn');
  await p.fill('#teacherLoginUsername', 'adnen');
  await p.fill('#teacherLoginPassword', '1231234');
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
  assertNoAutorunExtensions(fs.readFileSync(texPath, 'utf8'), 'the downloaded .tex');

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
    // Field-name enumeration only (no /Kids or /Rect), so pypdf's own
    // AcroForm walk -- already used just below for this PDF's scripts and
    // key -- gives this the identical list pdftk's dump_data_fields would
    // have.
    const names = execFileSync('python3', ['-c', `
import sys, warnings; warnings.filterwarnings('ignore')
import pypdf
r = pypdf.PdfReader(sys.argv[1])
acro = r.trailer['/Root']['/AcroForm']
print('\\n'.join(str(f.get_object().get('/T', '')) for f in acro['/Fields']))
`, pdfPath], { encoding: 'utf8' })
      // Python's print() translates \n to \r\n in text mode on Windows;
      // strip it rather than let a trailing \r break the field-name match.
      .replace(/\r/g, '').trim().split('\n').filter(Boolean);
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
`, pdfPath], { encoding: 'utf8' }).replace(/\r/g, '').trim().split('\n');
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

  console.log('\n=== 9b. Chapter 12A travels as PDF drawings, not the SVG on screen ===');
  // The page shows SVG; pdflatex cannot read it. What the browser actually
  // fetches and packs is what decides whether the instructor gets drawings, and
  // that is only visible from here -- the exporter can name the right file and
  // the fetch still bring back the wrong one.
  await p.evaluate(() => {
    document.querySelectorAll('#questionTree input[type=checkbox]').forEach(b => { if (b.checked) b.click(); });
  });
  await p.waitForTimeout(300);
  // Select this one paper by its data-paper key rather than by label text:
  // now that the original worksheet's paper is labeled "Original PDF
  // worksheet" -- the same label Chapters 01 & 02 and 03 use for theirs -- a
  // text match on that label alone would hit the wrong chapter's row.
  await makeSession(p, { paperKey: 'ch12a:original_pdf', count: 9999, mode: 'practice', name: 'Ch12A practice' });
  const geoCount = await p.evaluate(() => WorksheetExport.imagesUsedBy(currentQuiz).length);
  ok(geoCount > 40, `the geometry paper carries ${geoCount} drawings`);
  overleafPosts = [];
  await p.waitForTimeout(2500);         // let the drawings prefetch
  await p.click('#overleafExportBtn');
  await p.waitForTimeout(2500);
  eq(overleafPosts.length, 1, 'one POST for the geometry paper');
  const uri3 = new URLSearchParams(overleafPosts[0].body).get('snip_uri') || '';
  ok(/^data:application\/zip;base64,/.test(uri3), 'sent as a zip, because it carries drawings');

  const zip3 = path.join(tmp, 'ch12a.zip');
  fs.writeFileSync(zip3, Buffer.from(uri3.replace(/^data:application\/zip;base64,/, ''), 'base64'));
  const list3 = execFileSync('unzip', ['-Z1', zip3], { encoding: 'utf8' }).trim().split('\n');
  eq(list3.filter(n => /\.svg$/i.test(n)), [], 'not one SVG is in the bundle');
  // Asking for "every file as PDF" would be wrong: Q76 is a photograph, and
  // stays a PNG. The claim worth making is that every file the exporter asked
  // for is one the bundle actually carries.
  const asked = await p.evaluate(() =>
    WorksheetExport.imagesUsedBy(currentQuiz).map(s => s.replace(/^.*\//, '')));
  eq(asked.filter(n => !list3.includes(n)), [],
    `all ${geoCount} pictures the paper asks for are in the bundle`);
  ok(list3.filter(n => /\.pdf$/i.test(n)).length >= geoCount - 1,
    `and all but the one photograph are vector PDFs (${list3.filter(n => /\.pdf$/i.test(n)).length})`);

  const dir3 = path.join(tmp, 'ch12abuild');
  fs.mkdirSync(dir3, { recursive: true });
  execFileSync('unzip', ['-o', zip3, '-d', dir3], { stdio: 'pipe' });
  let built3 = false;
  try {
    for (let pass = 0; pass < 2; pass++)
      execFileSync('pdflatex', ['-interaction=nonstopmode', 'worksheet.tex'], { cwd: dir3, stdio: 'pipe' });
    built3 = fs.existsSync(path.join(dir3, 'worksheet.pdf'));
  } catch { /* the log is the verdict */ }
  const log3 = fs.existsSync(path.join(dir3, 'worksheet.log'))
    ? fs.readFileSync(path.join(dir3, 'worksheet.log'), 'utf8') : '';
  ok(built3, 'the bundle the browser posted compiles');
  eq(log3.match(/^!.*$/gm) || [], [], 'with no errors');
  ok(!/Unknown graphics extension|Unicode character/.test(log3),
    'no unreadable picture and no unknown character');

  console.log('\n=== 9c. Chapter 04 travels as PDF drawings and PNG photos, not the SVG on screen ===');
  // Same concern as 9b, checked fresh for this chapter: 32 SVG scale drawings
  // that must travel as their PDF twins, plus two shared reference photos
  // (labelled caliper, labelled micrometer) that travel as plain PNGs.
  await p.evaluate(() => {
    document.querySelectorAll('#questionTree input[type=checkbox]').forEach(b => { if (b.checked) b.click(); });
  });
  await p.waitForTimeout(300);
  await makeSession(p, { paperKey: 'ch04:original_pdf', count: 9999, mode: 'practice', name: 'Ch04 practice' });
  const ch04Count = await p.evaluate(() => WorksheetExport.imagesUsedBy(currentQuiz).length);
  ok(ch04Count > 0, `the measurement paper carries ${ch04Count} pictures`);
  overleafPosts = [];
  await p.waitForTimeout(1500);         // let the drawings/photos prefetch
  await p.click('#overleafExportBtn');
  await p.waitForTimeout(1500);
  eq(overleafPosts.length, 1, 'one POST for the measurement paper');
  const uri4 = new URLSearchParams(overleafPosts[0].body).get('snip_uri') || '';
  ok(/^data:application\/zip;base64,/.test(uri4), 'sent as a zip, because it carries drawings');

  const zip4 = path.join(tmp, 'ch04.zip');
  fs.writeFileSync(zip4, Buffer.from(uri4.replace(/^data:application\/zip;base64,/, ''), 'base64'));
  const list4 = execFileSync('unzip', ['-Z1', zip4], { encoding: 'utf8' }).trim().split('\n');
  eq(list4.filter(n => /\.svg$/i.test(n)), [], 'not one SVG is in the bundle');
  const asked4 = await p.evaluate(() =>
    WorksheetExport.imagesUsedBy(currentQuiz).map(s => s.replace(/^.*\//, '')));
  eq(asked4.filter(n => !list4.includes(n)), [],
    `all ${ch04Count} pictures the paper asks for are in the bundle`);
  ok(list4.some(n => /\.png$/i.test(n)), 'the two reference photos travel as PNGs');
  ok(list4.filter(n => /\.pdf$/i.test(n)).length > 0, 'and the scale drawings travel as vector PDFs');

  const dir4 = path.join(tmp, 'ch04build');
  fs.mkdirSync(dir4, { recursive: true });
  execFileSync('unzip', ['-o', zip4, '-d', dir4], { stdio: 'pipe' });
  let built4 = false;
  try {
    for (let pass = 0; pass < 2; pass++)
      execFileSync('pdflatex', ['-interaction=nonstopmode', 'worksheet.tex'], { cwd: dir4, stdio: 'pipe' });
    built4 = fs.existsSync(path.join(dir4, 'worksheet.pdf'));
  } catch { /* the log is the verdict */ }
  const log4 = fs.existsSync(path.join(dir4, 'worksheet.log'))
    ? fs.readFileSync(path.join(dir4, 'worksheet.log'), 'utf8') : '';
  ok(built4, 'the bundle the browser posted compiles');
  eq(log4.match(/^!.*$/gm) || [], [], 'with no errors');
  ok(!/Unknown graphics extension|Unicode character/.test(log4),
    'no unreadable picture and no unknown character');

  console.log('\n=== 10. No page errors ===');
  ok(errs.length === 0, errs.length ? errs.join(' | ') : 'none');

  await browser.close();
  server.close();
  await pool.end();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(`\n${checks - failures.length}/${checks} checks passed`);
  if (failures.length) { console.log('FAILURES:\n - ' + failures.join('\n - ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
