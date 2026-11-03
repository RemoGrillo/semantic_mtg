// Narrative pages: overview, Markdown documents, ADRs, competency questions, status, overlays
// (proposals & opt-in views), About, review-mode suggestions, 404.
import { esc, attr, fmtInt, passBadge, statusBadge, codeBlock, kindBadge } from '../lib/html.mjs';
import { kpis } from '../lib/charts.mjs';
import { moduleDiagram } from '../lib/diagrams.mjs';
import { sortedModules } from '../lib/model.mjs';
import { NS } from '../lib/rdf.mjs';
import { section, link, objectTable, cellHTML, emptyState, exprHTML, termValueHTML, suggestPanel, mdInline, routeFor } from './common.mjs';
import { moduleCards, CLASS_LEGEND } from './terms.mjs';

// ---------- overview ----------

export function overviewPage(ctx) {
  const { m, config, inputs } = ctx;
  const classes = [...m.classes.values()].filter((c) => c.local);
  const props = [...m.properties.values()].filter((p) => p.local);
  const concepts = m.concepts.size;
  const cq = inputs.cq?.results || [];
  const intro = ctx.readmeIntro;
  let h = `<header class="page-head hero"><p class="eyebrow">${esc(config.shortName || 'SMTG')} · ontology ${esc(config.ontologyVersion || '')}</p>
<h1 class="hero-title">${esc(config.project || 'Semantic Magic: The Gathering')}</h1>
${intro ? '' : '<p class="hero-sub">An identity-aware, provenance-rich ontology for <em>Magic: The Gathering</em> card data — first draft for ontology review.</p>'}</header>`;
  if (intro) h += `<div class="prose intro">${intro}</div>`;
  h += kpis([
    { label: 'Modules', value: sortedModules(m, ['module']).length },
    { label: 'Classes', value: classes.length },
    { label: 'Properties', value: props.length },
    { label: 'Vocabularies', value: m.schemes.size, note: concepts ? `${fmtInt(concepts)} concepts` : '' },
    { label: 'SHACL shapes', value: ctx.shacl.shapes.length },
    cq.length ? { label: 'Competency questions', value: `${cq.filter((r) => r.pass).length}<span class="kpi-unit"> / ${cq.length} pass</span>` } : null,
  ]);
  h += `<p class="ns-note"><span class="lbl">namespace</span> <code>${esc(config.namespaces?.ontology || NS.smtg)}</code> <span class="muted">— ${esc(
    config.namespaceStatus || '',
  )}</span></p>`;

  // big picture
  let pick = Array.isArray(config.docs?.overviewClasses) && config.docs.overviewClasses.length
    ? config.docs.overviewClasses.map((x) => m.prefixes.expand(x.includes(':') || x.startsWith('http') ? x : `smtg:${x}`)).filter((x) => m.classes.has(x))
    : classes.filter((c) => c.status !== 'proposal' && !c.deprecated).map((c) => c.iri);
  let capped = false;
  if (pick.length > 45) {
    // keep the best-connected classes for legibility
    const deg = new Map(pick.map((v) => [v, 0]));
    for (const p of m.properties.values()) {
      for (const d of [...p.domainClasses, ...p.intendedDomains]) if (deg.has(d)) deg.set(d, deg.get(d) + 1);
      for (const r of [...p.rangeClasses, ...p.intendedRanges]) if (deg.has(r)) deg.set(r, deg.get(r) + 1);
    }
    pick = [...deg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 45).map(([v]) => v);
    capped = true;
  }
  if (pick.length) {
    const mods = sortedModules(m, ['module', 'view']);
    const groups = new Map(mods.map((md) => [`g_${md.id.replace(/[^A-Za-z0-9_]/g, '_')}`, md.label]));
    const gOf = (v) => {
      const c = m.classes.get(v);
      const md = c?.module && m.modules.get(c.module);
      return md ? `g_${md.id.replace(/[^A-Za-z0-9_]/g, '_')}` : null;
    };
    try {
      const d = moduleDiagram(m, ctx.shacl, pick, { compartments: false, groupBy: { groups, of: gOf }, maxEdges: 120 });
      h += `<section class="block"><h2>The big picture</h2><p class="muted">Main classes and relations across modules${
        capped ? ' (the 45 best-connected classes; set <code>docs.overviewClasses</code> in <code>smtg.config.json</code> to choose)' : ''
      }. Click a class to open its page.</p>${ctx.diagram(d.src, { title: 'Big picture', legend: CLASS_LEGEND })}</section>`;
    } catch (e) {
      ctx.warn(`overview diagram: ${e.message}`, 'diagram');
    }
  }
  h += `<section class="block"><h2>Modules</h2>${moduleCards(ctx, sortedModules(m, ['module', 'aggregate', 'view']))}</section>`;
  h += `<section class="block"><h2>Where to start reviewing</h2><ul class="start">
<li><a href="#/page/conceptual-model">Conceptual model</a> — the distinctions the ontology insists on (Oracle card ≠ printing ≠ face ≠ artwork).</li>
<li><a href="#/page/review-questions">Review questions</a> — the open design decisions we need your opinion on.</li>
<li><a href="#/layouts">Layout matrix</a> — faces, sides and identity for every card layout.</li>
<li><a href="#/coverage">Mapping coverage</a> — every source field has a disposition (no silent loss).</li>
<li><a href="#/cq">Competency questions</a> and <a href="#/status">validation &amp; reasoning status</a>.</li>
</ul><p class="muted small">Each class and property page has a <strong>Suggest a change</strong> panel${
    '' /* review mode explained on Contributing */
  }. Run <code>npm run docs:serve</code> to collect suggestions as files.</p></section>`;
  return section('overview', 'Overview', h, { cls: 'overview' });
}

// ---------- markdown documents ----------

export function markdownPage(ctx, { route, file, title, rendered, crumbs = null, extraTop = '' }) {
  if (!rendered) {
    return section(route, title, `<header class="page-head"><h1>${esc(title)}</h1></header>${emptyState(`<code>${esc(file)}</code> has not been written yet.`)}`, { cls: 'pending' });
  }
  const h2s = rendered.headings.filter((x) => x.depth === 2);
  const toc =
    h2s.length >= 4
      ? `<nav class="toc"><span class="lbl">On this page</span> ${h2s
          .map((x) => `<a href="#/${attr(route)}/${attr(x.ids[0] || x.anchor)}">${esc(x.ids[0] || x.text)}</a>`)
          .join(' · ')}</nav>`
      : '';
  const crumb = crumbs ? `<nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>` : '';
  const hasH1 = rendered.headings.some((x) => x.depth === 1);
  const src = `<p class="src-note muted small">Source: <code>${esc(file)}</code></p>`;
  let html = rendered.html;
  if (toc && hasH1) html = html.replace(/(<\/h1>\n?)/, `$1${toc}`);
  else if (toc) html = toc + html;
  return section(route, title, `${crumb}${hasH1 ? '' : `<header class="page-head"><h1>${esc(title)}</h1></header>`}${extraTop}<div class="prose">${html}</div>${src}`, { cls: 'doc' });
}

// ---------- ADRs ----------

export function adrIndexPage(ctx, adrs) {
  let h = `<header class="page-head"><h1>Decisions (ADRs)</h1><p class="muted">Architecture decision records for high-impact modelling choices.</p></header>`;
  if (!adrs.length) h += emptyState('No ADRs yet (<code>docs/adr/*.md</code>).');
  else {
    h += `<div class="table-wrap"><table class="data"><thead><tr><th>ADR</th><th>Title</th><th>Status</th><th>Date</th></tr></thead><tbody>${adrs
      .map(
        (a) =>
          `<tr><td><a href="#/adr/${attr(a.num)}"><code>${esc(a.id)}</code></a></td><td><a href="#/adr/${attr(a.num)}">${esc(a.title)}</a></td><td>${
            a.status ? `<span class="chip adr-${esc(a.status.toLowerCase().split(/\s/)[0])}">${esc(a.status)}</span>` : ''
          }</td><td class="nowrap">${esc(a.date || '')}</td></tr>`,
      )
      .join('')}</tbody></table></div>`;
  }
  return section('adrs', 'Decisions (ADRs)', h);
}

export function adrMeta(rendered, src, file) {
  const num = (/(\d{3,4})/.exec(file.split('/').pop()) || [])[1] || file.split('/').pop().replace(/\.md$/, '');
  const id = /^\d+$/.test(num) ? `ADR-${num.padStart(4, '0')}` : num;
  const grab = (k) => rendered.meta[k] || (new RegExp(`^\\s*[-*]?\\s*\\**${k}\\**\\s*:\\s*\\**\\s*(.+?)\\s*$`, 'im').exec(src) || [])[1];
  let title = rendered.title || id;
  title = title.replace(/^ADR[- ]?\d+\s*[:—–-]\s*/i, '');
  return { num: /^\d+$/.test(num) ? num.padStart(4, '0') : num, id, title, status: (grab('status') || '').replace(/\*+/g, ''), date: (grab('date') || '').replace(/\*+/g, '') };
}

// ---------- competency questions ----------

export function parseRq(text) {
  const meta = {};
  const lines = String(text).split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!/^\s*#/.test(l)) {
      if (l.trim() === '') continue;
      break;
    }
    const kv = /^\s*#\s*([A-Za-z_-]+)\s*:\s*(.*?)\s*$/.exec(l);
    if (kv) {
      const k = kv[1].toLowerCase();
      // strip trailing "(SPARQL | OWL…)" style help from templates
      meta[k] = kv[2].replace(/\s{2,}\(.*\)\s*$/, '');
    } else if (meta.question && /^\s*#\s{2,}\S/.test(l)) meta.question += ' ' + l.replace(/^\s*#\s*/, '');
  }
  return { meta, query: text };
}

export function cqPage(ctx) {
  const { inputs, m } = ctx;
  const results = new Map((inputs.cq?.results || []).map((r) => [r.id, r]));
  const items = new Map();
  for (const q of inputs.rq) items.set(q.meta.id || q.file, { id: q.meta.id || q.file, meta: q.meta, query: q.query, file: q.rel });
  for (const [id, r] of results) if (!items.has(id)) items.set(id, { id, meta: {}, query: r.query || null, file: r.file || null });
  const list = [...items.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  let h = `<header class="page-head"><h1>Competency questions</h1><p class="lede">Questions the ontology must be able to answer, as executable SPARQL with expected results${
    ctx.hasPage('competency-questions') ? ' — see also the <a href="#/page/competency-questions">narrative description</a>' : ''
  }.</p></header>`;
  if (!list.length) return section('cq', 'Competency questions', h + emptyState('No competency questions yet (<code>queries/competency/*.rq</code>).'));
  const pass = list.filter((x) => results.get(x.id)?.pass === true).length;
  const fail = list.filter((x) => results.get(x.id)?.pass === false).length;
  h += kpis([
    { label: 'Questions', value: list.length },
    { label: 'Pass', value: pass },
    { label: 'Fail', value: fail },
    { label: 'Not run', value: list.length - pass - fail },
  ]);
  if (inputs.cq?.generatedAt) h += `<p class="muted small">Results from <code>docs/status/cq-results.json</code>, generated ${esc(inputs.cq.generatedAt)}.</p>`;
  for (const it of list) {
    const r = results.get(it.id);
    const meta = { ...it.meta };
    const title = meta.title || r?.title || it.id;
    const question = meta.question || r?.question || '';
    const kind = meta.kind || r?.kind || '';
    const expects = meta.expects || r?.expected || '';
    const rows = Array.isArray(r?.rows) ? r.rows : [];
    h += `<section class="cq block" data-anchor="${attr(it.id)}" data-anchor-id="${attr(it.id)}">
<h2><code class="cq-id">${esc(it.id)}</code> ${esc(title)} ${passBadge(r ? r.pass : undefined)}</h2>
${question ? `<p class="cq-q">${esc(question)}</p>` : ''}
<p class="cq-meta">${kind ? `<span class="meta-item"><span class="lbl">kind</span> ${esc(kind)}</span>` : ''}${
      expects ? ` <span class="meta-item"><span class="lbl">expects</span> <code>${esc(typeof expects === 'string' ? expects : JSON.stringify(expects))}</code></span>` : ''
    }${meta.modules ? ` <span class="meta-item"><span class="lbl">modules</span> ${meta.modules
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((x) => {
        const mod = [...m.modules.values()].find((md) => md.id === x);
        return mod ? `<a href="#/module/${attr(mod.id)}">${esc(mod.label)}</a>` : esc(x);
      })
      .join(', ')}</span>` : ''}${r && ('rowCount' in r || 'count' in r) ? ` <span class="meta-item"><span class="lbl">rows</span> ${fmtInt(r.rowCount ?? r.count)}</span>` : ''}</p>
${r?.error ? `<div class="callout bad"><code>${esc(r.error)}</code></div>` : ''}
${rows.length ? `<details class="more" open><summary>Result rows (${rows.length})</summary>${objectTable(m, rows.slice(0, 25), {})}${rows.length > 25 ? `<p class="muted small">${rows.length - 25} more rows.</p>` : ''}</details>` : r ? '<p class="muted small">No result rows.</p>' : ''}
${it.query ? `<details class="more"><summary>SPARQL</summary>${codeBlock(it.query, { lang: 'sparql', label: it.file || 'SPARQL', download: it.file ? `ontology/${it.file}` : '' })}</details>` : ''}
</section>`;
  }
  return section('cq', 'Competency questions', h);
}

// ---------- status ----------

export function statusPage(ctx) {
  const { inputs, m } = ctx;
  let h = `<header class="page-head"><h1>Validation &amp; reasoning status</h1><p class="lede">Machine-checked state of the draft: parsing, SHACL validation (positive and deliberately invalid fixtures), and OWL reasoning.</p></header>`;
  if (ctx.statusMd) h += `<section class="block prose">${ctx.statusMd}</section>`;
  const v = inputs.validation;
  h += '<section class="block"><h2 data-anchor="validation">Validation</h2>';
  if (v) {
    const parse = Array.isArray(v.parse) ? v.parse : [];
    const okKey = (x) => x?.ok ?? x?.pass ?? x?.valid ?? x?.conforms;
    const posRaw = v.shacl?.positive;
    const pos = Array.isArray(posRaw) ? posRaw : posRaw && typeof posRaw === 'object' ? [posRaw] : [];
    const neg = Array.isArray(v.shacl?.negative) ? v.shacl.negative : [];
    const negOk = (x) => x.pass ?? x.failedAsExpected ?? (x.conforms === false);
    const posOk = (x) => x.pass ?? x.conforms;
    h += kpis([
      parse.length ? { label: 'Files parsed', value: `${parse.filter((x) => okKey(x) !== false).length}<span class="kpi-unit"> / ${parse.length}</span>` } : null,
      pos.length ? { label: 'Examples conform', value: pos.every((x) => posOk(x) === true) ? '<span class="yes">✓ yes</span>' : '<span class="no">✕ no</span>', note: pos[0]?.files ? `${fmtInt(pos[0].files.length)} files${pos[0].triples ? `, ${fmtInt(pos[0].triples)} triples` : ''}` : '' } : null,
      neg.length ? { label: 'Invalid fixtures rejected', value: `${neg.filter((x) => negOk(x) === true).length}<span class="kpi-unit"> / ${neg.length}</span>` } : null,
      v.lint && typeof v.lint === 'object' ? { label: 'Terms linted', value: Number(v.lint.terms) || 0, note: Array.isArray(v.lint.incomplete) ? `${v.lint.incomplete.length} incomplete` : '' } : null,
    ]);
    if (v.generatedAt) h += `<p class="muted small">Generated ${esc(v.generatedAt)}.</p>`;
    if (pos.length) {
      h += `<h3>SHACL — examples (must conform)</h3>`;
      for (const p0 of pos) {
        const { files, results, ...restP } = p0;
        h += objectTable(m, [restP]);
        if (Array.isArray(results) && results.length) h += `<details class="more" open><summary>Violations (${results.length})</summary>${objectTable(m, results)}</details>`;
        if (Array.isArray(files)) h += `<details class="more"><summary>Validated files (${files.length})</summary><ul class="plain small">${files.map((f) => `<li><a href="ontology/${attr(f)}" download><code>${esc(f)}</code></a></li>`).join('')}</ul></details>`;
      }
    }
    if (neg.length) {
      h += `<h3>SHACL — deliberately invalid fixtures (must be rejected)</h3><div class="table-wrap"><table class="data"><thead><tr><th>Fixture</th><th>Why it is invalid</th><th>Result</th><th>Reported</th></tr></thead><tbody>${neg
        .map(
          (x) =>
            `<tr><td><code>${esc(x.file || '')}</code></td><td>${esc(x.why || x.expect || '')}</td><td>${passBadge(negOk(x))}</td><td class="small">${(Array.isArray(x.results) ? x.results : [])
              .slice(0, 3)
              .map((r) => esc(r.message || r.constraint || ''))
              .join('<br>')}${Array.isArray(x.results) && x.results.length > 3 ? ` <span class="muted">+${x.results.length - 3}</span>` : ''}</td></tr>`,
        )
        .join('')}</tbody></table></div>`;
    }
    if (parse.length) h += `<details class="more"><summary>Parsing (${parse.length} files)</summary>${objectTable(m, parse)}</details>`;
    const otherKeys = Object.keys(v).filter((k) => !['generatedAt', 'parse', 'shacl'].includes(k));
    for (const k of otherKeys) h += `<details class="more"><summary>${esc(k)}</summary>${Array.isArray(v[k]) ? objectTable(m, v[k]) : cellHTML(m, v[k])}</details>`;
  } else h += emptyState('No <code>docs/status/validation.json</code> yet — run <code>npm run validate</code>.');
  h += '</section>';

  const r = inputs.reasoner;
  h += '<section class="block"><h2 data-anchor="reasoner">Reasoning</h2>';
  if (r) {
    const uns = Array.isArray(r.unsatisfiable) ? r.unsatisfiable : [];
    h += kpis([
      { label: 'Reasoner', value: esc(r.reasoner || '?') },
      { label: 'Consistent', value: r.consistent === true ? '<span class="yes">✓ yes</span>' : r.consistent === false ? '<span class="no">✕ no</span>' : '–' },
      { label: 'Unsatisfiable classes', value: uns.length },
    ]);
    if (r.generatedAt) h += `<p class="muted small">Generated ${esc(r.generatedAt)}.</p>`;
    if (uns.length) h += `<div class="callout bad"><strong>Unsatisfiable:</strong> ${uns.map((u) => (typeof u === 'string' ? link(m, m.prefixes.expand(u)) : esc(JSON.stringify(u)))).join(', ')}</div>`;
    const extra = Object.keys(r).filter((k) => !['generatedAt', 'reasoner', 'consistent', 'unsatisfiable', 'log'].includes(k));
    if ('aboxConsistent' in r) h += `<p><span class="lbl">ABox (examples) consistent</span> ${r.aboxConsistent === true ? '<span class="yes">✓ yes</span>' : r.aboxConsistent === false ? '<span class="no">✕ no</span>' : '–'}</p>`;
    for (const k of extra.filter((x) => x !== 'aboxConsistent')) h += `<details class="more"${k === 'negative' ? ' open' : ''}><summary>${esc(k)}${Array.isArray(r[k]) ? ` (${r[k].length})` : ''}</summary>${Array.isArray(r[k]) ? objectTable(m, r[k]) : cellHTML(m, r[k])}</details>`;
    if (r.log) h += `<details class="more"><summary>Reasoner log</summary><pre class="log">${esc(typeof r.log === 'string' ? r.log : JSON.stringify(r.log, null, 2))}</pre></details>`;
  } else h += emptyState('No <code>docs/status/reasoner.json</code> yet — run <code>npm run reason</code>.');
  h += '</section>';

  // documentation build report
  const W = ctx.warnings;
  h += `<section class="block"><h2 data-anchor="docs-build">Documentation build report</h2><p class="muted small">Issues the docs generator noticed while reading the sources (built ${esc(ctx.builtAt)}).</p>`;
  if (!W.length) h += '<p><span class="badge ok"><span aria-hidden="true">✓</span> no issues</span></p>';
  else {
    const byCat = new Map();
    for (const w of W) {
      if (!byCat.has(w.cat)) byCat.set(w.cat, []);
      byCat.get(w.cat).push(w.msg);
    }
    for (const [cat, msgs] of byCat) {
      h += `<details class="more"${cat === 'parse' ? ' open' : ''}><summary>${esc(cat)} (${msgs.length})</summary><ul class="warn-list">${msgs.slice(0, 300).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
    }
  }
  h += '</section>';
  return section('status', 'Validation & reasoning status', h);
}

// ---------- overlays: proposals & views ----------

export function overlayPage(ctx, ov) {
  const { m } = ctx;
  const om = ov.model;
  const hdr = ov.header;
  const isProp = ov.kind === 'proposal';
  const route = `${ov.kind}/${ov.id}`;
  let h = `<header class="page-head"><nav class="crumbs" aria-label="Breadcrumb"><a href="${isProp ? '#/proposals' : '#/modules'}">${isProp ? 'Proposals' : 'Modules'}</a><span class="sep" aria-hidden="true">/</span><span>${esc(
    ov.label,
  )}</span></nav><h1>${esc(ov.label)}</h1><div class="term-meta">${isProp ? statusBadge('proposal') : '<span class="kind k-module">opt-in view</span>'}${
    hdr?.proposalKind ? ` <span class="meta-item"><span class="lbl">kind</span> ${esc(hdr.proposalKind)}</span>` : ''
  }${hdr?.proposalOf?.length ? ` <span class="meta-item"><span class="lbl">${hdr.proposalKind === 'extend' ? 'extends' : hdr.proposalKind === 'alternative' ? 'alternative to' : 'replaces'}</span> ${hdr.proposalOf.map((x) => link(m, x)).join(', ')}</span>` : ''}${
    hdr?.creators?.length ? ` <span class="meta-item"><span class="lbl">by</span> ${hdr.creators.map(esc).join(', ')}</span>` : ''
  }</div>${hdr ? `<div class="iri-line"><code class="iri">${esc(hdr.iri)}</code><button type="button" class="btn-sm" data-copy="${attr(hdr.iri)}">Copy IRI</button></div>` : ''}</header>`;
  if (hdr?.description) h += `<div class="lede prose">${ctx.markdownInline(hdr.description)}</div>`;
  if (!isProp) h += '<p class="muted">Opt-in interpretation view: not imported by the aggregate ontology. Its axioms are shown here and are <strong>not</strong> merged into the core term pages.</p>';

  // diff vs core
  const added = ov.terms.filter((t) => !m.terms.has(t.iri));
  const redefined = ov.terms.filter((t) => m.terms.has(t.iri));
  const replaced = [...new Set(ov.terms.flatMap((t) => t.replaces || []))];
  h += kpis([
    { label: 'Added terms', value: added.length },
    { label: 'Redefined core terms', value: redefined.length },
    { label: 'Replaced / removed', value: replaced.length },
  ]);
  if (replaced.length) h += `<p><span class="lbl">replaces</span> ${replaced.map((x) => `<span class="removed">${link(m, x)}</span>`).join(', ')}</p>`;

  const classes = ov.terms.filter((t) => t.kind === 'class').map((t) => t.iri);
  if (classes.length) {
    try {
      const d = moduleDiagram(om, ctx.shacl, classes, { compartments: true, highlight: new Set(added.filter((t) => t.kind === 'class').map((t) => t.iri)) });
      h += `<section class="block"><h2>Diagram</h2><p class="muted small">Highlighted: classes added by this ${isProp ? 'proposal' : 'view'}; faded: core classes it connects to.</p>${ctx.diagram(d.src, { title: ov.label, legend: CLASS_LEGEND })}</section>`;
    } catch (e) {
      ctx.warn(`overlay diagram ${ov.id}: ${e.message}`, 'diagram');
    }
  }
  h += `<section class="block"><h2>Terms</h2>`;
  for (const t of ov.terms) {
    const core = m.terms.get(t.iri);
    const diff = core ? diffTriples(ctx, ov, t.iri) : '';
    h += `<article class="term-card" data-anchor="${attr(t.key)}" id="${attr(route.replace(/\//g, '--'))}--${attr(t.key)}">
<h3>${esc(t.label)} <span class="term-card-meta">${kindBadge(t.kind)} ${statusBadge(t.status || (isProp ? 'proposal' : null))} ${
      core ? `<span class="chip">redefines ${link(m, t.iri, { text: 'core term' })}</span>` : '<span class="chip added">added</span>'
    }</span></h3>
<p class="iri-line"><code class="iri">${esc(t.iri)}</code></p>
${t.definition ? `<p>${mdInline(ctx.symbols.inline(t.definition))}</p>` : ''}
${t.scopeNotes?.length ? `<p class="muted"><strong>Rationale:</strong> ${t.scopeNotes.map((x) => mdInline(esc(x))).join(' ')}</p>` : ''}
${overlayAxioms(om, t)}
${t.replaces?.length ? `<p><span class="lbl">replaces</span> ${t.replaces.map((x) => `<span class="removed">${link(m, x)}</span>`).join(', ')}</p>` : ''}
${diff}
</article>`;
  }
  if (!ov.terms.length) h += '<p class="muted">No terms found.</p>';
  h += '</section>';
  for (const f of ov.files) {
    if (f.error) h += `<div class="callout bad"><strong>${esc(f.rel)}:</strong> <code>${esc(f.error)}</code></div>`;
    if (f.text != null) {
      h += `<section class="block"><h2>Turtle source</h2><details class="source"><summary>Show <code>${esc(f.rel)}</code></summary>${codeBlock(f.text, {
        lang: 'turtle',
        label: f.rel,
        download: `ontology/${f.rel}`,
        maxHeight: true,
      })}</details></section>`;
    }
  }
  if (hdr) h += suggestPanel({ iri: hdr.iri, label: ov.label });
  return section(route, ov.label, h);
}

function overlayAxioms(om, t) {
  const rows = [];
  if (t.kind === 'class') {
    const sup = [...(t.superClasses || []).map((x) => link(om, x)), ...(t.superExpressions || []).map((e) => exprHTML(om, e))];
    if (sup.length) rows.push(['subclass of', sup.join(', ')]);
    if (t.equivalents?.length) rows.push(['equivalent to', t.equivalents.map((e) => exprHTML(om, e)).join(', ')]);
    if (t.disjoint?.length) rows.push(['disjoint with', t.disjoint.map((x) => link(om, x)).join(', ')]);
  } else if (t.domains) {
    if (t.domains.length) rows.push(['domain', t.domains.map((e) => exprHTML(om, e)).join(', ')]);
    if (t.ranges.length) rows.push(['range', t.ranges.map((e) => exprHTML(om, e)).join(', ')]);
    if (t.intendedDomains.length) rows.push(['intended domain', t.intendedDomains.map((x) => link(om, x)).join(', ')]);
    if (t.intendedRanges.length) rows.push(['intended range', t.intendedRanges.map((x) => link(om, x)).join(', ')]);
    if (t.characteristics.length) rows.push(['characteristics', t.characteristics.map(esc).join(', ')]);
    if (t.superProperties.length) rows.push(['subproperty of', t.superProperties.map((x) => link(om, x)).join(', ')]);
  }
  if (!rows.length) return '';
  return `<table class="axioms compact"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;
}

function diffTriples(ctx, ov, v) {
  const { m } = ctx;
  const key = (q) => `${q.predicate.value} ${q.object.termType === 'BlankNode' ? '_:' : q.object.termType + ':' + q.object.value + '@' + (q.object.language || '')}`;
  const coreQ = m.graph.quads(v, null, null);
  const ovQ = ov.graph.quads(v, null, null);
  const coreK = new Set(coreQ.map(key));
  const ovK = new Set(ovQ.map(key));
  const add = ovQ.filter((q) => !coreK.has(key(q)));
  // statements the overlay would replace: same predicate redefined with different values
  const preds = new Set(add.map((q) => q.predicate.value));
  const rem = coreQ.filter((q) => preds.has(q.predicate.value) && !ovK.has(key(q)));
  if (!add.length && !rem.length) return '<p class="muted small">No differences from the core definition.</p>';
  const row = (q, sign) => `<tr class="${sign === '+' ? 'add' : 'del'}"><td class="sign">${sign}</td><td>${link(m, q.predicate.value)}</td><td>${q.object.termType === 'BlankNode' ? '<span class="muted">(class expression)</span>' : termValueHTML(m, q.object)}</td></tr>`;
  return `<details class="more" open><summary>Difference from core</summary><div class="table-wrap"><table class="data diff"><tbody>${rem.map((q) => row(q, '−')).join('')}${add
    .map((q) => row(q, '+'))
    .join('')}</tbody></table></div></details>`;
}

export function proposalsIndex(ctx, overlays) {
  const list = overlays.filter((o) => o.kind === 'proposal');
  let h = `<header class="page-head"><h1>Proposals</h1><p class="lede">Alternative or extension modules proposed by reviewers (<code>proposals/&lt;name&gt;/*.ttl</code>). They are never merged into the core pages; each is shown with its difference from the core.</p></header>`;
  if (!list.length) h += emptyState('No proposal modules yet. Proposals are ordinary Turtle files under <code>proposals/&lt;name&gt;/</code> with an <code>owl:Ontology</code> header (<code>smtg:proposalOf</code>, <code>smtg:proposalKind</code>, <code>dcterms:creator</code>); rebuild the docs and they appear here with their difference from the core. See <a href="#/page/contributing">Contributing</a>.');
  else {
    h += `<div class="cards">${list
      .map(
        (o) =>
          `<a class="card" href="#/proposal/${attr(o.id)}"><span class="card-title">${esc(o.label)}</span><span class="card-sub">${statusBadge('proposal')}${
            o.header?.proposalKind ? ` <span class="kind">${esc(o.header.proposalKind)}</span>` : ''
          }</span><span class="card-body">${esc((o.header?.description || '').slice(0, 160))}</span><span class="card-foot muted">${o.terms.length} terms${
            o.header?.creators?.length ? ' · ' + esc(o.header.creators.join(', ')) : ''
          }</span></a>`,
      )
      .join('')}</div>`;
  }
  if (ctx.proposalsReadme) h += `<section class="block prose"><h2>How to propose a change</h2>${ctx.proposalsReadme}<p class="src-note muted small">Source: <code>proposals/README.md</code></p></section>`;
  return section('proposals', 'Proposals', h);
}

// ---------- about ----------

export function aboutPage(ctx) {
  const { config } = ctx;
  const h = `<header class="page-head"><h1>About</h1></header>
<div class="prose">
<h2>The project</h2>
<p><strong>${esc(config.project || 'Semantic Magic: The Gathering')}</strong> (${esc(config.shortName || 'SMTG')}) is an unofficial research and fan project: an ontology and knowledge graph that keeps apart what card data usually flattens — the abstract Oracle card, its printings, faces, artworks and texts, community tags, combos and decks — and records where every statement comes from. This site documents the first ontology draft (${esc(
    config.ontologyVersion || '',
  )}) for review by ontologists.</p>

<h2>Wizards of the Coast Fan Content Policy</h2>
<blockquote class="legal"><p>Semantic Magic: The Gathering is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.</p></blockquote>
<p>Magic: The Gathering, the mana symbols, card names, card text, set symbols and the Beleren typeface are property and/or trademarks of Wizards of the Coast LLC. See the <a class="ext" href="https://company.wizards.com/en/legal/fancontentpolicy" rel="noopener" target="_blank">Wizards of the Coast Fan Content Policy</a>.</p>

<h2>Data sources and attribution</h2>
<ul>
<li>Card data from <a class="ext" href="https://scryfall.com" rel="noopener" target="_blank">Scryfall</a> (bulk data and API).</li>
<li>Community tags from Tagger via Scryfall (<a class="ext" href="https://tagger.scryfall.com" rel="noopener" target="_blank">tagger.scryfall.com</a>).</li>
<li>Combo data from <a class="ext" href="https://commanderspellbook.com" rel="noopener" target="_blank">Commander Spellbook</a>.</li>
</ul>
<p>The project is not affiliated with, endorsed by or sponsored by Scryfall, Tagger or Commander Spellbook. The mana and card symbols shown on this site are Scryfall's official SVG symbols, rasterized to PNG without modification.</p>

<h2>Licensing (proposal)</h2>
<ul>
<li>Code: MIT.</li>
<li>Ontology and documentation: CC BY 4.0.</li>
<li>Source data and Wizards of the Coast assets are <strong>not</strong> redistributed in the repository; they are fetched at build time.</li>
</ul>
<p class="muted">This licensing scheme is a proposal pending review${ctx.adrLink ? ` — see ${ctx.adrLink}` : ' — see the ADRs'}.</p>

<h2>This site</h2>
<p>Generated from the Turtle sources by <code>tools/docs/build.mjs</code> (built ${esc(ctx.builtAt)}). It is a single self-contained HTML file that works offline. Fonts, symbols and diagrams are embedded; diagrams are rendered with Mermaid.</p>
</div>`;
  return section('about', 'About', h);
}

// ---------- review-mode suggestions ----------

export function suggestionsPage() {
  const h = `<header class="page-head"><h1>Suggestions</h1><p class="lede">All suggestions collected in review mode (files in <code>review/suggestions/</code>).</p></header>
<div data-all-suggestions><p class="muted" data-static-only>Suggestions are collected only in review mode: run <code>npm run docs:serve</code> and open the printed URL.</p></div>`;
  return section('suggestions', 'Suggestions', h);
}

export function notFoundPage() {
  return section('404', 'Not found', `<header class="page-head"><h1>Page not found</h1></header><p>There is no page for <code data-missing-route></code>. It may have been renamed in the ontology. Try the filter in the sidebar, or go to the <a href="#/overview">overview</a>.</p>`);
}

export { routeFor };
