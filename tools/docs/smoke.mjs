#!/usr/bin/env node
// Browser smoke test of the built documentation site (site/index.html), in headless Firefox.
//
// It serves site/ over HTTP under the same sub-path GitHub Pages uses (/<repo-name>/) and checks
// what unit tests cannot: hash routing on fresh loads of deep links, browser reloads, back/forward,
// anchors inside pages, the 404 page, JavaScript errors, and (unless --quick) that every Mermaid
// diagram on every page renders.
//
// Firefox is driven through WebDriver BiDi (built into Firefox, no driver or npm package needed).
// Usage: node tools/docs/smoke.mjs [--quick] [--require]      (npm run docs:smoke)
//   --quick    skip rendering every diagram (the slowest part)
//   --require  fail if Firefox is not available (default: skip with a warning); CI uses it
//   FIREFOX=/path/to/firefox selects the browser binary.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { p, log } from '../lib/common.mjs';

const args = new Set(process.argv.slice(2));
const SITE = p('site');
const INDEX = path.join(SITE, 'index.html');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!fs.existsSync(INDEX)) {
  console.error('site/index.html not found: run npm run docs:build first');
  process.exit(1);
}
const firefox = process.env.FIREFOX || (() => {
  try {
    return execFileSync('sh', ['-c', 'command -v firefox'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
})();
if (!firefox) {
  const msg = 'Firefox not found (set FIREFOX=/path/to/firefox): browser smoke test skipped';
  if (args.has('--require')) {
    console.error(msg);
    process.exit(1);
  }
  log(msg);
  process.exit(0);
}

// ---- static server, under the GitHub Pages project sub-path
let repoName = 'site';
try {
  repoName = new URL(JSON.parse(fs.readFileSync(p('smtg.config.json'), 'utf8')).repo.url).pathname.split('/').filter(Boolean).pop().replace(/\.git$/, '') || repoName;
} catch {
  /* keep the default */
}
const PREFIX = `/${repoName}/`;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(PREFIX)) return res.writeHead(404).end();
  const rel = decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html';
  const file = path.resolve(SITE, rel);
  if (!file.startsWith(SITE + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}${PREFIX}`;

// ---- Firefox over WebDriver BiDi
// Connect to the address Firefox itself announces on stderr ("WebDriver BiDi listening on ws://…"):
// depending on the system, "localhost" may be 127.0.0.1 or ::1.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'smtg-smoke-'));
const port = 9300 + Math.floor(Math.random() * 600);
const ff = spawn(firefox, ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', String(port), '--window-size=1400,1000', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
const ffOutput = [];
let ffExit = null;
let bidiUrl = null;
for (const stream of [ff.stdout, ff.stderr])
  stream.on('data', (d) => {
    for (const line of String(d).split('\n').filter(Boolean)) {
      ffOutput.push(line);
      if (ffOutput.length > 40) ffOutput.shift();
      bidiUrl ??= line.match(/WebDriver BiDi listening on (ws:\/\/\S+)/)?.[1]?.replace(/\/$/, '') ?? null;
    }
  });
ff.on('exit', (code, signal) => (ffExit = signal ?? code));
const STARTUP_S = 90;
let ws;
const t0 = Date.now();
while (!ws && ffExit === null && Date.now() - t0 < STARTUP_S * 1000) {
  await sleep(250);
  // until Firefox announces its address, try both loopback addresses
  for (const url of bidiUrl ? [bidiUrl] : [`ws://127.0.0.1:${port}`, `ws://[::1]:${port}`]) {
    try {
      const w = new WebSocket(`${url}/session`);
      await new Promise((res, rej) => {
        w.onopen = res;
        w.onerror = rej;
      });
      ws = w;
      break;
    } catch {
      /* not up yet */
    }
  }
}
const startupSecs = ((Date.now() - t0) / 1000).toFixed(1);
let msgId = 0;
const pending = new Map();
const consoleErrors = [];
// every browser command has a time limit, so a stalled page or browser fails the test instead of
// hanging it (rendering every diagram gets longer)
const send = (method, params = {}, timeoutMs = 60_000) =>
  new Promise((res, rej) => {
    const i = ++msgId;
    const timer = setTimeout(() => {
      pending.delete(i);
      rej(new Error(`${method} did not answer within ${timeoutMs / 1000} s`));
    }, timeoutMs);
    pending.set(i, {
      res: (v) => (clearTimeout(timer), res(v)),
      rej: (e) => (clearTimeout(timer), rej(e)),
    });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
// and the whole run too
const WATCHDOG_MIN = 10;
setTimeout(() => {
  console.error(`smoke test FAILED: still running after ${WATCHDOG_MIN} minutes`);
  ff.kill('SIGKILL');
  process.exit(1);
}, WATCHDOG_MIN * 60_000).unref();

const failures = [];
let checks = 0;
// on GitHub Actions, failures also become annotations (shown on the run page, and readable
// through the public API without access to the logs)
const annotate = (msg) => {
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=docs smoke test::${String(msg).replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);
};
const check = (ok, what, detail) => {
  checks++;
  if (ok) log(`  ok   ${what}`);
  else {
    failures.push(what);
    log(`  FAIL ${what}${detail ? `\n         ${detail}` : ''}`);
    annotate(`${what}${detail ? `\n${detail}` : ''}`);
  }
};

try {
  if (!ws)
    throw new Error(
      `could not connect to Firefox (${firefox}) within ${startupSecs} s` +
        (ffExit !== null ? `; Firefox exited (${ffExit})` : '') +
        `; announced address: ${bidiUrl ?? 'none'}; last Firefox output:\n         ${ffOutput.slice(-15).join('\n         ') || '(none)'}`,
    );
  log(`Firefox connected in ${startupSecs} s (${bidiUrl ?? `port ${port}`})`);
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.type === 'error' ? rej(new Error(`${m.error}: ${m.message}`)) : res(m.result);
    } else if (m.method === 'log.entryAdded' && m.params.level === 'error') {
      consoleErrors.push(m.params.text);
    }
  };
  await send('session.new', { capabilities: {} });
  await send('session.subscribe', { events: ['log.entryAdded'] });
  const ctx = (await send('browsingContext.getTree')).contexts[0].context;
  const evaluate = async (expr, timeoutMs) => {
    const r = await send('script.evaluate', { expression: expr, target: { context: ctx }, awaitPromise: true }, timeoutMs);
    if (r.type === 'exception') throw new Error(r.exceptionDetails?.text ?? 'exception in page');
    return r.result?.value;
  };
  const STATE = `JSON.stringify({
    hash: location.hash,
    visible: [...document.querySelectorAll('section.route:not([hidden])')].map((s) => s.dataset.route),
    scrollY: Math.round(scrollY),
    title: document.title,
    errors: (window.__smtg && window.__smtg.errors) || []
  })`;
  const state = async () => JSON.parse(await evaluate(STATE));
  // wait until the page has done its work (loaded, diagrams of the shown page rendered), then a
  // little longer for scrolling; no fixed sleeps, so a slow machine is not a failure
  const settle = () =>
    evaluate(
      `new Promise((resolve) => {
        const t0 = Date.now();
        const ready = () => document.readyState === 'complete' && window.__smtg &&
          !document.querySelector('section.route:not([hidden]) figure.diagram:not([data-done="1"]):not([data-done="error"])');
        (function poll() {
          if (ready() || Date.now() - t0 > 15000) setTimeout(() => resolve(Date.now() - t0), 400);
          else setTimeout(poll, 100);
        })();
      })`,
      30_000,
    );
  const freshLoad = async (hash) => {
    await send('browsingContext.navigate', { context: ctx, url: 'about:blank', wait: 'complete' });
    await send('browsingContext.navigate', { context: ctx, url: BASE + hash, wait: 'complete' });
    await settle();
    return state();
  };
  const onlyRoute = (s, route) => s.visible.length === 1 && s.visible[0] === route;
  const show = (s) => `visible=${JSON.stringify(s.visible)} hash=${s.hash} scrollY=${s.scrollY}`;

  log(`smoke test: ${BASE} in ${path.basename(firefox)}`);
  const routes = JSON.parse(await (async () => {
    await freshLoad('');
    return evaluate(`JSON.stringify([...document.querySelectorAll('section.route')].map((s) => s.dataset.route))`);
  })());
  check(routes.length > 50, `the page has ${routes.length} routes`);
  const pick = (re) => routes.find((r) => re.test(r));
  const classRoute = pick(/^class\/RankObservation$/) ?? pick(/^class\//);
  const otherClass = pick(/^class\/OracleCard$/) ?? routes.filter((r) => r.startsWith('class/'))[1];
  const pageRoute = pick(/^page\/review-questions$/) ?? pick(/^page\//);

  // 1. fresh loads (what a reader gets when opening a shared link or reloading)
  for (const [hash, route] of [
    ['', 'overview'],
    ['#/', 'overview'],
    [`#/${classRoute}`, classRoute],
    ['#/about', 'about'],
    [`#/${pageRoute}`, pageRoute],
  ]) {
    const s = await freshLoad(hash);
    check(onlyRoute(s, route), `fresh load of "${hash || '(no hash)'}" shows only ${route}`, show(s));
    if (route !== 'overview') check(s.scrollY < 50, `fresh load of "${hash}" starts at the top`, show(s));
  }
  // an anchor inside a page: the target must be on screen
  if (pageRoute === 'page/review-questions') {
    const hash = '#/page/review-questions/RQ-ID-1';
    const s = await freshLoad(hash);
    const inView = await evaluate(`(() => { const el = document.querySelector('section.route:not([hidden]) [data-anchor-id~="RQ-ID-1"]'); if (!el) return 'missing'; const r = el.getBoundingClientRect(); return r.top >= -5 && r.top < innerHeight ? 'yes' : 'top=' + Math.round(r.top); })()`);
    check(onlyRoute(s, pageRoute) && inView === 'yes', `fresh load of "${hash}" shows the anchor on screen`, `${show(s)} inView=${inView}`);
  }
  // unknown route → 404 page, and nothing else
  {
    const s = await freshLoad('#/class/NoSuchClass');
    check(onlyRoute(s, '404'), 'an unknown route shows only the 404 page', show(s));
  }

  // 2. in-page navigation, reload, back and forward
  {
    await freshLoad(`#/${classRoute}`);
    await evaluate(`(location.hash = ${JSON.stringify(`#/${otherClass}`)}, 1)`);
    await settle();
    let s = await state();
    check(onlyRoute(s, otherClass), `navigating ${classRoute} → ${otherClass} shows only the new page`, show(s));
    await send('browsingContext.reload', { context: ctx, wait: 'complete' });
    await settle();
    s = await state();
    check(onlyRoute(s, otherClass), `reloading on ${otherClass} keeps that page, alone`, show(s));
    await send('browsingContext.traverseHistory', { context: ctx, delta: -1 });
    await settle();
    s = await state();
    check(onlyRoute(s, classRoute), `Back returns to ${classRoute}`, show(s));
    await send('browsingContext.traverseHistory', { context: ctx, delta: 1 });
    await settle();
    s = await state();
    check(onlyRoute(s, otherClass), `Forward returns to ${otherClass}`, show(s));
    // the sidebar link of the shown page is the active one
    const active = await evaluate(`(document.querySelector('#sidebar a[aria-current="page"]') || { getAttribute: () => '' }).getAttribute('href')`);
    check(active === `#/${otherClass}`, 'the sidebar marks the shown page as current', `aria-current link: ${active || '(none)'}`);
  }

  // 3. every diagram on every page renders (Mermaid), unless --quick
  if (!args.has('--quick')) {
    await freshLoad('');
    const t0 = Date.now();
    const out = JSON.parse(await evaluate(`window.__smtg.renderAll().then((o) => JSON.stringify(o))`, 300_000));
    check(out.failed.length === 0, `${out.diagrams} diagrams on ${out.routes} pages render (${((Date.now() - t0) / 1000).toFixed(0)} s)`, out.failed.slice(0, 10).join('\n         '));
  }

  const s = await state();
  check(s.errors.length === 0 && consoleErrors.length === 0, 'no JavaScript errors', [...s.errors, ...consoleErrors].slice(0, 10).join('\n         '));
} catch (e) {
  failures.push(e.message);
  log(`  FAIL ${e.message}`);
  annotate(e.message);
} finally {
  try {
    ws?.close();
  } catch {
    /* closed */
  }
  ff.kill();
  server.close();
  await sleep(300);
  fs.rmSync(profile, { recursive: true, force: true });
}
log(failures.length ? `smoke test FAILED: ${failures.length} failure(s), ${checks} checks run` : `smoke test passed: ${checks} checks`);
process.exit(failures.length ? 1 : 0);
