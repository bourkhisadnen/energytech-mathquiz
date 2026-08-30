/* Mutation test for the trainee's own-record route.
 *
 * The suite passing proves nothing on its own -- a guard that always returns
 * true passes every test that only ever exercises the allowed case. So each
 * guard is deliberately broken, one at a time, and the suite must fail. A
 * mutation that survives is a guard nothing is actually testing. */
const { execFileSync } = require('child_process');
const fs = require('fs');

const CODE = '/tmp/energytech_app/energytech_quiz_app_session_sync_fixed/google_apps_script/Code.gs';
const original = fs.readFileSync(CODE, 'utf8');

const MUTANTS = [
  {
    what: 'my_attempt stops checking the attempt belongs to the caller',
    from: "  return attemptFor_(attemptId, row => normId_(row[4]) === me);",
    to:   "  return attemptFor_(attemptId, function () { return true; });",
    suite: 'test_my_history.js'
  },
  {
    what: 'my_history filters by instructor, as the roster route does',
    from: "  return historyFor_(normId_(auth.trainee.energytechId), function () { return true; });",
    to:   "  return historyFor_(normId_(auth.trainee.energytechId), function (owner) { return String(owner) === 'sara'; });",
    suite: 'test_my_history.js'
  },
  {
    what: 'my_history trusts an energytechId parameter instead of the token',
    from: "  return historyFor_(normId_(auth.trainee.energytechId), function () { return true; });",
    to:   "  return historyFor_(normId_(params.energytechId || auth.trainee.energytechId), function () { return true; });",
    suite: 'test_my_history.js'
  },
  {
    what: 'a revoked trainee keeps their access',
    from: "    if (String(rows[i][5] || '') !== 'active') {",
    to:   "    if (false) {",
    suite: 'test_my_history.js'
  },
  {
    what: 'the instructor attempt route stops checking who owns the session',
    from: "  return attemptFor_(attemptId, row => isAdmin || normalizeUsername_(row[19]) === viewer);",
    to:   "  return attemptFor_(attemptId, function () { return true; });",
    suite: 'test_history.js'
  },
  {
    what: 'the instructor history route stops filtering by session owner',
    from: "  return historyFor_(id, owner => isAdmin || normalizeUsername_(owner) === viewer);",
    to:   "  return historyFor_(id, function () { return true; });",
    suite: 'test_history.js'
  },
  {
    what: 'my_history accepts an instructor token',
    from: "function myHistory_(params) {\n  const auth = requireTrainee_(params);",
    to:   "function myHistory_(params) {\n  const auth = requireAuth_(params).ok ? { ok: true, trainee: { energytechId: 'ET1001' } } : requireTrainee_(params);",
    suite: 'test_my_history.js'
  }
];

let caught = 0, survived = [];
console.log('baseline:');
for (const suite of ['test_my_history.js', 'test_history.js']) {
  try {
    execFileSync('node', ['/tmp/energytech_app/' + suite], { stdio: 'pipe' });
    console.log(`  clean   ${suite}`);
  } catch {
    console.log(`  BASELINE FAILS -- ${suite}. Nothing below means anything.`);
    process.exit(1);
  }
}
console.log('');

for (const m of MUTANTS) {
  if (!original.includes(m.from)) {
    console.log(`  SKIPPED  ${m.what}  (the code it patches has moved)`);
    survived.push(m.what + ' [pattern not found]');
    continue;
  }
  fs.writeFileSync(CODE, original.replace(m.from, m.to));
  let failed = false;
  try { execFileSync('node', ['/tmp/energytech_app/' + m.suite], { stdio: 'pipe' }); }
  catch { failed = true; }
  fs.writeFileSync(CODE, original);
  if (failed) { caught++; console.log(`  caught   ${m.what}  (${m.suite})`); }
  else { survived.push(m.what); console.log(`  SURVIVED ${m.what}  (${m.suite})`); }
}

console.log(`\n${caught} of ${MUTANTS.length} broken guards were caught by the tests.`);
if (survived.length) {
  console.log('\nNOT ACTUALLY TESTED:');
  survived.forEach(s => console.log('  ' + s));
  process.exit(1);
}
