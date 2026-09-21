/* The runner under mutate_backend.js must tell a pass, a failure and a hang
 * apart, and must give up on a hang. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runSuite, runSuiteRetrying, waitForTcp, mutantTimeoutMs, fmt, firstFailure, tallyOf, infrastructureError,
  suiteNeeds, findOnPath, checkEnvironment, formatPreflight } = require('./run_suite');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run_suite_'));
const write = (n, src) => { const p = path.join(dir, n); fs.writeFileSync(p, src); return p; };

const good = runSuite(write('good.js', 'console.log("3/3 checks passed")'));
ok(good.status === 'pass', 'exit 0 is a pass');

const bad = runSuite(write('bad.js', 'console.error("boom"); process.exit(1)'));
ok(bad.status === 'fail', 'exit 1 is a failure');
ok(/boom/.test(bad.tail), 'the failure output is kept');

const missing = runSuite(path.join(dir, 'nope.js'));
ok(missing.status === 'fail', 'a suite that does not exist is a failure, not a pass');

// A child that never exits, and holds its stdio open like a wedged browser would.
const t0 = Date.now();
const hung = runSuite(write('hang.js', 'setInterval(() => {}, 1000)'), { timeoutMs: 1500 });
ok(hung.status === 'timeout', 'a child that never exits is reported as a timeout');
ok(Date.now() - t0 < 10000, 'and the runner gives up instead of waiting for it');
ok(hung.status !== 'fail', 'a timeout is not confused with an assertion failure');

ok(mutantTimeoutMs(1000) === 120000, 'a fast suite still gets a 2 minute floor');
ok(mutantTimeoutMs(60000) === 240000, 'a slow suite gets four times its clean run');
ok(mutantTimeoutMs(10 * 60 * 1000) === 600000, 'and never more than the cap');
ok(fmt(59000) === '59.0s' && fmt(61000) === '1m01s', 'durations print readably');

// Which check failed: the first FAIL line, in run order; or, when a suite throws
// without any check failing, the first error line -- and the two are told apart.
const multi = runSuite(write('multi.js', [
  'console.log("  PASS  a")', 'console.log("  FAIL  the first thing that broke")',
  'console.log("  FAIL  a later one")', 'console.log("FAILURES:\\n - the first thing that broke")',
  'console.log("1/3 checks passed")', 'process.exit(1)'].join(';\n')));
ok(multi.firstFailure && multi.firstFailure.kind === 'check' && multi.firstFailure.text === 'the first thing that broke',
  'the first failing check is the one reported, not a later one or the summary');
ok(multi.tally && multi.tally.passed === 1 && multi.tally.total === 3, 'and the pass tally is read (1 of 3)');
const crashed = runSuite(write('crash.js', 'console.log("  PASS  a"); throw new TypeError("Cannot read properties of null")'));
ok(crashed.firstFailure && crashed.firstFailure.kind === 'crash' && /TypeError/.test(crashed.firstFailure.text),
  'a suite that throws with no failing check is reported as a crash, with the error line');
ok(!(good.firstFailure), 'a passing suite has no first failure');
ok(firstFailure('  FAIL  x\n  FAIL  y').text === 'x', 'first of several');
ok(firstFailure('FAILURES:\n - x') === null, 'the FAILURES summary is not itself a failing check');
ok(firstFailure('') === null && tallyOf('') === null, 'empty output yields nothing');

// A suite that dies because the network is down proves nothing about the code.
ok(/ENOTFOUND/.test(infrastructureError('Error: getaddrinfo ENOTFOUND db.example.invalid')), 'a DNS failure is recognised as infrastructure');
ok(infrastructureError('connect ECONNREFUSED 127.0.0.1:5432'), 'and a refused connection');
ok(infrastructureError('Error: Connection terminated unexpectedly'), 'and a dropped database connection');
ok(infrastructureError('  FAIL  the roster is drawn as editable for everyone') === null, 'an ordinary failed check is not');
ok(infrastructureError('page.waitForSelector: Timeout 30000ms exceeded.') === null, 'nor is a page timeout, which is the app not showing something');
const dead = runSuite(write('dead.js', 'throw new Error("getaddrinfo ENOTFOUND db.example.invalid")'));
ok(dead.status === 'fail' && dead.infra && /ENOTFOUND/.test(dead.infra), 'a suite that dies on the network is flagged, not just failed');
ok(!runSuite(write('assert.js', 'console.log("  FAIL  x"); process.exit(1)')).infra, 'an assertion failure is not flagged');
// Retried, and it must be the retry that decides: fail once on the network, then pass.
const flag = path.join(dir, 'flag');
const flaky = runSuiteRetrying(write('flaky.js',
  `const fs=require('fs'); if(!fs.existsSync(${JSON.stringify(flag)})){fs.writeFileSync(${JSON.stringify(flag)},'1');throw new Error('getaddrinfo ENOTFOUND x.invalid')} console.log('1/1 checks passed')`),
  {}, { attempts: 3, pauseMs: 50 });
ok(flaky.status === 'pass' && flaky.attempts === 2, 'a network blip is retried and the second run decides');
const stuck = runSuiteRetrying(write('stuck.js', 'throw new Error("getaddrinfo ENOTFOUND x.invalid")'), {}, { attempts: 2, pauseMs: 50 });
ok(stuck.status === 'fail' && stuck.infra && stuck.attempts === 2, 'and one that never recovers is still flagged after the last attempt, never a pass');
const real = runSuiteRetrying(write('real.js', 'console.log("  FAIL  x"); process.exit(1)'), {}, { attempts: 3, pauseMs: 50 });
ok(real.attempts === 1, 'a real failure is not retried');

// PRE-FLIGHT. A process that cannot run the suites must be told so before the baseline, in one
// sentence, not discovered as eleven BASELINE FAILS. Two real causes met in one afternoon: no
// browser this process can see, and a program the suites spawn missing from its PATH.
const winExe = n => (process.platform === 'win32' ? n + '.exe' : n);
const binDir = path.join(dir, 'bin');
fs.mkdirSync(binDir);
fs.writeFileSync(path.join(binDir, winExe('sometool')), '');
const envWith = extra => ({ ...process.env, ...extra });

// What a suite needs is read off its own source, not from a list.
const needy = write('needy.js', [
  "const { chromium } = require('playwright');",
  "execFileSync('sometool', ['-t']); spawnSync('othertool'); execFileSync(process.execPath, ['x']);"].join('\n'));
const needs = suiteNeeds(needy);
ok(needs.browser, 'a suite that requires playwright is a browser suite');
ok(needs.programs.length === 2 && needs.programs.includes('sometool') && needs.programs.includes('othertool'),
  'the programs it spawns by name are read off it, and only those: a computed one (process.execPath) is not a name to look for');
ok(!suiteNeeds(path.join(dir, 'good.js')).browser, 'a suite that never requires playwright is not a browser suite');
ok(suiteNeeds(path.join(dir, 'does-not-exist.js')).browser === false, 'a file that cannot be read needs nothing rather than throwing');

ok(findOnPath('sometool', { PATH: binDir }), 'a program in a PATH directory is found');
ok(findOnPath('sometool', { PATH: '' }) === null, 'and with that directory off PATH it is not');
ok(findOnPath('sometool', { Path: binDir }), 'the Windows spelling of the variable (Path) is read too');

// Missing program: the failure the unzip suites had, caught before anything runs.
const pre1 = checkEnvironment([write('unziponly.js', "execFileSync('sometool')")], { env: { PATH: '' } });
ok(!pre1.ok && pre1.problems.some(p => p.kind === 'program-missing' && p.name === 'sometool'), 'a program the suites spawn but PATH lacks fails the pre-flight, by name');
ok(pre1.problems.find(p => p.name === 'sometool').usedBy.includes('unziponly.js'), 'and says which suite needs it');
ok(/sometool is not on PATH/.test(formatPreflight(pre1)) && /Nothing was mutated/.test(formatPreflight(pre1)), 'the message names the program and says nothing was touched');
const pre2 = checkEnvironment([path.join(dir, 'unziponly.js')], { env: { PATH: binDir + path.delimiter + path.dirname(process.execPath) } });
ok(pre2.ok && pre2.browserSuites.length === 0, 'with the program on PATH (and no browser suite) it passes without launching a browser');

// Browser: classified from what the launch says. The probe script stands in for playwright here
// so each outcome can be produced on demand; the real launch is exercised further down.
const browserSuite = write('browsy.js', "const { chromium } = require('playwright');");
const asProbe = src => checkEnvironment([browserSuite], { env: process.env, probe: src, launchTimeoutMs: 1500 });
const good1 = asProbe('process.exit(0)');
ok(good1.ok && good1.browserSuites.length === 1, 'a browser that launches passes');
const miss = asProbe(`console.error("browserType.launch: Executable doesn't exist at C:\\\\x\\\\chrome.exe\\n  hint"); process.exit(1)`);
ok(!miss.ok && miss.problems[0].kind === 'browser-missing' && miss.problems[0].message === 'Playwright browsers not installed',
  'a launch that says "Executable doesn\'t exist" is reported as "Playwright browsers not installed"');
ok(/npx playwright install chromium/.test(formatPreflight(miss)) && /PLAYWRIGHT_BROWSERS_PATH/.test(formatPreflight(miss)),
  'with the install command and the variable to check if they are installed but unseen');
const other = asProbe('console.error("Target closed"); process.exit(1)');
ok(!other.ok && other.problems[0].kind === 'browser-launch' && other.problems[0].message !== 'Playwright browsers not installed',
  'a different launch failure is not mislabelled as "not installed"');
ok(/Target closed/.test(other.problems[0].detail), 'and its own message is kept');
const nopkg = asProbe('console.error("Cannot find module playwright"); process.exit(1)');
ok(nopkg.problems[0].kind === 'playwright-missing', 'a missing package is told apart from a missing browser');
const tA = Date.now();
const wedged = asProbe('setInterval(() => {}, 1000)');
ok(!wedged.ok && wedged.problems[0].kind === 'browser-timeout' && Date.now() - tA < 10000, 'a launch that hangs is a timeout, and does not hang the pre-flight');

// The real thing: the actual playwright, resolved from the suites' own directory, pointed at a
// browsers folder with nothing in it. This is exactly what a fresh machine, or a process that
// cannot see the browsers, looks like.
const realSuite = path.join(__dirname, 'test_appshell.js');
const emptyBrowsers = path.join(dir, 'no-browsers');
fs.mkdirSync(emptyBrowsers);
const tB = Date.now();
const realMiss = checkEnvironment([realSuite], { env: envWith({ PLAYWRIGHT_BROWSERS_PATH: emptyBrowsers }) });
ok(!realMiss.ok && realMiss.problems.some(p => p.message === 'Playwright browsers not installed'),
  'a real playwright pointed at an empty browsers folder is "Playwright browsers not installed"');
ok(Date.now() - tB < 30000, 'and it says so in seconds, not after a baseline');

// Not a listed set of suites: every suite in tools/ that requires playwright is seen as one.
const browserSuitesOnDisk = fs.readdirSync(__dirname).filter(f => /^test_.*\.js$/.test(f))
  .filter(f => /require\(\s*['"]playwright['"]\s*\)/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
ok(browserSuitesOnDisk.length >= 10 && browserSuitesOnDisk.every(f => suiteNeeds(path.join(__dirname, f)).browser),
  `all ${browserSuitesOnDisk.length} playwright suites in tools/ are recognised as browser suites`);
ok(suiteNeeds(path.join(__dirname, 'test_worksheet.js')).programs.includes('unzip'), 'and test_worksheet.js is seen to need unzip');

// Waiting for the network to come back: a port that is listening is 'up'; one that is not is
// waited for and then given up on; and the retry uses the wait, not a fixed pause.
// (The listener lives in this process; waitForTcp blocks it, but a TCP connect completes in the
// kernel without the process calling accept(), so the port still answers.)
const listener = require('net').createServer();
listener.listen(0, '127.0.0.1', () => {
  const port = listener.address().port;
  const upResult = waitForTcp('127.0.0.1', port, { maxMs: 8000, everyMs: 100 });
  ok(upResult.up, 'a listening port is reported up');
  listener.close(() => {
    const t1 = Date.now();
    const downResult = waitForTcp('127.0.0.1', port, { maxMs: 1200, everyMs: 100 });
    ok(!downResult.up && Date.now() - t1 >= 1100 && Date.now() - t1 < 8000, 'a closed port is waited for, then given up on, without hanging');
    let paused = 0;
    const flag2 = path.join(dir, 'flag2');
    const usesPause = runSuiteRetrying(write('flaky2.js',
      `const fs=require('fs'); if(!fs.existsSync(${JSON.stringify(flag2)})){fs.writeFileSync(${JSON.stringify(flag2)},'1');throw new Error('getaddrinfo ENOTFOUND x.invalid')} console.log('1/1 checks passed')`),
      {}, { attempts: 3, pauseMs: 60000, pause: () => { paused++; } });
    ok(usesPause.status === 'pass' && paused === 1, 'the retry waits via the supplied pause (not the 60s default) and then passes');

    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`${pass}/${pass + fail} checks passed`);
    process.exit(fail ? 1 : 0);
  });
});
