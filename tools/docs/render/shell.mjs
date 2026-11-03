// Page shell: <head>, sidebar index, main sections, overlay, scripts.
import { esc, attr, jsonForScript } from '../lib/html.mjs';
import { sortedModules } from '../lib/model.mjs';

function navLink(route, label, { search = '', mark = '', pending = false, cls = '' } = {}) {
  // label first, markers (kind, status) right-aligned after it, so markers never shift the text edge
  const classes = [pending ? 'pending' : '', cls].filter(Boolean).join(' ');
  return `<li><a href="#/${attr(route)}" data-nav="${attr(route)}" data-k="${attr(`${label} ${search}`.toLowerCase())}"${classes ? ` class="${classes}"` : ''}${pending ? ' title="not written yet"' : ''}><span class="nav-label">${esc(
    label,
  )}</span>${mark ? `<span class="nav-meta">${mark}</span>` : ''}</a></li>`;
}

function statusMark(t) {
  if (t.deprecated) return '<span class="nav-st st-deprecated" title="deprecated" aria-label="deprecated"></span>';
  if (t.status === 'proposal') return '<span class="nav-st st-proposal" title="proposal" aria-label="proposal"></span>';
  if (t.status === 'unstable') return '<span class="nav-st st-unstable" title="unstable" aria-label="unstable"></span>';
  return '';
}

function grouped(m, terms, routeOf) {
  const byMod = new Map();
  for (const t of terms) {
    const k = t.module || '';
    if (!byMod.has(k)) byMod.set(k, []);
    byMod.get(k).push(t);
  }
  const keys = [...byMod.keys()].sort((a, b) => (m.modules.get(a)?.order ?? 999) - (m.modules.get(b)?.order ?? 999) || a.localeCompare(b));
  let h = '';
  for (const k of keys) {
    const mod = m.modules.get(k);
    h += `<li class="nav-sub" aria-hidden="true">${esc(mod ? mod.label.replace(/^SMTG(-O)?\s+/, '') : 'Other')}</li>`;
    for (const t of byMod.get(k).sort((a, b) => a.label.localeCompare(b.label, 'en'))) {
      const kindMark =
        t.kind === 'object' ? '<span class="pk" title="object property">o</span>' : t.kind === 'datatype' ? '<span class="pk" title="datatype property">d</span>' : t.kind === 'annotation' ? '<span class="pk" title="annotation property">a</span>' : '';
      h += navLink(routeOf(t), t.label, { search: `${t.curie} ${t.iri}`, mark: kindMark + (statusMark(t) || '<span class="nav-st st-none" aria-hidden="true"></span>') });
    }
  }
  return h;
}

export function sidebar(ctx) {
  const { m, config } = ctx;
  const mods = sortedModules(m, ['aggregate', 'module']);
  const views = ctx.overlays.filter((o) => o.kind === 'view');
  const props = ctx.overlays.filter((o) => o.kind === 'proposal');
  const page = (slug, label) => navLink(`page/${slug}`, label, { pending: !ctx.hasPage(slug) });
  const classes = [...m.classes.values()].filter((c) => c.local);
  const properties = [...m.properties.values()].filter((p) => p.local);
  const individuals = [...m.individuals.values()].filter((i) => i.local);
  const schemes = [...m.schemes.values()].sort((a, b) => a.label.localeCompare(b.label));
  const group = (title, body, { open = false, count = null, route = null, allLabel = null } = {}) =>
    `<details class="nav-group"${open ? ' open' : ''}><summary><span class="g-title">${esc(title)}</span>${count != null ? `<span class="g-count">${count}</span>` : ''}<span class="g-chev" aria-hidden="true"></span></summary><ul class="nav-children">${
      route ? navLink(route, allLabel || `All ${title.toLowerCase()}`, { cls: 'nav-all' }) : ''
    }${body}</ul></details>`;
  const section = (title, inner) => `<section class="nav-sec"><h2 class="nav-sec-title">${esc(title)}</h2>${inner}</section>`;
  const list = (...items) => `<ul class="nav-top">${items.join('')}</ul>`;
  const moduleLinks = mods
    .map((md) =>
      md.kind === 'aggregate'
        ? navLink(`module/${md.id}`, 'Aggregate (smtg.ttl)', { search: `${md.iri} ${md.label}`, mark: '<span class="pk" title="aggregate of all modules">∑</span>' })
        : navLink(`module/${md.id}`, md.label.replace(/^SMTG(-O)?\s+/, ''), { search: md.iri }),
    )
    .join('');

  let h = `<nav id="sidebar" class="sidebar" aria-label="Documentation index">
<div class="brand"><a href="#/overview" class="brand-title">${esc(config.project || 'Semantic MTG')}<span class="brand-the">${esc(config.subtitle || '')}</span></a>
<div class="brand-sub">${esc(config.ontologyName || 'SMTG-O')} ontology · ${esc(config.ontologyVersion || '')}</div></div>
<div class="side-filter"><label for="nav-filter" class="sr-only">Filter the index</label><input id="nav-filter" type="search" placeholder="Filter the index…" autocomplete="off" spellcheck="false"><kbd class="kbd-hint" aria-hidden="true">/</kbd></div>
<p class="review-flag" data-review-only hidden><span aria-hidden="true">●</span> Review mode — suggestions are saved</p>
<div class="nav-scroll">
${section('Introduction', list(navLink('overview', 'Overview'), page('conceptual-model', 'Conceptual model')))}
${section(
  'Ontology',
  group('Modules', moduleLinks + (views.length ? `<li class="nav-sub" aria-hidden="true">Opt-in views</li>${views.map((v) => navLink(`view/${v.id}`, v.label.replace(/^View:\s*/, '').replace(/\s*\(opt-in\)$/, ''), { search: v.label })).join('')}` : ''), { open: true, count: mods.length, route: 'modules' }) +
    group('Classes', grouped(m, classes, (t) => `class/${t.key}`), { open: true, count: classes.length, route: 'classes' }) +
    group('Properties', grouped(m, properties, (t) => `property/${t.key}`), { count: properties.length, route: 'properties' }) +
    (individuals.length ? group('Individuals', grouped(m, individuals, (t) => `individual/${t.key}`), { count: individuals.length }) : '') +
    group('Vocabularies', schemes.map((s) => navLink(`vocab/${s.key}`, s.label, { search: `${s.curie} ${s.concepts.length}` })).join(''), { count: schemes.length, route: 'vocabularies' }) +
    list(navLink('layouts', 'Layout matrix')),
)}
${section('Evidence', list(navLink('audit', 'Source audit'), navLink('coverage', 'Mapping coverage'), navLink('cq', 'Competency questions'), navLink('status', 'Validation & reasoning')))}
${section(
  'Review',
  list(page('review-questions', 'Review questions'), page('anti-patterns', 'Anti-patterns'), page('epistemic-layer-dec', 'Epistemic layer & DEC')) +
    group('Decisions (ADRs)', ctx.adrs.map((a) => navLink(`adr/${a.num}`, `${a.id.replace(/^ADR-/, '')} · ${a.title}`, { search: `${a.id} ${a.status}` })).join(''), { count: ctx.adrs.length, route: 'adrs', allLabel: 'All decisions' }) +
    group('Proposals', props.map((o) => navLink(`proposal/${o.id}`, o.label)).join(''), { count: props.length, route: 'proposals' }) +
    list(navLink('suggestions', 'All suggestions', { cls: 'review-nav' })),
)}
${section(
  'Project',
  list(page('contributing', 'Contributing'), page('disclaimer', 'Disclaimer & credits')) +
    (ctx.extraPages.length ? group('More documents', ctx.extraPages.map((x) => navLink(`page/${x.slug}`, x.title)).join(''), { count: ctx.extraPages.length }) : '') +
    list(navLink('about', 'About')),
)}
</div>
</nav>`;
  return h;
}

export function shell(ctx, { css, sections, mermaidJs, clientJs, data, favicon }) {
  const { config } = ctx;
  const title = `${config.project || 'Semantic MTG'} — ${config.ontologyName || 'SMTG-O'}`;
  const body = sections
    .map(
      (s, i) =>
        `<section class="route" data-route="${attr(s.route)}" id="/${attr(s.route)}" data-title="${attr(s.title)}"${i === 0 ? '' : ' hidden'}>\n${s.html}\n</section>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="Documentation of the ${esc(config.project || 'SMTG')} ontology draft (unofficial fan/research project).">
<meta name="generator" content="SMTG tools/docs/build.mjs">
<link rel="icon" href="${attr(favicon)}">
<style>
${css}
</style>
<noscript><style>main > section.route[hidden]{display:block!important}.diagram-canvas .mmd-src{display:block}</style></noscript>
</head>
<body>
<a class="skip-link" href="#main" data-skip>Skip to content</a>
<header class="topbar"><button type="button" class="menu-btn" aria-controls="sidebar" aria-expanded="false"><span aria-hidden="true">☰</span> Index</button><a class="topbar-title" href="#/overview">${esc(config.project || 'Semantic MTG')}</a></header>
<div class="layout">
${sidebar(ctx)}
<main id="main" tabindex="-1">
${body}
<footer class="site-foot"><p>${esc(config.project || 'Semantic MTG')} is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC. Magic: The Gathering, card names, text and symbols belong to Wizards of the Coast; we own none of it. Card data: Scryfall; tags: Tagger; combos: Commander Spellbook — not affiliated. <a href="#/page/disclaimer">Disclaimer &amp; credits</a> · <a href="#/about">About</a></p></footer>
</main>
</div>
<div id="overlay" class="overlay" hidden role="dialog" aria-modal="true" aria-labelledby="overlay-title">
<div class="overlay-bar"><span id="overlay-title" class="overlay-title"></span><span><button type="button" class="btn-sm" data-zoom="-1" aria-label="Zoom out">−</button><button type="button" class="btn-sm" data-zoom="0">Fit</button><button type="button" class="btn-sm" data-zoom="1" aria-label="Zoom in">+</button><button type="button" class="btn-sm" data-close>Close</button></span></div>
<div class="overlay-body" tabindex="0"></div>
</div>
<div id="tip" class="tip" role="tooltip" hidden></div>
<script type="application/json" id="smtg-data">${jsonForScript(data)}</script>
<script>
${mermaidJs}
</script>
<script>
${clientJs}
</script>
</body>
</html>
`;
}
