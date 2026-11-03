// Shared rendering helpers: links to terms, Manchester-style class expressions, term headers,
// annotation blocks, the "Suggest a change" panel and generic JSON tables.
import { esc, attr, statusBadge, kindBadge } from '../lib/html.mjs';
import { NS, localName } from '../lib/rdf.mjs';
import { replaceCardRefs } from '../lib/cardrefs.mjs';

/** Route (hash) for an IRI known to the model, or null. */
export function routeFor(m, v) {
  const t = m.terms.get(v);
  if (t?.overlayRoute) return t.overlayRoute;
  if (t && t.local !== false) {
    switch (t.kind) {
      case 'class':
        return `#/class/${t.key}`;
      case 'object':
      case 'datatype':
      case 'annotation':
      case 'property':
        return `#/property/${t.key}`;
      case 'individual':
        return `#/individual/${t.key}`;
      case 'scheme':
        return `#/vocab/${t.key}`;
      case 'concept': {
        const sc = m.schemes.get(t.schemes[0]);
        return sc ? `#/vocab/${sc.key}/${t.anchor}` : null;
      }
    }
  }
  const mod = m.modules.get(v);
  if (mod) return `#/module/${mod.id}`;
  return null;
}

export function shortName(m, v) {
  if (v.startsWith(NS.smtg)) return v.slice(NS.smtg.length);
  return m.prefixes.curie(v) || v;
}

/** <a> for any IRI: internal route when known, external link otherwise. */
export function link(m, v, { text = null, title = true } = {}) {
  if (!v) return '';
  const r = routeFor(m, v);
  const t = m.terms.get(v);
  const label = text ?? (t && t.kind !== 'concept' ? shortName(m, v) : t?.kind === 'concept' ? t.notations?.[0] || t.label : shortName(m, v));
  const tt = title ? ` title="${attr(t ? `${t.label} — ${v}` : v)}"` : '';
  if (r) {
    const dep = t?.deprecated ? ' deprecated' : '';
    return `<a class="term${dep}" href="${attr(r)}"${tt}>${esc(label)}</a>`;
  }
  if (/^https?:/.test(v)) return `<a class="term ext" href="${attr(v)}" rel="noopener" target="_blank"${tt}>${esc(label)}</a>`;
  return `<code>${esc(label)}</code>`;
}

export function termValueHTML(m, term) {
  if (!term) return '';
  if (term.termType === 'NamedNode') return link(m, term.value);
  if (term.termType === 'BlankNode') return '<span class="muted">[blank node]</span>';
  const dt = term.datatype?.value;
  const lang = term.language ? `<span class="lang">@${esc(term.language)}</span>` : '';
  const isPlain = !dt || dt === NS.xsd + 'string' || dt === NS.rdf + 'langString';
  if (!isPlain && /(integer|decimal|double|float|boolean|Integer)$/.test(dt)) return `<code>${esc(term.value)}</code>`;
  return `<span class="lit">“${esc(term.value)}”</span>${lang}${isPlain ? '' : `<span class="dt">^^${esc(m.prefixes.shorten(dt))}</span>`}`;
}

// ---------- Manchester-style rendering ----------

const KW = (s) => `<span class="mkw">${s}</span>`;

export function propExprHTML(m, pe) {
  if (!pe) return '?';
  return pe.type === 'inverse' ? `${KW('inverse')} (${link(m, pe.iri)})` : link(m, pe.iri);
}

export function exprHTML(m, e, depth = 0) {
  if (!e) return '<span class="muted">?</span>';
  const paren = (s) => (depth > 0 ? `(${s})` : s);
  switch (e.type) {
    case 'named':
      return link(m, e.iri);
    case 'some':
      return paren(`${propExprHTML(m, e.prop)} ${KW('some')} ${exprHTML(m, e.filler, depth + 1)}`);
    case 'only':
      return paren(`${propExprHTML(m, e.prop)} ${KW('only')} ${exprHTML(m, e.filler, depth + 1)}`);
    case 'value': {
      const v = e.value.termType === 'NamedNode' ? link(m, e.value.value) : termValueHTML(m, e.value);
      return paren(`${propExprHTML(m, e.prop)} ${KW('value')} ${v}`);
    }
    case 'self':
      return paren(`${propExprHTML(m, e.prop)} ${KW('Self')}`);
    case 'min':
    case 'max':
    case 'exactly':
      return paren(`${propExprHTML(m, e.prop)} ${KW(e.type)} ${e.n}${e.filler ? ' ' + exprHTML(m, e.filler, depth + 1) : ''}`);
    case 'and':
      return paren(e.ops.map((o) => exprHTML(m, o, depth + 1)).join(` ${KW('and')} `));
    case 'or':
      return paren(e.ops.map((o) => exprHTML(m, o, depth + 1)).join(` ${KW('or')} `));
    case 'not':
      return `${KW('not')} ${exprHTML(m, e.op, depth + 1)}`;
    case 'oneOf':
      return `{ ${e.items.map((t) => termValueHTML(m, t)).join(', ')} }`;
    case 'datatype':
      return `${link(m, e.base)}[${e.facets.map((f) => `${esc(localName(f.facet))} ${esc(JSON.stringify(f.value.value))}`).join(', ')}]`;
    default:
      return '<span class="muted" title="unsupported or incomplete class expression">(anonymous expression)</span>';
  }
}

// ---------- page pieces ----------

export function breadcrumbs(items) {
  return `<nav class="crumbs" aria-label="Breadcrumb">${items
    .map((i) => (i.href ? `<a href="${attr(i.href)}">${esc(i.label)}</a>` : `<span>${esc(i.label)}</span>`))
    .join('<span class="sep" aria-hidden="true">/</span>')}</nav>`;
}

export function iriLine(v) {
  return `<div class="iri-line"><code class="iri">${esc(v)}</code><button type="button" class="btn-sm" data-copy="${attr(v)}" aria-label="Copy IRI">Copy IRI</button></div>`;
}

export function termHeader(ctx, t, { crumbs = [], extra = '', hideEmptyStatus = false } = {}) {
  const { m } = ctx;
  const mod = t.module && m.modules.get(t.module);
  const modLink = mod ? `<a href="#/module/${attr(mod.id)}">${esc(mod.label)}</a>` : t.module ? `<code>${esc(m.prefixes.shorten(t.module))}</code>` : '<span class="muted">no module</span>';
  return `<header class="page-head">
${breadcrumbs(crumbs)}
<h1 class="term-title${t.deprecated ? ' deprecated' : ''}">${esc(t.label)}</h1>
<div class="term-meta">${kindBadge(t.kind)} ${hideEmptyStatus && !t.status ? '' : statusBadge(t.status)} <span class="meta-item"><span class="lbl">module</span> ${modLink}</span> <span class="meta-item"><span class="lbl">name</span> <code>${esc(
    t.curie,
  )}</code></span>${extra}</div>
${iriLine(t.iri)}
</header>`;
}

/** Definition, comments, rationale, examples. */
export function annotationsBlock(ctx, t) {
  const S = ctx.symbols;
  const txt = (s) => mdInline(S.inline(s));
  let h = '';
  h += t.definition
    ? `<p class="definition">${txt(t.definition)}</p>`
    : `<p class="definition missing">No <code>skos:definition</code> yet.</p>`;
  for (const c of t.comments || []) h += `<p class="comment">${txt(c)}</p>`;
  if (t.scopeNotes?.length) {
    h += `<section class="note rationale"><h3 class="note-title">Modelling rationale</h3>${t.scopeNotes.map((s) => `<p>${txt(s)}</p>`).join('')}</section>`;
  }
  if (t.examples?.length) {
    h += `<section class="note example"><h3 class="note-title">Example</h3>${t.examples.map((s) => `<p>${txt(s)}</p>`).join('')}</section>`;
  }
  return h;
}

/** Tiny inline markdown for annotation text: `code`, **bold**, *em*, URLs. Input must be escaped HTML. */
export function mdInline(html) {
  const out = String(html)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:])/g, '$1<a href="$2" class="ext" rel="noopener" target="_blank">$2</a>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>');
  // card references [[…]], outside <code> (so syntax examples stay literal)
  return out
    .split(/(<code>[\s\S]*?<\/code>)/)
    .map((part, i) => (i % 2 ? part : replaceCardRefs(part)))
    .join('');
}

export function refsBlock(ctx, t) {
  const rq = t.reviewQuestions || [];
  const ap = t.antiPatterns || [];
  if (!rq.length && !ap.length && !(t.seeAlso || []).length) return '';
  const idl = (id) => {
    const r = ctx.idHref(id);
    return `<a class="ref-id${r.missing ? ' missing' : ''}" href="${attr(r.href)}"${r.missing ? ` title="${attr(r.missing)}"` : ''}>${esc(id)}</a>${
      r.title ? ` <span class="muted">${esc(r.title)}</span>` : ''
    }`;
  };
  let h = '<div class="refs">';
  if (rq.length) h += `<div><h3 class="lbl-h">Open review questions</h3><ul class="plain">${rq.map((x) => `<li>${idl(x)}</li>`).join('')}</ul></div>`;
  if (ap.length) h += `<div><h3 class="lbl-h">Anti-patterns avoided</h3><ul class="plain">${ap.map((x) => `<li>${idl(x)}</li>`).join('')}</ul></div>`;
  if (t.seeAlso?.length) h += `<div><h3 class="lbl-h">See also</h3><ul class="plain">${t.seeAlso.map((x) => `<li>${link(ctx.m, x)}</li>`).join('')}</ul></div>`;
  return h + '</div>';
}

export function otherAnnotationsBlock(ctx, t) {
  if (!t.other?.length) return '';
  const rows = t.other
    .map((a) => `<tr><td>${link(ctx.m, a.p)}</td><td>${termValueHTML(ctx.m, a.o)}</td></tr>`)
    .join('');
  return `<details class="more"><summary>Other annotations (${t.other.length})</summary><div class="table-wrap"><table class="data compact"><thead><tr><th>Property</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

export function sourceFieldsBlock(ctx, t) {
  const fromAnn = (t.sourceFields || []).map((f) => ({ path: f, via: 'smtg:sourceField' }));
  const fromMap = (ctx.mappingByTerm.get(t.iri) || []).map((e) => ({ path: `${e.source}:${e.path}`, via: e.file, disposition: e.disposition, note: e.note }));
  const all = new Map();
  for (const f of [...fromAnn, ...fromMap]) {
    const k = f.path.replace(/^(scryfall|tagger|spellbook):/, (s) => s);
    const prev = all.get(k);
    all.set(k, prev ? { ...prev, ...f, via: [prev.via, f.via].filter(Boolean).join(' + ') } : f);
  }
  if (!all.size) return '';
  const rows = [...all.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(
      (f) =>
        `<tr><td><code>${esc(f.path)}</code></td><td>${f.disposition ? dispositionChip(f.disposition) : ''}</td><td class="muted">${esc(f.via)}</td><td>${esc(f.note || '')}</td></tr>`,
    )
    .join('');
  return `<section class="block"><h2>Source fields mapped</h2><div class="table-wrap"><table class="data"><thead><tr><th>Source path</th><th>Disposition</th><th>Declared in</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

export const DISPOSITIONS = {
  mapped: { label: 'mapped', color: '#2b5d9e' },
  raw: { label: 'raw', color: '#c4742a' },
  derived: { label: 'derived', color: '#1f8f74' },
  deferred: { label: 'deferred', color: '#8f4fa0' },
  excluded: { label: 'excluded', color: '#b9ae9c' },
  unmapped: { label: 'unmapped', color: '#b8322c' },
};
export function dispositionChip(d) {
  const k = String(d || 'unmapped').toLowerCase();
  const def = DISPOSITIONS[k];
  return `<span class="chip disp-${esc(def ? k : 'other')}">${k === 'unmapped' ? '<span aria-hidden="true">✕</span> ' : ''}${esc(def ? def.label : k)}</span>`;
}

/** "Suggest a change" panel; behaviour (review vs static mode) is wired by client.js. */
export function suggestPanel(t) {
  return `<details class="block suggest" data-suggest data-term-iri="${attr(t.iri)}" data-term-label="${attr(t.label)}">
<summary class="suggest-summary"><span class="suggest-title">Suggest a change</span><span class="suggest-count" data-suggest-count hidden></span></summary>
<p class="muted suggest-mode" data-suggest-mode>Comments on <strong>${esc(t.label)}</strong> are welcome — tweaks, radical alternatives, questions or new proposals.</p>
<form class="suggest-form" novalidate>
  <div class="form-row">
    <label>Kind <select name="kind">
      <option value="tweak">Tweak (small fix)</option>
      <option value="radical">Radical change</option>
      <option value="question">Question</option>
      <option value="proposal">New proposal</option>
    </select></label>
    <label>Your name <input name="author" type="text" maxlength="100" autocomplete="name" placeholder="optional"></label>
  </div>
  <label class="full">Suggestion <textarea name="text" rows="5" maxlength="10000" required placeholder="What should change, and why? Counter-examples are gold."></textarea></label>
  <div class="form-actions">
    <button type="submit" class="btn primary" data-review-only hidden>Submit suggestion</button>
    <button type="button" class="btn" data-copy-md>Copy as Markdown</button>
    <a class="btn" data-issue-link hidden target="_blank" rel="noopener">Open a GitHub issue</a>
    <span class="form-status" role="status" aria-live="polite"></span>
  </div>
</form>
<div class="suggest-list" data-suggest-list hidden></div>
</details>`;
}

/** Generic table for an array of plain objects. */
export function objectTable(m, rows, { badgeKeys = ['ok', 'pass', 'conforms', 'valid', 'consistent'], maxRows = 200 } = {}) {
  if (!Array.isArray(rows) || !rows.length) return '<p class="muted">None.</p>';
  if (rows.every((r) => r === null || typeof r !== 'object')) return `<ul class="plain">${rows.map((r) => `<li>${cellHTML(m, r)}</li>`).join('')}</ul>`;
  const cols = [];
  for (const r of rows) for (const k of Object.keys(r || {})) if (!cols.includes(k)) cols.push(k);
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = rows
    .slice(0, maxRows)
    .map((r) => `<tr>${cols.map((c) => `<td>${badgeKeys.includes(c) && typeof r?.[c] === 'boolean' ? boolBadge(r[c]) : cellHTML(m, r?.[c])}</td>`).join('')}</tr>`)
    .join('');
  const more = rows.length > maxRows ? `<p class="muted">${rows.length - maxRows} more rows not shown.</p>` : '';
  return `<div class="table-wrap"><table class="data compact"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${more}`;
}

function boolBadge(b) {
  return b ? '<span class="badge ok"><span aria-hidden="true">✓</span> yes</span>' : '<span class="badge bad"><span aria-hidden="true">✕</span> no</span>';
}

export function cellHTML(m, v, depth = 0) {
  if (v === null || v === undefined) return '<span class="muted">–</span>';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return `<span class="num">${esc(v.toLocaleString('en-US'))}</span>`;
  if (typeof v === 'string') {
    if (/^https?:\/\//.test(v) && m) return link(m, v);
    if (v.length > 300) return `<details class="cell-more"><summary>${esc(v.slice(0, 120))}…</summary><pre class="pre-wrap">${esc(v)}</pre></details>`;
    return esc(v);
  }
  if (Array.isArray(v)) {
    if (!v.length) return '<span class="muted">[]</span>';
    if (depth > 1) return `<span class="muted">[${v.length} items]</span>`;
    if (v.every((x) => x === null || typeof x !== 'object')) {
      const shown = v.slice(0, 12).map((x) => cellHTML(m, x, depth + 1)).join(', ');
      return v.length > 12 ? `${shown} <span class="muted">+${v.length - 12}</span>` : shown;
    }
    return `<details class="cell-more"><summary>${v.length} item${v.length === 1 ? '' : 's'}</summary>${objectTable(m, v)}</details>`;
  }
  if (typeof v === 'object') {
    if (depth > 1) return `<code>${esc(JSON.stringify(v).slice(0, 200))}</code>`;
    // SPARQL JSON binding {type, value}
    if ('value' in v && 'type' in v && Object.keys(v).length <= 4) return cellHTML(m, v.value, depth + 1);
    return `<dl class="kv">${Object.entries(v)
      .slice(0, 30)
      .map(([k, x]) => `<dt>${esc(k)}</dt><dd>${cellHTML(m, x, depth + 1)}</dd>`)
      .join('')}</dl>`;
  }
  return esc(String(v));
}

export function section(route, title, html, { cls = '' } = {}) {
  return { route, title, html: `<article class="page ${cls}">${html}</article>` };
}

export function emptyState(msg) {
  return `<div class="empty"><p>${msg}</p></div>`;
}
