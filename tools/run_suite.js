/* Runs one tools/ suite as a child process and says how it ended: passed,
 * failed, or ran out of time. mutate_backend.js used a bare execFileSync with
 * no timeout, so a suite that stopped making progress (a browser that never
 * exits, a pdflatex waiting on a prompt) froze the whole run with nothing on
 * screen -- indistinguishable from a slow one. A timeout is reported as its own
 * outcome rather than folded into "failed", because for a mutant it means
 * "the tests never finished" -- worth knowing, not the same as "an assertion
 * caught the break". */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/* Which check made a suite fail? Every suite in tools/ prints one `  FAIL  <label>`
 * line per failed check, in the order the checks ran, so the first such line is
 * the first check that broke. That is what a mutation report needs: "the suite
 * exited 1" says a mutant was noticed, the failing check says WHAT noticed it.
 *
 * A suite can also fail without any check failing -- it throws (a selector that
 * never appears because the mutant broke the page, a timeout waiting for a
 * panel). That still detects the mutant, but by accident rather than by an
 * assertion, and it is worth telling apart: kind 'crash' carries the first error
 * line instead. `null` means the output had neither (exit code only). */
function firstFailure(output) {
  const text = String(output || '');
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const m = /^\s*FAIL\s{2}(.+?)\s*$/.exec(line);
    if (m) return { kind: 'check', text: m[1].slice(0, 300) };
  }
  // No check failed. Prefer an error line naming what went wrong over a bare stack frame.
  const err = lines.map(l => l.trim()).find(l =>
    l && !/^at\s/.test(l) && !/^Node\.js v/.test(l) && !/^\^+$/.test(l) && !/^[{}\[\]]+,?$/.test(l)
    && /(Error|error|Timeout|exceeded|ENOENT|failed|Failed|TypeError|ReferenceError)/.test(l));
  if (err) return { kind: 'crash', text: err.slice(0, 300) };
  return null;
}

/* Did the suite fall over on the NETWORK rather than on the code under test?
 * These suites talk to a Postgres on Railway, and when that host cannot be
 * reached (a dropped connection, DNS gone, the laptop asleep) a suite dies in a
 * second or two -- non-zero exit, the very thing "caught" means. A run reported
 * five mutants caught this way (getaddrinfo ENOTFOUND altaria.proxy.rlwy.net,
 * 1.3s each against a clean run of a minute). So an infrastructure error anywhere
 * in the output makes the result INCONCLUSIVE: retried, and never counted as a
 * catch. Returns the matching text, or null. */
const INFRA = /(getaddrinfo\s+(?:ENOTFOUND|EAI_AGAIN)\S*\s*\S*|ENOTFOUND\s+\S+|EAI_AGAIN|ECONNREFUSED[^\n]*|ECONNRESET|ETIMEDOUT[^\n]*|EHOSTUNREACH|ENETUNREACH|Connection terminated[^\n]*|timeout exceeded when trying to connect|net::ERR_(?:INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_\w+))/;
function infrastructureError(output) {
  const m = INFRA.exec(String(output || ''));
  return m ? m[0].trim().slice(0, 160) : null;
}

const tallyOf = output => {
  const m = /(\d+)\/(\d+) checks passed/.exec(String(output || ''));
  return m ? { passed: Number(m[1]), total: Number(m[2]) } : null;
};

function runSuite(file, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const started = Date.now();
  const r = spawnSync('node', [file], { stdio: 'pipe', timeout: timeoutMs, killSignal: 'SIGKILL', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const ms = Date.now() - started;
  // spawnSync reports a timeout as an ETIMEDOUT error with the child killed.
  const timedOut = !!(r.error && r.error.code === 'ETIMEDOUT');
  const status = timedOut ? 'timeout' : (r.status === 0 && !r.error ? 'pass' : 'fail');
  const all = (r.stdout || '') + '\n' + (r.stderr || '');
  const tail = all.trim().split('\n').slice(-3).join(' | ').slice(0, 300);
  return { status, ms, tail, file: path.basename(file),
           firstFailure: status === 'fail' ? firstFailure(all) : null, tally: tallyOf(all),
           infra: status === 'fail' ? infrastructureError(all) : null };
}

/* Per-mutant budget, from how long the suite took on clean code: generous
 * enough that a slow machine does not turn a catch into a false alarm, short
 * enough that a hang costs minutes, not the afternoon. */
function mutantTimeoutMs(baselineMs) {
  return Math.max(2 * 60 * 1000, Math.min(4 * baselineMs, DEFAULT_TIMEOUT_MS));
}

/* runSuite, but an infrastructure failure is retried (a network blip is not a
 * verdict) after a pause, up to `attempts` times. The result says how many
 * attempts it took, and `infra` is still set if it never came good -- in which
 * case the caller must treat it as inconclusive, not as a failure of the code. */
function runSuiteRetrying(file, opts = {}, { attempts = 3, pauseMs = 30000, onRetry, pause } = {}) {
  let r;
  for (let i = 1; i <= attempts; i++) {
    r = runSuite(file, opts);
    r.attempts = i;
    if (r.status === 'pass' || !r.infra) return r;
    if (i < attempts) {
      if (onRetry) onRetry(r, i);
      // `pause` lets the caller wait on the thing that actually failed (the
      // database host coming back) instead of a fixed number of seconds; the
      // first version retried three times over 90s and an outage that lasted
      // forty minutes ate twenty-six mutants.
      if (pause) pause(r, i); else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, pauseMs);
    }
  }
  return r;
}

/* Block until host:port accepts a TCP connection, or maxMs passes. Synchronous on
 * purpose (the harness is: it holds a patched source file while it waits) and
 * done in a child process so a hung connect cannot hold this one. Returns
 * { up, waitedMs }. */
function waitForTcp(host, port, { maxMs = 45 * 60 * 1000, everyMs = 15000, log } = {}) {
  const started = Date.now();
  const probe = `const s=require('net').connect({host:${JSON.stringify(host)},port:${Number(port)}});`
    + `s.setTimeout(6000,()=>{s.destroy();process.exit(1)});s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));`;
  let announced = false;
  while (Date.now() - started < maxMs) {
    const r = spawnSync('node', ['-e', probe], { stdio: 'ignore', timeout: 10000 });
    if (r.status === 0) return { up: true, waitedMs: Date.now() - started };
    if (!announced && log) { log(`  ... ${host}:${port} is unreachable; waiting for it (up to ${Math.round(maxMs / 60000)} min)`); announced = true; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, everyMs);
  }
  return { up: false, waitedMs: Date.now() - started };
}

function fmt(ms) {
  return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s`;
}

/* PRE-FLIGHT: can this process run the suites at all?
 *
 * Without it, a machine that cannot run the suites finds out one suite at a
 * time, inside the baseline: eleven of thirteen `BASELINE FAILS` and sixty
 * mutants `UNVERIFIED` after several minutes of work, with the reason cut to a
 * three-line tail. That happened twice in one afternoon, from two different
 * causes, and both were about the PROCESS rather than the code:
 *
 *   - No browser visible to it. Playwright's chromium had never been installed,
 *     and once it was, a run launched from outside the Claude desktop app could
 *     not see it (the app's %LOCALAPPDATA% is a package-private copy).
 *   - A program the suites spawn was not on its PATH. `unzip` comes from Git for
 *     Windows; the desktop app's shell has it and a plain cmd process does not.
 *
 * So, before the baseline and before any source is touched, ask the question the
 * suites will ask: launch a browser once, and look for each program by name. Both
 * are read from the suites' own source, the way the baseline reads the set of
 * suites from the mutants, so a suite that starts needing a new tool is checked
 * without anyone remembering to add it to a list. It uses this process's
 * environment, which is the one runSuite hands its children -- so what it finds
 * is what the suites will find.
 *
 * Existence is what is checked for programs, not that they run: a Windows Store
 * python alias exists and may still open the Store. The baseline is what
 * establishes that a suite works; this only stops a doomed run early. */
function suiteNeeds(file) {
  let src = '';
  try { src = fs.readFileSync(file, 'utf8'); } catch { return { browser: false, programs: [] }; }
  const browser = /require\(\s*['"]playwright['"]\s*\)/.test(src);
  // Only a program named by a string literal: process.execPath and computed names are
  // not on anyone's PATH to lose.
  const programs = new Set();
  const re = /\b(?:execFileSync|execFile|spawnSync|spawn)\(\s*['"]([A-Za-z0-9_.-]+)['"]/g;
  let m;
  while ((m = re.exec(src))) programs.add(m[1]);
  return { browser, programs: [...programs] };
}

/* Where `name` would be found the way child_process resolves it. On Windows that
 * is name.exe (CreateProcess appends .exe and nothing else), not the .cmd/.bat
 * files a shell would also run -- reporting one of those as found would say
 * "fine" about something spawn cannot start. */
function findOnPath(name, env = process.env) {
  const win = process.platform === 'win32';
  const pathVar = env.PATH || env.Path || env.path || '';
  const files = win && !path.extname(name) ? [name + '.exe'] : [name];
  for (const dir of pathVar.split(path.delimiter).filter(Boolean)) {
    for (const f of files) {
      const p = path.join(dir, f);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* not here */ }
    }
  }
  return null;
}

// Resolves playwright from where the suites live (so it finds the same copy they
// do), launches chromium, opens a page, closes. One line of error on failure.
const BROWSER_PROBE = (fromDir) => `
  let chromium;
  try { ({ chromium } = require(require.resolve('playwright', { paths: [${JSON.stringify(fromDir)}] }))); }
  catch (e) { console.error('Cannot find module playwright'); process.exit(1); }
  (async () => { const b = await chromium.launch(); const p = await b.newPage(); await p.goto('about:blank'); await b.close(); })()
    .then(() => process.exit(0), e => { console.error(String((e && e.message) || e).split('\\n')[0]); process.exit(1); });`;

const BROWSER_HINT = 'Install them with:  npx playwright install chromium   (from energytech-mathquiz).\n'
  + '    If they ARE installed, this process cannot see them: check PLAYWRIGHT_BROWSERS_PATH. The Claude\n'
  + '    desktop app\'s %LOCALAPPDATA% is package-private, so a run launched from outside the app needs the\n'
  + '    browsers\' real location spelled out (tools\\run-mutation.cmd finds and sets it).';

function checkEnvironment(suiteFiles, { env = process.env, probe, launchTimeoutMs = 60000 } = {}) {
  const problems = [];
  const browserSuites = [];
  const programs = { node: { path: null, usedBy: ['run_suite.js'] } };   // runSuite spawns `node` by name
  for (const file of suiteFiles) {
    const needs = suiteNeeds(file);
    if (needs.browser) browserSuites.push(file);
    for (const p of needs.programs) (programs[p] = programs[p] || { path: null, usedBy: [] }).usedBy.push(path.basename(file));
  }
  for (const [name, info] of Object.entries(programs)) {
    info.path = findOnPath(name, env);
    if (!info.path) problems.push({ kind: 'program-missing', name, message: `${name} is not on PATH`, usedBy: info.usedBy });
  }
  if (browserSuites.length) {
    const r = spawnSync(process.execPath, ['-e', probe || BROWSER_PROBE(path.dirname(browserSuites[0]))],
      { env, stdio: 'pipe', timeout: launchTimeoutMs, killSignal: 'SIGKILL', encoding: 'utf8' });
    if (r.error && r.error.code === 'ETIMEDOUT') {
      problems.push({ kind: 'browser-timeout', message: `a browser did not launch within ${fmt(launchTimeoutMs)}`, usedBy: browserSuites.map(f => path.basename(f)) });
    } else if (r.status !== 0) {
      const detail = String((r.stderr || r.stdout || (r.error && r.error.message) || 'no output')).trim().split('\n')[0].slice(0, 300);
      const notInstalled = /Executable doesn't exist|playwright install/i.test(detail);
      const noPackage = /Cannot find module ['"]?playwright/i.test(detail);
      problems.push({
        kind: notInstalled ? 'browser-missing' : noPackage ? 'playwright-missing' : 'browser-launch',
        message: notInstalled ? 'Playwright browsers not installed'
          : noPackage ? 'the playwright package is not installed (npm install)'
          : 'Playwright could not launch a browser',
        detail, usedBy: browserSuites.map(f => path.basename(f)),
      });
    }
  }
  return { ok: problems.length === 0, problems, browserSuites, programs };
}

function formatPreflight(result) {
  const lines = ['PRE-FLIGHT FAILED -- this process cannot run the suites. Nothing was mutated and no report was written.'];
  for (const p of result.problems) {
    lines.push(`  ${p.message}`);
    if (p.detail) lines.push(`    ${p.detail}`);
    if (p.kind === 'browser-missing') lines.push(`    ${BROWSER_HINT}`);
    if (p.kind === 'program-missing') lines.push(`    Put its directory on PATH. Needed by: ${p.usedBy.join(', ')}.`);
    else if (p.usedBy) lines.push(`    Needed by ${p.usedBy.length} suite(s): ${p.usedBy.slice(0, 4).join(', ')}${p.usedBy.length > 4 ? ', ...' : ''}.`);
  }
  return lines.join('\n');
}

module.exports = { runSuite, runSuiteRetrying, waitForTcp, mutantTimeoutMs, fmt, firstFailure, tallyOf, infrastructureError,
  suiteNeeds, findOnPath, checkEnvironment, formatPreflight, DEFAULT_TIMEOUT_MS };
