#!/usr/bin/env node
/* Refuse to push while a mutation may be in the served sources.
 *
 * The mutation harness (mutate_backend.js) patches REAL source files one mutant at a
 * time -- app.js, worksheet_tex.js, service-worker.js, style.css, and their served
 * twins under energytech-api/public/ -- and puts them back afterwards. Both repos
 * ship those files to production (this one through GitHub Pages, energytech-api
 * through Railway). A push made while a mutant is applied, or of a commit that
 * captured one, puts a deliberately broken guard in front of users. It has happened
 * (mathquiz 23a4a26, "the last commit shipped a mutant"), and on 2026-09-20/21 a
 * killed run left a mutant in the working tree of both repos.
 *
 * Three ways it can be wrong, all refused:
 *
 *   1. tools/.mutation-snapshot/in-flight.json exists. The harness writes it while a
 *      mutant is applied and removes it on restore, so its presence means one may be.
 *   2. A source file in EITHER working tree differs from its snapshot. The snapshots
 *      are taken from the files as they were when the gate last ran, so a difference
 *      is a mutant, or an edit made since the gate ran on those bytes.
 *   3. (--pre-push) a source file in a commit being pushed to main differs from its
 *      snapshot. This is the case the working tree cannot show: a commit made WHILE a
 *      mutant was applied keeps the mutant even after the harness restores the file,
 *      so the tree looks clean at push time and the commit does not.
 *
 * "Differs from the snapshot" therefore also means "changed since the mutation gate
 * last ran on it": pushing an edit to a served file needs a fresh gate first. That is
 * the intended workflow. `git push --no-verify` is the deliberate escape.
 *
 * Only pushes to refs/heads/main are checked (what is deployed); deleting a ref and
 * pushing other branches pass. If the snapshots do not exist (the harness has never
 * run on this machine) there is nothing to compare, so it warns and lets the push
 * through -- except that the marker check needs no snapshots and always applies.
 *
 * Usage (run from the repository being pushed; git does that for a hook):
 *   node tools/check-pristine.js --pre-push --repo mathquiz|api      (reads git's stdin)
 *   node tools/check-pristine.js                                      (working trees only)
 * Options for tests: --mathquiz DIR --api DIR --snapshots DIR
 * Exit 0 = fine, 1 = refused. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const prePush = argv.includes('--pre-push');
const repoBeingPushed = opt('--repo');                       // 'mathquiz' | 'api' | null

const MATHQUIZ = path.resolve(opt('--mathquiz') || path.join(__dirname, '..'));
const API = path.resolve(opt('--api') || path.join(MATHQUIZ, '..', 'energytech-api'));
const SNAP = path.resolve(opt('--snapshots') || path.join(__dirname, '.mutation-snapshot'));
const MARKER = path.join(SNAP, 'in-flight.json');
const SOURCES = ['app.js', 'worksheet_tex.js', 'service-worker.js', 'style.css'];

// Every file that can carry a mutant: where it lives, where it sits inside its repo, its snapshot.
const PAIRS = [
  ...SOURCES.map(f => ({ repo: 'mathquiz', root: MATHQUIZ, rel: f, snap: path.join(SNAP, f) })),
  ...SOURCES.map(f => ({ repo: 'api', root: API, rel: 'public/' + f, snap: path.join(SNAP, 'served-' + f) })),
];
const label = (p) => `${p.repo === 'api' ? 'energytech-api' : 'energytech-mathquiz'}/${p.rel}`;

const problems = [];
const warnings = [];

// 1. The marker.
if (fs.existsSync(MARKER)) {
  let what = 'a mutant';
  try { what = `"${JSON.parse(fs.readFileSync(MARKER, 'utf8')).what}"`; } catch { /* unreadable: still refuse */ }
  problems.push(`a mutation run is in flight (or died holding one): ${what}. ${path.join('tools', '.mutation-snapshot', 'in-flight.json')} exists.\n`
    + '    Start the harness again (it restores from its snapshots before doing anything) or let the run finish.');
}

// 2. The working trees against the snapshots.
const haveSnapshots = fs.existsSync(SNAP) && PAIRS.some(p => fs.existsSync(p.snap));
if (!haveSnapshots) {
  warnings.push(`no mutation snapshots at ${SNAP}: the harness has not run on this machine, so the sources cannot be compared. Not blocking.`);
} else {
  for (const p of PAIRS) {
    const file = path.join(p.root, p.rel);
    if (!fs.existsSync(p.snap) || !fs.existsSync(file)) continue;     // a repo or file this machine does not have
    if (!fs.readFileSync(file).equals(fs.readFileSync(p.snap))) {
      problems.push(`${label(p)} differs from its snapshot: a mutant is applied, or the file changed after the mutation gate last ran on it.`);
    }
  }
}

// 3. What is about to be pushed.
function git(root, args, input) {
  return spawnSync('git', ['-C', root, ...args], { input, encoding: input ? 'buffer' : 'utf8' });
}
if (prePush && haveSnapshots) {
  const root = repoBeingPushed === 'api' ? API : MATHQUIZ;
  const mine = PAIRS.filter(p => p.repo === (repoBeingPushed === 'api' ? 'api' : 'mathquiz'));
  let stdin = '';
  try { stdin = fs.readFileSync(0, 'utf8'); } catch { /* no stdin: nothing to check */ }
  for (const line of stdin.split(/\r?\n/).filter(Boolean)) {
    const [, localSha, remoteRef] = line.split(' ');
    if (remoteRef !== 'refs/heads/main' || /^0+$/.test(localSha)) continue;
    for (const p of mine) {
      if (!fs.existsSync(p.snap)) continue;
      const committed = git(root, ['rev-parse', '--verify', '-q', `${localSha}:${p.rel}`]);
      if (committed.status !== 0) continue;                            // not in that commit
      // The snapshot's blob id as git would store it at this path: --path applies the same
      // line-ending conversion as `git add`, so a CRLF working copy compares with an LF blob.
      const snapBlob = git(root, ['hash-object', `--path=${p.rel}`, '--stdin'], fs.readFileSync(p.snap));
      if (snapBlob.status !== 0) { warnings.push(`could not hash the snapshot of ${label(p)}; not compared.`); continue; }
      if (String(committed.stdout).trim() !== String(snapBlob.stdout).trim()) {
        problems.push(`${label(p)} in commit ${localSha.slice(0, 8)} is not the file the mutation gate last ran on.\n`
          + '    Either a mutant was committed (the tree looks clean because the harness restored it), or the file\n'
          + '    changed after the gate ran. Rerun tools\\run-mutation.cmd, or fix the commit.');
      }
    }
  }
}

for (const w of warnings) console.error(`check-pristine: warning: ${w}`);
if (problems.length) {
  console.error('\nPUSH REFUSED -- the served sources are not known to be free of a mutation:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nIf you are certain, `git push --no-verify` skips this check.\n');
  process.exit(1);
}
console.error(`check-pristine: ok (${haveSnapshots ? 'no marker; sources match their snapshots' : 'no marker'}${prePush ? '; pushed commits match' : ''})`);
