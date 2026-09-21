#!/usr/bin/env node
/* Build the tree that GitHub Pages serves: the app's own files, and nothing meant for
 * developers.
 *
 * Pages deployed from a branch serves the WHOLE repository, so tools/ (the harness and
 * its reports), google_apps_script/ (the retired backend's source), README.md and
 * package*.json were all reachable from the live site. There is no ignore-file for
 * that; the way to publish part of a repository is to deploy an artifact, which is what
 * .github/workflows/pages.yml does with the output of this script.
 *
 *   node tools/stage-site.js <outDir> [--root DIR]
 *
 * <outDir> must not exist. The site's files are copied into it, taken from what git
 * tracks (so node_modules and the mutation snapshots can never be swept in), then
 * verified. Exit 1, with nothing to deploy, if:
 *   - a tracked top-level entry is in neither list of tools/site-files.json: it has to
 *     be classified on purpose, in either direction;
 *   - an entry is in both lists, or a `site` entry is not in the repository;
 *   - index.html is not staged, or any file the service worker precaches is missing
 *     (a missing one fails the worker's whole install, and with it offline use);
 *   - anything under a `developer` entry ended up staged. */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const rootIdx = argv.indexOf('--root');
const ROOT = path.resolve(rootIdx >= 0 ? argv[rootIdx + 1] : path.join(__dirname, '..'));
const outArg = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--root');
if (!outArg) { console.error('usage: node tools/stage-site.js <outDir> [--root DIR]'); process.exit(2); }
const OUT = path.resolve(outArg);

const errors = [];
const fail = (m) => errors.push(m);

let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'site-files.json'), 'utf8')); }
catch (e) { console.error(`cannot read tools/site-files.json: ${e.message}`); process.exit(1); }
const SITE = new Set(manifest.site || []);
const DEV = new Set(manifest.developer || []);

if (fs.existsSync(OUT)) { console.error(`${OUT} already exists; stage into a fresh directory.`); process.exit(1); }

const ls = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (ls.status !== 0) { console.error(`git ls-files failed: ${ls.stderr}`); process.exit(1); }
const tracked = ls.stdout.split('\0').filter(Boolean);
const top = (p) => p.split('/')[0];
const topLevel = [...new Set(tracked.map(top))].sort();

for (const name of SITE) if (DEV.has(name)) fail(`"${name}" is in both lists of tools/site-files.json.`);
const unclassified = topLevel.filter(n => !SITE.has(n) && !DEV.has(n));
if (unclassified.length) {
  fail(`not classified in tools/site-files.json (add each to "site" or to "developer"): ${unclassified.join(', ')}`);
}
for (const name of SITE) if (!topLevel.includes(name)) fail(`"site" lists "${name}", which is not in the repository.`);
const staleDev = [...DEV].filter(n => !topLevel.includes(n));   // harmless: a developer file that went away

const toCopy = tracked.filter(p => SITE.has(top(p)));
if (!errors.length) {
  for (const rel of toCopy) {
    const dest = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dest);
  }

  // Verify what was actually staged, not what was meant to be.
  const staged = (rel) => fs.existsSync(path.join(OUT, rel));
  if (!staged('index.html')) fail('index.html was not staged.');
  const sw = staged('service-worker.js') ? fs.readFileSync(path.join(OUT, 'service-worker.js'), 'utf8') : null;
  if (!sw) fail('service-worker.js was not staged.');
  else {
    const block = /const\s+FILES\s*=\s*\[([\s\S]*?)\]\s*;/.exec(sw);
    if (!block) fail('could not find the FILES list in service-worker.js.');
    else {
      const listed = [...block[1].matchAll(/(['"])(.+?)\1/g)].map(m => m[2]);
      const missing = listed.filter(f => {
        const rel = f.replace(/^\.\//, '');
        return rel === '' ? !staged('index.html') : !staged(rel);
      });
      if (!listed.length) fail('the service worker precaches nothing?');
      if (missing.length) fail(`the service worker precaches ${missing.length} file(s) that are not in the staged site: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}`);
    }
  }
  const leaked = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (!rel && DEV.has(e.name)) leaked.push(r);
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
    }
  })(OUT, '');
  if (leaked.length) fail(`developer files were staged: ${leaked.join(', ')}`);
}

if (errors.length) {
  console.error('SITE NOT STAGED -- nothing should be deployed:');
  errors.forEach(e => console.error(`  - ${e}`));
  fs.rmSync(OUT, { recursive: true, force: true });
  process.exit(1);
}
const excluded = tracked.filter(p => !SITE.has(top(p)));
console.log(`staged ${toCopy.length} files into ${OUT}`);
console.log(`not published (${excluded.length} files): ${[...DEV].filter(n => topLevel.includes(n)).join(', ')}`);
if (staleDev.length) console.log(`note: "developer" lists ${staleDev.join(', ')}, which are no longer in the repository.`);
