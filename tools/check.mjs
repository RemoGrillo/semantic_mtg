#!/usr/bin/env node
// Run, locally, everything the CI and the GitHub Pages workflows run, before pushing:
//   validate → infer → cq → test → reason → docs:build → docs:smoke (headless Firefox)
// then check that the committed generated files (docs/status/*.json, inferred/*.ttl, …) are up to
// date: the Pages build publishes them as they are committed, it does not regenerate them.
//
// Generated files whose only change is a timestamp are restored, so a passing check leaves the
// working tree as it found it. Files you had already modified before the check are never touched.
//
// Usage: node tools/check.mjs [--no-reason] [--quick]      (npm run check)
//   --no-reason  skip the OWL reasoner (needs Java; downloaded into .tools/ on first use)
//   --quick      skip rendering every diagram in the browser smoke test
// Used by the pre-push hook in .githooks/ (enable with: npm run hooks:install).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { ROOT, log } from './lib/common.mjs';

const args = new Set(process.argv.slice(2));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });

const STEPS = [
  ['validate', 'parse every Turtle file; SHACL on examples (must pass) and invalid fixtures (must fail)'],
  ['infer', 'materialise the rule-inferred graph'],
  ['cq', 'competency questions'],
  ['test', 'unit tests'],
  ...(args.has('--no-reason') ? [] : [['reason', 'OWL reasoning (HermiT via ROBOT)']]),
  ['docs:build', 'build site/index.html'],
  ['docs:smoke', 'browser smoke test of the built site', args.has('--quick') ? ['--quick'] : []],
];
// tracked files the steps above regenerate
const GENERATED = /^(docs\/status\/|inferred\/|docs\/ontology\/inference-rules\.md$)/;

const dirtyBefore = new Set(changedTracked());
const t0 = Date.now();
let failed = null;
for (const [script, what, extra = []] of STEPS) {
  log(`── npm run ${script}  (${what})`);
  const r = spawnSync(npm, ['run', '-s', script, ...(extra.length ? ['--', ...extra] : [])], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    failed = script;
    break;
  }
}

// committed generated files: restore timestamp-only changes, report real ones
const stale = [];
const restored = [];
for (const file of changedTracked()) {
  if (dirtyBefore.has(file) || !GENERATED.test(file)) continue;
  const committed = git('show', `HEAD:${file}`);
  if (normalise(fs.readFileSync(path.join(ROOT, file), 'utf8')) === normalise(committed)) {
    git('checkout', '--', file);
    restored.push(file);
  } else stale.push(file);
}
if (restored.length) log(`restored ${restored.length} generated file(s) whose only change was a timestamp`);

const secs = ((Date.now() - t0) / 1000).toFixed(0);
if (failed) {
  log(`CHECK FAILED at "npm run ${failed}" (${secs} s). Fix it before pushing.`);
  process.exit(1);
}
if (stale.length) {
  log(`CHECK FAILED (${secs} s): these generated files changed and the committed versions are out of date.`);
  log('The published docs show the committed versions, so review the changes and commit them:');
  for (const f of stale) log(`  ${f}`);
  process.exit(1);
}
const dirtyNow = changedTracked();
log(`CHECK PASSED (${secs} s): everything CI and the Pages workflow run.`);
if (dirtyNow.length) log(`note: ${dirtyNow.length} tracked file(s) have uncommitted changes; the check ran on the working tree, a push sends only commits.`);

function changedTracked() {
  return git('diff', '--name-only', 'HEAD').split('\n').filter(Boolean);
}
function normalise(text) {
  // ISO timestamps, log timestamps ("2026-11-03 17:57:59,419") and dates in generated IRIs
  return text.replace(/\d{4}-\d\d-\d\d(?:[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?Z?)?/g, '<time>');
}
