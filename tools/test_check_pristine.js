/* The push guard (check-pristine.js) must refuse when a mutation may be in the served
 * sources, and above all in the case the working tree cannot show: a commit made
 * while a mutant was applied, after the harness has put the file back.
 *
 * Everything runs in a throwaway pair of repositories laid out like the real ones
 * (energytech-mathquiz beside energytech-api, snapshots in tools/.mutation-snapshot),
 * with core.autocrlf=true and CRLF files as on this machine, and the real hook is
 * exercised through a real `git push` to a bare remote. Nothing here touches a real
 * repository. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'check_pristine_'));
const MQ = path.join(T, 'energytech-mathquiz');
const API = path.join(T, 'energytech-api');
const BARE_MQ = path.join(T, 'mq-remote.git');
const BARE_API = path.join(T, 'api-remote.git');
const SNAP = path.join(MQ, 'tools', '.mutation-snapshot');
const SOURCES = ['app.js', 'worksheet_tex.js', 'service-worker.js', 'style.css'];
const REAL_TOOLS = __dirname;
const REAL_API_HOOK = path.join(__dirname, '..', '..', 'energytech-api', '.githooks', 'pre-push');

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};
const src = (name, tag) => `// ${name} ${tag}\r\nconst x = 1;\r\n`;          // CRLF, as on this machine
const put = (p, text) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const head = (dir) => git(dir, 'rev-parse', 'HEAD').out;
const initRepo = (dir, remote) => {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'test'); git(dir, 'config', 'user.email', 't@example.invalid');
  git(dir, 'config', 'core.autocrlf', 'true');
  spawnSync('git', ['init', '-q', '--bare', remote]);
  git(dir, 'remote', 'add', 'origin', remote);
};
const commit = (dir, msg, ...paths) => { git(dir, 'add', ...paths); git(dir, 'commit', '-q', '-m', msg); return head(dir); };

// --- the two repositories, and the snapshots the harness would have taken ---
initRepo(MQ, BARE_MQ);
put(path.join(MQ, '.gitignore'), 'tools/.mutation-snapshot/\n');
SOURCES.forEach(f => put(path.join(MQ, f), src(f, 'v1')));
put(path.join(MQ, 'README.md'), 'readme\r\n');
put(path.join(MQ, 'tools', 'check-pristine.js'), fs.readFileSync(path.join(REAL_TOOLS, 'check-pristine.js'), 'utf8'));
// The hook must have LF endings whatever the checkout did (.gitattributes pins it in the real repo).
put(path.join(MQ, 'tools', 'githooks', 'pre-push'), fs.readFileSync(path.join(REAL_TOOLS, 'githooks', 'pre-push'), 'utf8').replace(/\r\n/g, '\n'));
git(MQ, 'config', 'core.hooksPath', 'tools/githooks');
const baseMQ = commit(MQ, 'base', '.gitignore', ...SOURCES, 'README.md', 'tools');

initRepo(API, BARE_API);
SOURCES.forEach(f => put(path.join(API, 'public', f), src(f, 'v1')));
const baseAPI = commit(API, 'base', 'public');

const snapshotAll = () => {
  fs.mkdirSync(SNAP, { recursive: true });
  SOURCES.forEach(f => {
    fs.copyFileSync(path.join(MQ, f), path.join(SNAP, f));
    fs.copyFileSync(path.join(API, 'public', f), path.join(SNAP, 'served-' + f));
  });
};
const MARKER = path.join(SNAP, 'in-flight.json');
const reset = () => {
  git(MQ, 'reset', '-q', '--hard', baseMQ); git(API, 'reset', '-q', '--hard', baseAPI);
  fs.rmSync(SNAP, { recursive: true, force: true });
  snapshotAll();
};
snapshotAll();

const CHECK = path.join(MQ, 'tools', 'check-pristine.js');
const run = (args, stdin = '') => {
  const r = spawnSync(process.execPath, [CHECK, ...args], { input: stdin, encoding: 'utf8' });
  return { code: r.status, out: (r.stderr || '') + (r.stdout || '') };
};
const push = (sha, ref = 'refs/heads/main') => `${ref} ${sha} ${ref} ${'0'.repeat(40)}\n`;
const PRE = ['--pre-push', '--repo', 'mathquiz'];
const PRE_API = ['--pre-push', '--repo', 'api'];

// ---- 1. a clean state passes ----
let r = run(PRE, push(head(MQ)));
ok(r.code === 0, 'clean trees, snapshots match, no marker: the push is allowed');
ok(run([]).code === 0, 'and so is the working-tree check on its own');

// ---- 2. the marker ----
put(MARKER, JSON.stringify({ what: 'the exam page keeps the rest of the app on screen', file: 'app.js' }));
r = run(PRE, push(head(MQ)));
ok(r.code === 1 && /in flight/.test(r.out) && /the exam page keeps the rest of the app on screen/.test(r.out),
  'a marker refuses the push, and names the mutant that is in flight');
put(MARKER, 'not json {');
ok(run(PRE, push(head(MQ))).code === 1, 'an unreadable marker still refuses: presence is what matters');
fs.rmSync(MARKER);

// ---- 3. a mutant in a working tree, in either repository ----
put(path.join(MQ, 'app.js'), src('app.js', 'MUTANT'));
r = run(PRE, push(head(MQ)));
ok(r.code === 1 && /energytech-mathquiz\/app\.js differs from its snapshot/.test(r.out), 'a mutated mathquiz source refuses the push, by name');
fs.copyFileSync(path.join(SNAP, 'app.js'), path.join(MQ, 'app.js'));
put(path.join(API, 'public', 'worksheet_tex.js'), src('worksheet_tex.js', 'MUTANT'));
r = run(PRE, push(head(MQ)));
ok(r.code === 1 && /energytech-api\/public\/worksheet_tex\.js differs/.test(r.out), 'a mutant in the OTHER repository refuses a push from this one');
fs.copyFileSync(path.join(SNAP, 'served-worksheet_tex.js'), path.join(API, 'public', 'worksheet_tex.js'));
ok(run(PRE, push(head(MQ))).code === 0, 'restored, the push is allowed again');

// ---- 4. THE CASE: a mutant committed, the file put back, the tree looks clean ----
put(path.join(MQ, 'app.js'), src('app.js', 'MUTANT'));
const mutantCommit = commit(MQ, 'the commit made while the mutant was applied', 'app.js');
fs.copyFileSync(path.join(SNAP, 'app.js'), path.join(MQ, 'app.js'));       // the harness restores the file
ok(run([]).code === 0, 'the working tree now looks clean, so a working-tree check alone would let this through');
r = run(PRE, push(mutantCommit));
ok(r.code === 1 && /energytech-mathquiz\/app\.js in commit /.test(r.out) && /mutant was committed/.test(r.out),
  'but the commit being pushed is refused, and the message says a mutant was committed');
reset();

// ---- 5. a legitimate change: allowed only if the gate has run on those exact bytes ----
put(path.join(MQ, 'app.js'), src('app.js', 'v2'));
let edit = commit(MQ, 'an intended edit', 'app.js');
r = run(PRE, push(edit));
ok(r.code === 1, 'an edit to a served file, before the gate has run on it, is refused');
snapshotAll();                                                            // the gate ran on v2
ok(run(PRE, push(edit)).code === 0, 'the same commit is allowed once the snapshots are of those bytes');
reset();

// ---- 6. only what is deployed, and only pushes that add something ----
put(path.join(MQ, 'app.js'), src('app.js', 'MUTANT'));
const branchMutant = commit(MQ, 'mutant on a side branch', 'app.js');
fs.copyFileSync(path.join(SNAP, 'app.js'), path.join(MQ, 'app.js'));
ok(run(PRE, push(branchMutant, 'refs/heads/side')).code === 0, 'a push to a branch that is not main is not checked');
ok(run(PRE, `(delete) ${'0'.repeat(40)} refs/heads/main ${baseMQ}\n`).code === 0, 'deleting a ref is not checked');
reset();

// ---- 7. the other repository ----
put(path.join(API, 'public', 'app.js'), src('app.js', 'MUTANT'));
const apiMutant = commit(API, 'api mutant', 'public/app.js');
fs.copyFileSync(path.join(SNAP, 'served-app.js'), path.join(API, 'public', 'app.js'));
r = run(PRE_API, push(apiMutant));
ok(r.code === 1 && /energytech-api\/public\/app\.js in commit /.test(r.out), 'a mutant committed to energytech-api/public is refused when pushing that repository');
ok(run(PRE, push(head(MQ))).code === 0, 'and does not block a push from mathquiz, whose own commits are clean');
reset();

// ---- 8. no snapshots at all ----
fs.rmSync(SNAP, { recursive: true, force: true });
r = run(PRE, push(head(MQ)));
ok(r.code === 0 && /no mutation snapshots/.test(r.out), 'with no snapshots there is nothing to compare: it warns and allows');
fs.mkdirSync(SNAP, { recursive: true }); put(MARKER, '{"what":"x"}');
ok(run(PRE, push(head(MQ))).code === 1, 'but a marker needs no snapshots, and still refuses');
reset();

// ---- 9. the real hook, through a real git push ----
const remoteHead = (bare) => git(bare, 'rev-parse', 'main').out;
let g = spawnSync('git', ['-C', MQ, 'push', '-q', '-u', 'origin', 'main'], { encoding: 'utf8' });
ok(g.status === 0 && remoteHead(BARE_MQ) === baseMQ, 'git push of a clean state goes through the hook and succeeds');
put(path.join(MQ, 'README.md'), 'readme changed\r\n');
const readmeCommit = commit(MQ, 'docs only', 'README.md');
put(MARKER, JSON.stringify({ what: 'a header box is left bare in the line' }));
g = spawnSync('git', ['-C', MQ, 'push', 'origin', 'main'], { encoding: 'utf8' });
ok(g.status !== 0 && /PUSH REFUSED/.test(g.stderr) && remoteHead(BARE_MQ) === baseMQ, 'git push with a marker present is refused by the hook, and the remote does not move');
g = spawnSync('git', ['-C', MQ, 'push', '--no-verify', '-q', 'origin', 'main'], { encoding: 'utf8' });
ok(g.status === 0 && remoteHead(BARE_MQ) === readmeCommit, '--no-verify is the deliberate escape, and it works');
fs.rmSync(MARKER);
put(path.join(MQ, 'app.js'), src('app.js', 'MUTANT'));
commit(MQ, 'made while a mutant was applied', 'app.js');
fs.copyFileSync(path.join(SNAP, 'app.js'), path.join(MQ, 'app.js'));       // restored; the tree looks clean
g = spawnSync('git', ['-C', MQ, 'push', 'origin', 'main'], { encoding: 'utf8' });
ok(g.status !== 0 && /mutant was committed/.test(g.stderr) && remoteHead(BARE_MQ) === readmeCommit,
  'a real git push of a commit that captured a mutant is refused, and never reaches the remote');
reset();

// ---- 10. the api repository's hook, if it has been added ----
if (fs.existsSync(REAL_API_HOOK)) {
  put(path.join(API, '.githooks', 'pre-push'), fs.readFileSync(REAL_API_HOOK, 'utf8').replace(/\r\n/g, '\n'));
  git(API, 'config', 'core.hooksPath', '.githooks');
  g = spawnSync('git', ['-C', API, 'push', '-q', '-u', 'origin', 'main'], { encoding: 'utf8' });
  ok(g.status === 0 && remoteHead(BARE_API) === baseAPI, "energytech-api's hook lets a clean push through");
  put(path.join(API, 'public', 'style.css'), src('style.css', 'MUTANT'));
  commit(API, 'api mutant', 'public/style.css');
  fs.copyFileSync(path.join(SNAP, 'served-style.css'), path.join(API, 'public', 'style.css'));
  g = spawnSync('git', ['-C', API, 'push', 'origin', 'main'], { encoding: 'utf8' });
  ok(g.status !== 0 && /PUSH REFUSED/.test(g.stderr) && remoteHead(BARE_API) === baseAPI, "and refuses a captured mutant in energytech-api's public/, which never reaches the remote");
} else {
  console.log("(skipped: energytech-api's .githooks/pre-push is not there)");
}

fs.rmSync(T, { recursive: true, force: true });
console.log(`${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
