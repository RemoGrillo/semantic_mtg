#!/usr/bin/env node
// Review-mode server: serves site/ and stores "Suggest a change" submissions as Markdown files.
//
//   npm run docs:serve                      # http://localhost:4173/
//   npm run docs:serve -- --port 8080 --host 0.0.0.0   (expose on the LAN for a review session)
//
//   GET  /api/ping                 → { ok: true, app: "smtg-review", ... }
//   GET  /api/suggestions[?term=…] → { items: [ { file, termIri, termLabel, kind, author, createdAt, text } ] }
//   POST /api/suggestions          ← JSON { termIri, termLabel, kind, author, text }
//                                  → writes review/suggestions/<YYYY-MM-DD-HHMMSS>-<slug>.md (YAML front matter)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { p, CONFIG } from '../lib/common.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.split('=').slice(1).join('=') : def;
};
const PORT = Number(opt('port', process.env.PORT || 4173));
const HOST = opt('host', '127.0.0.1');
const SITE = path.resolve(opt('dir', p('site')));
const SUGG = path.resolve(opt('suggestions', p('review', 'suggestions')));

const KINDS = ['tweak', 'radical', 'question', 'proposal'];
const ROOT_DIR = p();
const displayPath = (abs) => (abs.startsWith(ROOT_DIR + path.sep) ? path.relative(ROOT_DIR, abs).split(path.sep).join('/') : abs);
const LIMITS = { body: 64 * 1024, termIri: 500, termLabel: 200, author: 100, text: 10000 };
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ttl': 'text/turtle; charset=utf-8',
  '.trig': 'application/trig; charset=utf-8',
  '.rq': 'application/sparql-query; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    ...extra,
  });
  res.end(buf);
}
const json = (res, status, obj) => send(res, status, obj);

// ---------- suggestions ----------

/** Single-line field: trim, strip control chars and line/paragraph separators, cap length. */
function clean(v, max) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new Error('fields must be strings');
  const s = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim();
  if (s.length > max) throw new Error(`field too long (max ${max} characters)`);
  return s;
}
function cleanText(v, max) {
  if (typeof v !== 'string') throw new Error('text must be a string');
  const s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (!s) throw new Error('text is required');
  if (s.length > max) throw new Error(`text too long (max ${max} characters)`);
  return s;
}
export function slugify(s) {
  const out = String(s || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return out || 'suggestion';
}
const yamlStr = (s) => JSON.stringify(String(s)); // JSON strings are valid YAML double-quoted scalars

export function validateSuggestion(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('expected a JSON object');
  const termIri = clean(body.termIri, LIMITS.termIri);
  if (!termIri) throw new Error('termIri is required');
  if (!/^(https?:\/\/|urn:)[^\s<>"{}|\\^`]+$/i.test(termIri)) throw new Error('termIri must be an absolute IRI');
  const termLabel = clean(body.termLabel, LIMITS.termLabel) || termIri;
  const kind = clean(body.kind, 20).toLowerCase();
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
  const author = clean(body.author, LIMITS.author);
  const text = cleanText(body.text, LIMITS.text);
  return { termIri, termLabel, kind, author, text };
}

function stamp(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}

function writeSuggestion(s) {
  fs.mkdirSync(SUGG, { recursive: true });
  const now = new Date();
  const local = s.termIri.replace(/[#/]+$/, '').split(/[#/]/).pop();
  const base = `${stamp(now)}-${slugify(s.termLabel !== s.termIri ? s.termLabel : local)}`;
  const md = [
    '---',
    `term: ${yamlStr(s.termIri)}`,
    `label: ${yamlStr(s.termLabel)}`,
    `kind: ${s.kind}`,
    `author: ${yamlStr(s.author || 'anonymous')}`,
    `created: ${now.toISOString()}`,
    'status: open',
    `ontologyVersion: ${yamlStr(CONFIG.ontologyVersion || '')}`,
    '---',
    '',
    `# ${s.kind[0].toUpperCase() + s.kind.slice(1)}: ${s.termLabel}`,
    '',
    `Term: <${s.termIri}>`,
    '',
    s.text,
    '',
  ].join('\n');
  for (let i = 0; i < 100; i++) {
    const name = i ? `${base}-${i + 1}.md` : `${base}.md`;
    const file = path.join(SUGG, name);
    if (path.dirname(file) !== SUGG) throw new Error('invalid file name'); // defence in depth
    try {
      fs.writeFileSync(file, md, { flag: 'wx' }); // never overwrite
      return displayPath(file);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
  throw new Error('could not allocate a file name');
}

function parseFrontMatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('"')) {
      try {
        v = JSON.parse(v);
      } catch {
        /* keep raw */
      }
    }
    meta[kv[1]] = v;
  }
  return { meta, body: m[2] };
}

function listSuggestions(term) {
  if (!fs.existsSync(SUGG)) return [];
  const items = [];
  for (const name of fs.readdirSync(SUGG).sort().reverse()) {
    if (!name.endsWith('.md') || name.startsWith('.') || /^readme/i.test(name)) continue;
    try {
      const { meta, body } = parseFrontMatter(fs.readFileSync(path.join(SUGG, name), 'utf8'));
      if (term && meta.term !== term) continue;
      // body = "# Kind: label\n\nTerm: <iri>\n\n<text>"
      const text = body.trim().replace(/^#[^\n]*\n+/, '').replace(/^Term: <[^>]*>\s*/, '').trim();
      items.push({ file: name, termIri: meta.term, termLabel: meta.label, kind: meta.kind, author: meta.author, createdAt: meta.created, status: meta.status, text });
    } catch {
      /* skip unreadable */
    }
    if (items.length >= 500) break;
  }
  return items;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    if (Number(req.headers['content-length']) > limit) {
      over = true;
      reject(Object.assign(new Error('request body too large'), { status: 413 }));
    }
    req.on('data', (c) => {
      if (over) return; // drain without buffering
      size += c.length;
      if (size > limit) {
        over = true;
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------- static files ----------

function serveStatic(req, res, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return send(res, 400, 'Bad request', 'text/plain; charset=utf-8');
  }
  if (rel.includes('\0')) return send(res, 400, 'Bad request', 'text/plain; charset=utf-8');
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(SITE, '.' + path.posix.normalize('/' + rel));
  if (file !== SITE && !file.startsWith(SITE + path.sep)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/ping') {
      return json(res, 200, { ok: true, app: 'smtg-review', project: CONFIG.project, version: CONFIG.ontologyVersion, suggestionsDir: displayPath(SUGG) });
    }
    if (url.pathname === '/api/suggestions') {
      if (req.method === 'GET') return json(res, 200, { items: listSuggestions(url.searchParams.get('term')) });
      if (req.method === 'POST') {
        // JSON only: a cross-site form cannot send application/json without a CORS preflight, which we never grant.
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Content-Type must be application/json' });
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) return json(res, 403, { error: 'cross-origin request refused' });
        let body;
        try {
          body = JSON.parse(await readBody(req, LIMITS.body));
        } catch (e) {
          if (e.status === 413) {
            res.on('finish', () => req.destroy());
            return send(res, 413, { error: `request body too large (max ${LIMITS.body} bytes)` }, undefined, { Connection: 'close' });
          }
          return json(res, 400, { error: 'invalid JSON' });
        }
        let s;
        try {
          s = validateSuggestion(body);
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
        const file = writeSuggestion(s);
        console.log(`[suggestion] ${s.kind} on ${s.termLabel} by ${s.author || 'anonymous'} → ${file}`);
        return json(res, 201, { ok: true, file });
      }
      return json(res, 405, { error: 'method not allowed' });
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'unknown endpoint' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'internal error' });
  }
});

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('serve.mjs');
if (isMain) {
  if (!fs.existsSync(path.join(SITE, 'index.html'))) console.warn(`warning: ${path.join(SITE, 'index.html')} not found — run: npm run docs:build`);
  server.listen(PORT, HOST, () => {
    const urls = [`http://${HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST}:${PORT}/`];
    if (HOST === '0.0.0.0' || HOST === '::') {
      for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${PORT}/`);
    }
    console.log(`SMTG docs — review mode\n  serving ${SITE}\n  suggestions → ${SUGG}\n  open: ${urls.join('  ')}`);
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is in use — try: npm run docs:serve -- --port ${PORT + 1}` : e.message);
    process.exit(1);
  });
}

export { server };
