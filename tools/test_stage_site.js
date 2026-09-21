/* stage-site.js decides what GitHub Pages publishes, so it must (a) never publish a
 * developer file, (b) never quietly lose a site file, and (c) refuse, rather than
 * guess, when something is not classified. Run against throwaway repositories, plus the
 * real one (read-only: it stages into a temp directory). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };

const STAGE = path.join(__dirname, 'stage-site.js');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'stage_site_'));
let n = 0;

const SW = "const FILES = [\n  './',\n  './index.html',\n  './app.js',\n  './images/a.png',\n];\n";
function repo(files, manifest) {
  const dir = path.join(T, 'repo' + (++n));
  fs.mkdirSync(dir);
  const all = { ...files, 'tools/site-files.json': JSON.stringify(manifest) };
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  spawnSync('git', ['-C', dir, 'init', '-q']);
  spawnSync('git', ['-C', dir, 'add', '-A']);
  return dir;
}
const stage = (root, out) => {
  const r = spawnSync(process.execPath, [STAGE, out, '--root', root], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const listing = (dir) => {
  const found = [];
  (function walk(d, rel) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; e.isDirectory() ? walk(path.join(d, e.name), r) : found.push(r); } })(dir, '');
  return found.sort();
};

const SITE_FILES = { 'index.html': '<title>x</title>', 'app.js': '1', 'service-worker.js': SW, 'images/a.png': 'png' };
const DEV_FILES = { 'README.md': 'r', 'package.json': '{}', 'google_apps_script/Code.gs': 'backend', 'tools/run.js': 'dev' };
const MANIFEST = { site: ['index.html', 'app.js', 'service-worker.js', 'images'], developer: ['README.md', 'package.json', 'google_apps_script', 'tools'] };

// ---- the happy path: only the site, none of the developer files ----
let root = repo({ ...SITE_FILES, ...DEV_FILES }, MANIFEST);
let out = path.join(T, 'out1');
let r = stage(root, out);
ok(r.code === 0, 'a fully classified repository stages');
ok(JSON.stringify(listing(out)) === JSON.stringify(['app.js', 'images/a.png', 'index.html', 'service-worker.js']), 'and only the site files are in the output');
ok(!fs.existsSync(path.join(out, 'tools')) && !fs.existsSync(path.join(out, 'google_apps_script')) && !fs.existsSync(path.join(out, 'README.md')) && !fs.existsSync(path.join(out, 'package.json')),
  'none of tools/, google_apps_script/, README.md or package.json is published');
ok(/not published/.test(r.out) && /tools/.test(r.out), 'and it says what it left out');

// ---- fail closed on anything unclassified, in either direction ----
root = repo({ ...SITE_FILES, ...DEV_FILES, 'question_bank_ch05.js': 'new chapter' }, MANIFEST);
out = path.join(T, 'out2'); r = stage(root, out);
ok(r.code === 1 && /question_bank_ch05\.js/.test(r.out) && /not classified/.test(r.out), 'a new site file nobody added to the manifest fails the build, by name (it would otherwise go missing from the site)');
ok(!fs.existsSync(out), 'and leaves nothing behind to deploy');
root = repo({ ...SITE_FILES, ...DEV_FILES, 'notes.txt': 'private' }, MANIFEST);
out = path.join(T, 'out3'); r = stage(root, out);
ok(r.code === 1 && /notes\.txt/.test(r.out), 'a new developer file nobody classified is not published by default either');

// ---- the manifest has to agree with the repository ----
root = repo({ ...SITE_FILES, ...DEV_FILES }, { ...MANIFEST, site: [...MANIFEST.site, 'style.css'] });
r = stage(root, path.join(T, 'out4'));
ok(r.code === 1 && /"style\.css"/.test(r.out) && /not in the repository/.test(r.out), 'a site file listed but absent from the repository fails');
root = repo({ ...SITE_FILES, ...DEV_FILES }, { ...MANIFEST, developer: [...MANIFEST.developer, 'app.js'] });
r = stage(root, path.join(T, 'out5'));
ok(r.code === 1 && /both lists/.test(r.out), 'an entry in both lists fails');
root = repo({ ...SITE_FILES, ...DEV_FILES }, { ...MANIFEST, developer: [...MANIFEST.developer, 'gone.md'] });
out = path.join(T, 'out6'); r = stage(root, out);
ok(r.code === 0 && /gone\.md/.test(r.out), 'a developer entry that has gone away is only a note, not a failed deploy');

// ---- the staged site has to work ----
root = repo({ ...SITE_FILES, 'service-worker.js': SW.replace("'./images/a.png'", "'./images/a.png', './missing.png'"), ...DEV_FILES }, MANIFEST);
r = stage(root, path.join(T, 'out7'));
ok(r.code === 1 && /missing\.png/.test(r.out) && /precaches/.test(r.out), 'a file the service worker precaches but the site lacks fails the build, by name');
const noIndex = { ...SITE_FILES }; delete noIndex['index.html'];
root = repo({ ...noIndex, ...DEV_FILES }, { ...MANIFEST, site: ['app.js', 'service-worker.js', 'images'] });
r = stage(root, path.join(T, 'out8'));
ok(r.code === 1 && /index\.html/.test(r.out), 'a site without index.html fails');
// Isolate the explicit check: here the service worker never mentions index.html, so only that
// check can notice it is missing.
root = repo({ 'app.js': '1', 'service-worker.js': "const FILES = [\n  './app.js',\n];\n", ...DEV_FILES },
  { site: ['app.js', 'service-worker.js'], developer: MANIFEST.developer });
r = stage(root, path.join(T, 'out8b'));
ok(r.code === 1 && /index\.html was not staged/.test(r.out), 'index.html is required in its own right, not only when the service worker happens to list it');
fs.mkdirSync(path.join(T, 'out9'));
r = stage(repo({ ...SITE_FILES, ...DEV_FILES }, MANIFEST), path.join(T, 'out9'));
ok(r.code === 1 && /already exists/.test(r.out), 'staging into a directory that already exists is refused, so old files cannot linger in a deploy');

// ---- the real repository ----
const real = path.join(__dirname, '..');
out = path.join(T, 'out-real');
r = stage(real, out);
ok(r.code === 0, `the real repository stages (${r.code === 0 ? '' : r.out.split('\n').slice(0, 3).join(' | ')})`);
if (r.code === 0) {
  const tracked = spawnSync('git', ['-C', real, 'ls-files'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'site-files.json'), 'utf8'));
  const expected = tracked.filter(p => manifest.site.includes(p.split('/')[0])).sort();
  ok(JSON.stringify(listing(out)) === JSON.stringify(expected), `it stages exactly git's tracked files under "site" (${expected.length})`);
  const leaked = listing(out).filter(p => manifest.developer.includes(p.split('/')[0]));
  ok(leaked.length === 0, 'and not one file under a "developer" entry');
  ok(!listing(out).some(p => /^tools\/|^google_apps_script\/|^README\.md$|^package(-lock)?\.json$|^\.github\//.test(p)), 'in particular nothing from tools/, google_apps_script/, README.md, package*.json or .github/');
}

fs.rmSync(T, { recursive: true, force: true });
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
