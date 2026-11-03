#!/usr/bin/env node
// Build the SMTG documentation site: ONE self-contained site/index.html (works from file:// and on
// GitHub Pages) plus downloadable Turtle copies under site/ontology/.
//
//   npm run docs:build
//   node tools/docs/build.mjs [--ontology-dir <dir>] [--root <input-root>] [--out <dir>] [--strict] [--quiet]
//
//   --ontology-dir  directory with the ontology modules (default <root>/ontology)
//   --root          where docs/, shapes/, examples/, mappings/, queries/, proposals/, README.md… are read
//                   (default: the repository root)
//   --out           output directory (default <repo>/site)
//   --strict        exit 1 if any Turtle file fails to parse or any diagram is invalid
//
// Every input is optional: missing files produce empty states on the page, never a crash.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, CONFIG, p, readJSON, log } from '../lib/common.mjs';
import { parseFile, Prefixes, Graph, NS } from './lib/rdf.mjs';
import { buildModel } from './lib/model.mjs';
import { extractShapes } from './lib/shacl.mjs';
import { loadExamples } from './lib/instances.mjs';
import { Symbols, esc, attr, slugify } from './lib/html.mjs';
import { renderMarkdown, idsIn, splitFrontMatter } from './lib/markdown.mjs';
import { mermaidChecker } from './lib/mermaid-check.mjs';
import { PALETTE } from './lib/diagrams.mjs';
import { link } from './render/common.mjs';
import {
  classPage, propertyPage, individualPage, vocabPage, modulePage, layoutMatrix, classesIndex, propertiesIndex, modulesIndex, vocabIndex,
} from './render/terms.mjs';
import { auditPage, coveragePage, normaliseMappings, coverageData } from './render/audit.mjs';
import {
  overviewPage, markdownPage, adrIndexPage, adrMeta, parseRq, cqPage, statusPage, overlayPage, proposalsIndex, aboutPage, suggestionsPage, notFoundPage,
} from './render/pages.mjs';
import { shell } from './render/shell.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);

// ---------- CLI ----------
function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    if (v !== undefined) out[k] = v;
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[k] = argv[++i];
    else out.flags.add(k);
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const INPUT = path.resolve(args.root || ROOT);
const ONT_DIR = path.resolve(args['ontology-dir'] || path.join(INPUT, 'ontology'));
const OUT = path.resolve(args.out || p('site'));
const STRICT = args.flags.has('strict');
const QUIET = args.flags.has('quiet');

// ---------- warnings ----------
const warnings = [];
const seenWarn = new Set();
function warn(msg, cat = 'general') {
  const k = `${cat}|${msg}`;
  if (seenWarn.has(k)) return;
  seenWarn.add(k);
  warnings.push({ msg, cat });
}

// ---------- file helpers ----------
function walk(dir, re) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const rec = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) rec(full);
      else if (re.test(e.name)) out.push(full);
    }
  };
  rec(dir);
  return out;
}
const toPosix = (s) => s.split(path.sep).join('/');
const rel = (abs) => (abs === ROOT ? '.' : abs.startsWith(ROOT + path.sep) ? path.relative(ROOT, abs) : abs);
function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}
function readJsonSafe(rel) {
  const file = path.join(INPUT, rel);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    warn(`${rel}: invalid JSON (${e.message})`, 'inputs');
    return null;
  }
}

function loadRdf(files, base, kindOf, relPrefix = '') {
  return files.map((abs) => {
    const rel = relPrefix + toPosix(path.relative(base, abs));
    const f = { rel, abs, kind: kindOf(rel), text: null, quads: null, prefixes: {}, error: null };
    try {
      const r = parseFile(abs);
      Object.assign(f, r);
    } catch (e) {
      f.text = readText(abs);
      f.error = String(e.message || e).split('\n')[0];
      warn(`${rel}: ${f.error}`, 'parse');
    }
    return f;
  });
}

// ---------- main ----------
async function main() {
  const t0 = Date.now();
  const builtAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  log(`docs: ontology=${rel(ONT_DIR)} root=${rel(INPUT)} → ${rel(OUT)}`);
  if (!fs.existsSync(ONT_DIR)) warn(`Ontology directory ${ONT_DIR} does not exist`, 'inputs');

  // 1. RDF inputs
  const ontoFiles = loadRdf(walk(ONT_DIR, /\.(ttl|trig)$/i), ONT_DIR, (rel) => (rel.startsWith('vocab/') ? 'vocab' : rel.startsWith('views/') ? 'view' : 'module'));
  const shapeFiles = loadRdf(walk(path.join(INPUT, 'shapes'), /\.(ttl|trig)$/i), INPUT, () => 'shapes');
  const exampleFiles = loadRdf(walk(path.join(INPUT, 'examples'), /\.(ttl|trig)$/i), INPUT, () => 'examples');
  const proposalFiles = loadRdf(walk(path.join(INPUT, 'proposals'), /\.(ttl|trig)$/i), INPUT, () => 'proposal');
  const prefixes = new Prefixes();
  for (const f of [...ontoFiles, ...shapeFiles, ...exampleFiles, ...proposalFiles]) prefixes.add(f.prefixes);

  const coreFiles = ontoFiles.filter((f) => f.kind !== 'view');
  const m = buildModel({ files: coreFiles, prefixes, warn });
  for (const mod of m.modules.values()) {
    if (mod.kind === 'module' && !mod.terms.length && mod.imports.length >= 1) mod.kind = 'aggregate';
    mod.importedBy = [...m.modules.values()].filter((x) => x.imports.includes(mod.iri)).map((x) => x.iri);
  }
  const shacl = extractShapes(shapeFiles, warn);
  const ex = loadExamples(exampleFiles);

  // overlays: opt-in views (one per file) and proposals (one per directory)
  const overlays = [];
  const mkOverlay = (kind, id, files) => {
    const om = buildModel({ files: [...coreFiles, ...files], prefixes, keyer: m.key });
    const subjects = new Set();
    const quads = [];
    for (const f of files) for (const q of f.quads || []) {
      quads.push(q);
      if (q.subject.termType === 'NamedNode') subjects.add(q.subject.value);
    }
    const header = [...om.modules.values()].find((md) => files.some((f) => f.rel === md.file));
    const terms = [...om.terms.values()].filter((t) => subjects.has(t.iri) && t.iri !== header?.iri);
    for (const t of terms) if (!m.terms.has(t.iri)) t.overlayRoute = `#/${kind}/${id}/${t.key}`;
    for (const sc of om.schemes.values()) void sc;
    const label = header?.label || id;
    overlays.push({ kind, id, files, model: om, graph: new Graph(quads), header, terms: terms.sort((a, b) => a.label.localeCompare(b.label)), label });
  };
  for (const f of ontoFiles.filter((x) => x.kind === 'view')) mkOverlay('view', slugify(path.basename(f.rel).replace(/\.(ttl|trig)$/i, '')), [f]);
  const propDirs = new Map();
  for (const f of proposalFiles) {
    const dir = f.rel.split('/')[1] || 'proposal';
    if (!propDirs.has(dir)) propDirs.set(dir, []);
    propDirs.get(dir).push(f);
  }
  for (const [dir, files] of propDirs) mkOverlay('proposal', slugify(dir), files);

  // 2. JSON / text inputs
  const inputs = {
    sources: readJsonSafe('docs/source-audit/sources.json'),
    census: readJsonSafe('docs/source-audit/scryfall-census.json'),
    oracleCensus: readJsonSafe('docs/source-audit/scryfall-oracle-census.json'),
    tagger: readJsonSafe('docs/source-audit/tagger-profile.json'),
    spellbook: readJsonSafe('docs/source-audit/spellbook-profile.json'),
    validation: readJsonSafe('docs/status/validation.json'),
    cq: readJsonSafe('docs/status/cq-results.json'),
    reasoner: readJsonSafe('docs/status/reasoner.json'),
    inference: readJsonSafe('docs/status/inference.json'),
    rq: walk(path.join(INPUT, 'queries', 'competency'), /\.rq$/i).map((abs) => {
      const text = readText(abs) || '';
      return { ...parseRq(text), rel: toPosix(path.relative(INPUT, abs)), file: path.basename(abs, '.rq') };
    }),
  };
  const mappingFiles = walk(path.join(INPUT, 'mappings'), /\.fields\.json$/i).map((abs) => {
    const rel = toPosix(path.relative(INPUT, abs));
    let data = null;
    try {
      data = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      warn(`${rel}: invalid JSON (${e.message})`, 'inputs');
    }
    return { rel, name: path.basename(abs), data };
  });
  const mappingEntries = normaliseMappings(mappingFiles, prefixes);
  const mappingByTerm = new Map();
  for (const e of mappingEntries) {
    for (const t of e.terms) {
      if (!mappingByTerm.has(t)) mappingByTerm.set(t, []);
      mappingByTerm.get(t).push(e);
      if (!m.terms.has(t)) warn(`${e.file}: ${e.path} maps to unknown term ${prefixes.shorten(t)}`, 'mappings');
    }
  }
  const coverage = coverageData(inputs, mappingEntries);

  // 3. Markdown documents
  const DOC_PAGES = [
    ['review-questions', 'Review questions'],
    ['anti-patterns', 'Anti-patterns'],
    ['epistemic-layer-dec', 'Epistemic layer & DEC'],
    ['conceptual-model', 'Conceptual model'],
    ['competency-questions', 'Competency questions (narrative)'],
  ];
  const mdDocs = []; // { slug, route, file, title, src }
  const docDir = path.join(INPUT, 'docs', 'ontology');
  const listed = new Set(DOC_PAGES.map(([s]) => s));
  for (const [slug, title] of DOC_PAGES) mdDocs.push({ slug, route: `page/${slug}`, file: `docs/ontology/${slug}.md`, title, src: readText(path.join(docDir, `${slug}.md`)) });
  for (const abs of walk(docDir, /\.md$/i)) {
    const slug = path.basename(abs, '.md');
    if (listed.has(slug) || path.dirname(abs) !== docDir) continue;
    const src = readText(abs);
    const t = /^#\s+(.+)$/m.exec(splitFrontMatter(src || '').body)?.[1] || slug;
    mdDocs.push({ slug, route: `page/${slug}`, file: `docs/ontology/${slug}.md`, title: t, src, extra: true });
  }
  mdDocs.push({ slug: 'contributing', route: 'page/contributing', file: 'CONTRIBUTING.md', title: 'Contributing', src: readText(path.join(INPUT, 'CONTRIBUTING.md')) });
  mdDocs.push({ slug: 'disclaimer', route: 'page/disclaimer', file: 'DISCLAIMER.md', title: 'Disclaimer & credits', src: readText(path.join(INPUT, 'DISCLAIMER.md')) });
  const adrFiles = walk(path.join(INPUT, 'docs', 'adr'), /\.md$/i).filter((f) => !/^(readme|index)|template/i.test(path.basename(f)));
  const statusMdSrc = readText(path.join(INPUT, 'docs', 'STATUS.md'));
  const readmeSrc = readText(path.join(INPUT, 'README.md'));

  // ID registry from headings (before rendering, so every page can link to every ID)
  const idReg = new Map(); // id -> { route, title }
  const scanHeadings = (src, route) => {
    let fence = false;
    for (const line of String(src || '').split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(line)) fence = !fence;
      if (fence) continue;
      const h = /^#{1,6}\s+(.*)$/.exec(line);
      if (!h) continue;
      for (const id of idsIn(h[1])) if (!idReg.has(id)) idReg.set(id, { route, title: h[1].replace(/[#*`_]/g, '').replace(id, '').replace(/^[\s:—–-]+/, '').trim() });
    }
  };
  for (const q of inputs.rq) if (q.meta.id) idReg.set(q.meta.id, { route: 'cq', title: q.meta.title || '' });
  for (const r of inputs.cq?.results || []) if (r.id && !idReg.has(r.id)) idReg.set(r.id, { route: 'cq', title: r.title || '' });
  const adrs = adrFiles.map((abs) => {
    const src = readText(abs) || '';
    const rel = toPosix(path.relative(INPUT, abs));
    const quick = { meta: splitFrontMatter(src).meta, title: /^#\s+(.+)$/m.exec(splitFrontMatter(src).body)?.[1] || null };
    const meta = adrMeta(quick, src, rel);
    return { ...meta, file: rel, src };
  }).sort((a, b) => a.num.localeCompare(b.num, 'en', { numeric: true }));
  for (const a of adrs) {
    if (/^ADR-/.test(a.id)) idReg.set(a.id, { route: `adr/${a.num}`, title: a.title, whole: true });
    scanHeadings(a.src, `adr/${a.num}`);
  }
  for (const d of mdDocs) if (d.src) scanHeadings(d.src, d.route);
  scanHeadings(statusMdSrc, 'status');
  const missingIds = new Set();
  const expectedPage = (id) => (id.startsWith('RQ-') ? 'page/review-questions' : id.startsWith('AP-') ? 'page/anti-patterns' : id.startsWith('CQ-') ? 'cq' : 'adrs');
  const idHref = (id) => {
    const r = idReg.get(id);
    if (r) return { href: r.whole ? `#/${r.route}` : `#/${r.route}/${id}`, title: r.title };
    if (!missingIds.has(id)) {
      missingIds.add(id);
      warn(`${id} is referenced but not defined in any heading`, 'references');
    }
    return { href: `#/${expectedPage(id)}`, missing: `${id} is not (yet) defined in the documentation` };
  };
  const backrefs = new Map();
  for (const t of m.terms.values()) {
    for (const id of [...(t.reviewQuestions || []), ...(t.antiPatterns || [])]) {
      if (!backrefs.has(id)) backrefs.set(id, []);
      backrefs.get(id).push(t);
    }
  }
  const backlinks = (id) => {
    const ts = backrefs.get(id);
    if (!ts?.length) return '';
    return `<p class="backlinks"><span class="lbl">referenced by</span> ${ts.map((t) => link(m, t.iri, { text: t.kind === 'concept' ? t.label : undefined })).join(', ')}</p>`;
  };

  // diagram placeholders (validated after all pages are rendered)
  const diagrams = [];
  const diagram = (src, opts = {}) => {
    diagrams.push({ src, ...opts });
    return `<!--MMD:${diagrams.length - 1}-->`;
  };

  const symbols = new Symbols(p('node_modules', 'mana-font'), warn);
  const pipClass = (code) => symbols.classFor(code);
  m.pipClass = pipClass;
  for (const ov of overlays) ov.model.pipClass = pipClass;
  const repoUrl = (CONFIG.repo?.url || '').trim();
  const ontoRelOf = (abs) => toPosix(path.relative(ONT_DIR, abs));
  const resolveFile = (rel) => {
    if (rel === 'README.md') return '#/overview';
    if (rel === 'CONTRIBUTING.md') return '#/page/contributing';
    if (rel === 'DISCLAIMER.md') return '#/page/disclaimer';
    if (rel === 'docs/STATUS.md') return '#/status';
    const d = /^docs\/ontology\/([^/]+)\.md$/.exec(rel);
    if (d && mdDocs.some((x) => x.slug === d[1] && x.src)) return `#/page/${d[1]}`;
    const a = adrs.find((x) => x.file === rel);
    if (a) return `#/adr/${a.num}`;
    if (/^docs\/adr\/?$/.test(rel)) return '#/adrs';
    if (/\.(ttl|trig)$/i.test(rel)) {
      const abs = path.join(INPUT, rel);
      if (abs.startsWith(ONT_DIR + path.sep)) return `ontology/${ontoRelOf(abs)}`;
      if (/^(shapes|examples|proposals)\//.test(rel)) return `ontology/${rel}`;
    }
    if (/^queries\/.*\.rq$/i.test(rel)) return `ontology/${rel}`;
    return null;
  };
  const mdCtx = (route, file) => ({ route, file, rootDir: INPUT, resolveFile, idHref, backlinks, diagram, symbols, repoUrl });
  const md = (src, route, file) => renderMarkdown(src, mdCtx(route, file));

  const rendered = new Map();
  for (const d of mdDocs) if (d.src) rendered.set(d.slug, md(d.src, d.route, d.file));
  const hasPage = (slug) => rendered.has(slug);

  // README intro = everything before the first "## " heading (h1 used as page title)
  let readmeIntro = '';
  if (readmeSrc) {
    const body = splitFrontMatter(readmeSrc).body;
    const cut = body.search(/^##\s/m);
    const first = (cut >= 0 ? body.slice(0, cut) : body).replace(/^#\s+.*$/m, '').trim();
    if (first) readmeIntro = md(first, 'overview', 'README.md').html;
  }
  const statusMd = statusMdSrc ? md(statusMdSrc.replace(/^#\s+.*$/m, (h) => h.replace(/^#/, '##')), 'status', 'docs/STATUS.md').html : '';

  const licAdr = adrs.find((a) => /licen[cs]/i.test(a.title + ' ' + a.src.slice(0, 3000)));
  const ctx = {
    m, shacl, ex, symbols, prefixes, config: CONFIG, inputs, coverage, mappingByTerm, idHref, diagram, warn, warnings, builtAt, overlays, adrs,
    hasPage, readmeIntro, statusMd,
    extraPages: mdDocs.filter((d) => d.extra && d.src).map((d) => ({ slug: d.slug, title: d.title })),
    markdownInline: (text) => md(String(text), 'inline', 'inline.md').html,
    adrLink: licAdr ? `<a href="#/adr/${attr(licAdr.num)}">${esc(licAdr.id)}</a>` : null,
  };
  ctx.legend = null;

  // 4. Render sections (each in isolation: one failing page must not break the build)
  const sections = [];
  const safe = (label, fn) => {
    try {
      const s = fn();
      if (s) sections.push(s);
    } catch (e) {
      warn(`page ${label} failed to render: ${e.message}`, 'render');
      if (!QUIET) console.error(e.stack);
      const route = typeof label === 'string' ? label : 'error';
      sections.push({ route, title: route, html: `<article class="page"><h1>${esc(route)}</h1><div class="callout bad">This page could not be generated: <code>${esc(e.message)}</code></div></article>` });
    }
  };
  safe('overview', () => overviewPage(ctx));
  safe('modules', () => modulesIndex(ctx));
  for (const mod of m.modules.values()) safe(`module/${mod.id}`, () => modulePage(ctx, mod));
  safe('classes', () => classesIndex(ctx));
  for (const c of m.classes.values()) if (c.local) safe(`class/${c.key}`, () => classPage(ctx, c));
  safe('properties', () => propertiesIndex(ctx));
  for (const pr of m.properties.values()) if (pr.local) safe(`property/${pr.key}`, () => propertyPage(ctx, pr));
  for (const i of m.individuals.values()) if (i.local) safe(`individual/${i.key}`, () => individualPage(ctx, i));
  safe('vocabularies', () => vocabIndex(ctx));
  for (const sc of m.schemes.values()) safe(`vocab/${sc.key}`, () => vocabPage(ctx, sc));
  safe('layouts', () => layoutMatrix(ctx));
  safe('audit', () => auditPage(ctx));
  safe('coverage', () => coveragePage(ctx));
  safe('cq', () => cqPage(ctx));
  for (const d of mdDocs) safe(d.route, () => markdownPage(ctx, { route: d.route, file: d.file, title: d.title, rendered: rendered.get(d.slug) }));
  safe('adrs', () => adrIndexPage(ctx, adrs));
  for (const a of adrs) {
    safe(`adr/${a.num}`, () =>
      markdownPage(ctx, {
        route: `adr/${a.num}`,
        file: a.file,
        title: `${a.id}: ${a.title}`,
        rendered: md(a.src, `adr/${a.num}`, a.file),
        crumbs: `<a href="#/adrs">Decisions</a><span class="sep" aria-hidden="true">/</span><span>${esc(a.id)}</span>`,
        extraTop: a.status ? `<p class="adr-meta"><span class="chip adr-${esc(a.status.toLowerCase().split(/\s/)[0])}">${esc(a.status)}</span>${a.date ? ` <span class="muted">${esc(a.date)}</span>` : ''}</p>` : '',
      }),
    );
  }
  const propReadme = readText(path.join(INPUT, 'proposals', 'README.md'));
  ctx.proposalsReadme = propReadme ? md(propReadme.replace(/^#\s+.*$/m, ''), 'proposals', 'proposals/README.md').html : '';
  safe('proposals', () => proposalsIndex(ctx, overlays));
  for (const ov of overlays) safe(`${ov.kind}/${ov.id}`, () => overlayPage(ctx, ov));
  // status last: it lists the warnings collected so far
  const statusIdx = sections.length;
  safe('about', () => aboutPage(ctx));
  safe('suggestions', () => suggestionsPage());
  safe('404', () => notFoundPage());

  // 5. Validate diagrams and substitute placeholders
  const check = await mermaidChecker(warn);
  const diagramHtml = [];
  let invalid = 0;
  for (let i = 0; i < diagrams.length; i++) {
    const d = diagrams[i];
    const err = await check(d.src);
    if (err) {
      invalid++;
      warn(`diagram "${d.title || d.source || i}" is invalid: ${err}`, 'diagram');
      diagramHtml.push(`<div class="callout bad diagram-error"><strong>Diagram could not be generated.</strong> <code>${esc(err)}</code><details><summary>Mermaid source</summary><pre>${esc(d.src)}</pre></details></div>`);
    } else diagramHtml.push(figure(d, i));
  }
  safe('status', () => statusPage(ctx));
  const statusSection = sections.pop();
  sections.splice(statusIdx, 0, statusSection);
  for (const s of sections) s.html = s.html.replace(/<!--MMD:(\d+)-->/g, (_, n) => diagramHtml[Number(n)] || '');

  // duplicate route guard
  const seenRoutes = new Set();
  for (const s of sections) {
    if (seenRoutes.has(s.route)) warn(`duplicate route ${s.route}`, 'render');
    seenRoutes.add(s.route);
  }

  // 6. Assemble
  const css = fontFaces() + readText(path.join(HERE, 'assets', 'styles.css')) + '\n' + symbols.css();
  const clientJs = readText(path.join(HERE, 'assets', 'client.js'));
  compileCheck(clientJs, 'client.js');
  const mermaidJs = loadMermaid();
  const issueFields = readIssueTemplateFields();
  const data = {
    project: CONFIG.project,
    shortName: CONFIG.shortName,
    version: CONFIG.ontologyVersion,
    builtAt,
    repoUrl,
    issueTemplate: 'concept-change.yml',
    issueFields,
    palette: PALETTE,
    routes: sections.map((s) => s.route),
  };
  const html = shell(ctx, { css, sections, mermaidJs, clientJs, data, favicon: FAVICON });

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
  copyDownloads(ontoFiles, shapeFiles, exampleFiles, proposalFiles, inputs.rq);

  const size = fs.statSync(path.join(OUT, 'index.html')).size;
  const byCat = {};
  for (const w of warnings) byCat[w.cat] = (byCat[w.cat] || 0) + 1;
  log(
    `wrote ${rel(path.join(OUT, 'index.html'))} (${(size / 1048576).toFixed(2)} MB): ${sections.length} pages, ${m.classes.size} classes, ${m.properties.size} properties, ${m.schemes.size} schemes, ${diagrams.length} diagrams${invalid ? ` (${invalid} invalid)` : ''} in ${Date.now() - t0} ms`,
  );
  if (warnings.length) {
    log(`${warnings.length} warning(s): ${Object.entries(byCat).map(([k, v]) => `${k} ${v}`).join(', ')} — listed on the Status page`);
    if (!QUIET) for (const w of warnings.filter((x) => ['parse', 'render', 'diagram', 'inputs'].includes(x.cat)).slice(0, 25)) console.warn(`  [${w.cat}] ${w.msg}`);
  }
  if (STRICT && (byCat.parse || invalid || byCat.render)) process.exitCode = 1;
}

function figure(d, i) {
  return `<figure class="diagram" data-diagram="${i}">
<div class="diagram-bar"><span class="diagram-title">${esc(d.title || 'Diagram')}</span><span class="diagram-actions"><button type="button" class="btn-sm" data-enlarge aria-label="Enlarge diagram">Enlarge</button><button type="button" class="btn-sm" data-copy-src>Copy Mermaid</button></span></div>
<div class="diagram-canvas" tabindex="0"><pre class="mmd-src">${esc(d.src)}</pre><p class="diagram-loading muted">Rendering diagram…</p></div>
${d.legend ? `<figcaption class="legend-row">${d.legend}</figcaption>` : ''}
</figure>`;
}

function fontFaces() {
  // Headings: Alegreya / Alegreya SC (Huerta Tipográfica), SIL Open Font License 1.1, via @fontsource.
  const embed = (family, file) => {
    if (!fs.existsSync(file)) {
      warn(`Font file missing: ${rel(file)} — falling back to system serif`, 'assets');
      return '';
    }
    return `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${fs.readFileSync(file).toString('base64')}) format("woff2");font-weight:700;font-style:normal;font-display:block}\n`;
  };
  const fsrc = (pkg, file) => p('node_modules', '@fontsource', pkg, 'files', file);
  return embed('SMTG Display', fsrc('alegreya', 'alegreya-latin-700-normal.woff2')) + embed('SMTG Display SC', fsrc('alegreya-sc', 'alegreya-sc-latin-700-normal.woff2'));
}

function loadMermaid() {
  const f = p('node_modules', 'mermaid', 'dist', 'mermaid.min.js');
  const src = readText(f);
  if (!src) {
    warn('node_modules/mermaid/dist/mermaid.min.js not found — diagrams will show their source only', 'assets');
    return 'window.mermaid=undefined;';
  }
  // Safe inside <script>: neutralise "</script" and "<!--" (both only occur inside strings/regexes).
  const safe = src.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '\\x3C!--');
  return safe;
}

function compileCheck(code, name) {
  try {
    new vm.Script(code, { filename: name });
  } catch (e) {
    throw new Error(`${name} has a syntax error: ${e.message}`);
  }
}

function readIssueTemplateFields() {
  const f = path.join(INPUT, '.github', 'ISSUE_TEMPLATE', 'concept-change.yml');
  const src = readText(f);
  if (!src) return [];
  return [...src.matchAll(/^\s*id:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/gm)].map((x) => x[1]);
}

function copyDownloads(ontoFiles, shapeFiles, exampleFiles, proposalFiles, rq) {
  const dest = path.join(OUT, 'ontology');
  fs.rmSync(dest, { recursive: true, force: true });
  const cp = (abs, rel) => {
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(abs, to);
  };
  for (const f of ontoFiles) cp(f.abs, f.rel);
  for (const f of [...shapeFiles, ...exampleFiles, ...proposalFiles]) cp(f.abs, f.rel);
  for (const q of rq) cp(path.join(INPUT, q.rel), q.rel);
}

// small monogram favicon (no Wizards asset)
const FAVICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#f3ecdd"/><circle cx="32" cy="32" r="22" fill="none" stroke="#2b4f7e" stroke-width="5"/><circle cx="32" cy="32" r="7" fill="#27221c"/></svg>',
  );

void NS;
void readJSON;

main().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
