// Term pages: class, property, individual, concept scheme (vocabulary), module, layout matrix.
import { esc, attr, statusBadge, kindBadge, codeBlock, fmtInt, highlightTurtle } from '../lib/html.mjs';
import { NS, localName } from '../lib/rdf.mjs';
import { ancestors, propertiesFrom, propertiesTo, termsOfModule, sortedModules } from '../lib/model.mjs';
import { mentioned } from '../lib/axioms.mjs';
import { classDiagram, moduleDiagram, propertyDiagram, instanceDiagram } from '../lib/diagrams.mjs';
import { withCardInstances } from '../lib/cardrefs.mjs';
import { pickInstance, neighbourhood, toTurtle } from '../lib/instances.mjs';
import {
  link, exprHTML, propExprHTML, termHeader, annotationsBlock, refsBlock, otherAnnotationsBlock, sourceFieldsBlock,
  suggestPanel, section, termValueHTML, shortName, emptyState, mdInline,
} from './common.mjs';

export const CLASS_LEGEND = `<span class="lg"><svg width="34" height="10" aria-hidden="true"><line x1="1" y1="5" x2="33" y2="5" stroke="#6e6559" stroke-width="1.5"/></svg> logical relation (domain/range)</span>
<span class="lg"><svg width="34" height="10" aria-hidden="true"><line x1="1" y1="5" x2="33" y2="5" stroke="#6e6559" stroke-width="1.2" stroke-dasharray="5 4"/></svg> intended only (non-logical annotation)</span>
<span class="lg"><svg width="34" height="10" aria-hidden="true"><line x1="1" y1="5" x2="33" y2="5" stroke="#8c6d3f" stroke-width="2.5"/></svg> subClassOf</span>
<span class="lg"><svg width="34" height="10" aria-hidden="true"><line x1="1" y1="5" x2="33" y2="5" stroke="#2b4f7e" stroke-width="1.5"/></svg> OWL restriction</span>
<span class="lg"><span class="lg-box ext"></span> outside this view / external</span>`;

function propKindShort(p) {
  return { object: 'object', datatype: 'datatype', annotation: 'annotation', property: 'rdf:Property' }[p.propertyKind] || p.propertyKind;
}

function rangeCell(ctx, p) {
  const { m } = ctx;
  const parts = p.ranges.map((r) => exprHTML(m, r));
  for (const r of p.intendedRanges) if (!p.rangeClasses.includes(r)) parts.push(`<span class="intended" title="smtg:intendedRange — not a logical axiom">${link(m, r)}</span>`);
  return parts.join(', ') || '<span class="muted">—</span>';
}
function domainCell(ctx, p) {
  const { m } = ctx;
  const parts = p.domains.map((r) => exprHTML(m, r));
  for (const r of p.intendedDomains) if (!p.domainClasses.includes(r)) parts.push(`<span class="intended" title="smtg:intendedDomain — not a logical axiom">${link(m, r)}</span>`);
  return parts.join(', ') || '<span class="muted">—</span>';
}
function charCell(p) {
  return p.characteristics.map((c) => `<span class="chip">${esc(c)}</span>`).join(' ');
}

function shaclCardFor(ctx, clsIri, propIri) {
  const out = [];
  for (const s of ctx.shacl.byClass.get(clsIri) || []) {
    for (const c of s.properties) {
      if (c.path.kind === 'predicate' && c.path.iri === propIri && (c.min != null || c.max != null)) out.push(`${c.min ?? 0}..${c.max ?? '*'}`);
    }
  }
  return out.join(', ');
}

// ---------- class ----------

export function classPage(ctx, c) {
  const { m } = ctx;
  const mod = c.module && m.modules.get(c.module);
  let h = termHeader(ctx, c, {
    crumbs: [{ label: 'Classes', href: '#/classes' }, ...(mod ? [{ label: mod.label, href: `#/module/${mod.id}` }] : []), { label: c.label }],
  });
  h += `<div class="lede">${annotationsBlock(ctx, c)}</div>`;

  // diagram
  try {
    const d = classDiagram(m, c, ctx.shacl);
    const note = d.dropped ? `<p class="muted small">${d.dropped} further relation(s) omitted from the diagram; see the tables below.</p>` : '';
    h += `<section class="block"><h2>How it is modelled</h2>${ctx.diagram(d.src, { legend: CLASS_LEGEND, title: `How ${c.label} is modelled` })}${note}</section>`;
  } catch (e) {
    ctx.warn(`diagram for ${c.curie}: ${e.message}`, 'diagram');
  }

  // axioms
  const rows = [];
  const named = c.superClasses.map((s) => link(m, s));
  if (named.length || c.superExpressions.length) {
    rows.push(['Subclass of', [...named, ...c.superExpressions.map((e) => exprHTML(m, e))].map((x) => `<div class="axiom">${x}</div>`).join('')]);
  }
  if (c.equivalents.length) rows.push(['Equivalent to', c.equivalents.map((e) => `<div class="axiom">${exprHTML(m, e)}</div>`).join('')]);
  const anc = ancestors(m, c.iri).filter((a) => !c.superClasses.includes(a));
  if (anc.length) rows.push(['All ancestors', anc.map((a) => link(m, a)).join(', ')]);
  if (c.subClasses.length) rows.push(['Subclasses', c.subClasses.map((s) => link(m, s)).join(', ')]);
  if (c.disjoint.length) rows.push(['Disjoint with', c.disjoint.map((s) => link(m, s)).join(', ')]);
  if (c.disjointUnion.length) rows.push(['Disjoint union of', c.disjointUnion.map((s) => link(m, s)).join(', ')]);
  if (c.keys.length) rows.push(['Has key', c.keys.map((k) => `(${k.map((x) => link(m, x)).join(', ')})`).join('; ')]);
  h += `<section class="block"><h2>Axioms</h2>${
    rows.length
      ? `<table class="axioms"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No logical axioms are stated for this class (by design or not yet).</p>'
  }</section>`;

  // properties
  const out = propertiesFrom(m, c.iri);
  const inc = propertiesTo(m, c.iri);
  const restrProps = new Set();
  for (const e of [...c.superExpressions, ...c.equivalents]) for (const x of mentioned(e)) if (m.properties.has(x)) restrProps.add(x);
  const propRow = (p, intended, extra = '') =>
    `<tr${p.deprecated ? ' class="deprecated"' : ''}><td>${link(m, p.iri)}${intended ? ' <span class="intended-tag" title="via smtg:intendedDomain">intended</span>' : ''}${extra}</td><td>${esc(
      propKindShort(p),
    )}</td><td>${rangeCell(ctx, p)}</td><td>${charCell(p)}</td><td class="num">${esc(shaclCardFor(ctx, c.iri, p.iri))}</td><td>${statusBadge(p.status)}</td></tr>`;
  const thead = '<thead><tr><th>Property</th><th>Kind</th><th>Range</th><th>Characteristics</th><th title="SHACL min..max">SHACL</th><th>Status</th></tr></thead>';
  let ph = '';
  if (out.length) ph += `<div class="table-wrap"><table class="data">${thead}<tbody>${out.map(({ prop, intended }) => propRow(prop, intended)).join('')}</tbody></table></div>`;
  else ph += '<p class="muted">No property declares this class as its (intended) domain.</p>';
  const restrOnly = [...restrProps].filter((x) => !out.some((o) => o.prop.iri === x)).map((x) => m.properties.get(x));
  if (restrOnly.length) {
    ph += `<h3>Constrained by restrictions</h3><div class="table-wrap"><table class="data">${thead}<tbody>${restrOnly.map((p) => propRow(p, false)).join('')}</tbody></table></div>`;
  }
  const inherited = [];
  for (const a of ancestors(m, c.iri)) for (const o of propertiesFrom(m, a)) if (!out.some((x) => x.prop.iri === o.prop.iri)) inherited.push({ ...o, from: a });
  if (inherited.length) {
    ph += `<details class="more"><summary>Inherited from superclasses (${inherited.length})</summary><div class="table-wrap"><table class="data">${thead}<tbody>${inherited
      .map(({ prop, intended, from }) => propRow(prop, intended, ` <span class="muted small">via ${link(m, from)}</span>`))
      .join('')}</tbody></table></div></details>`;
  }
  if (inc.length) {
    ph += `<h3>Used as range by</h3><div class="table-wrap"><table class="data"><thead><tr><th>Property</th><th>Domain</th><th>Characteristics</th><th>Status</th></tr></thead><tbody>${inc
      .map(
        ({ prop, intended }) =>
          `<tr><td>${link(m, prop.iri)}${intended ? ' <span class="intended-tag" title="via smtg:intendedRange">intended</span>' : ''}</td><td>${domainCell(ctx, prop)}</td><td>${charCell(prop)}</td><td>${statusBadge(prop.status)}</td></tr>`,
      )
      .join('')}</tbody></table></div>`;
  }
  h += `<section class="block"><h2>Properties</h2>${ph}</section>`;

  // SHACL
  h += shaclBlock(ctx, c);
  h += sourceFieldsBlock(ctx, c);
  const refs = refsBlock(ctx, c);
  if (refs) h += `<section class="block"><h2>Review</h2>${refs}</section>`;
  h += instanceBlock(ctx, c);
  h += otherAnnotationsBlock(ctx, c);
  h += suggestPanel(c);
  return section(`class/${c.key}`, c.label, h, { cls: 'term-page' });
}

function shPath(m, p) {
  switch (p.kind) {
    case 'predicate':
      return link(m, p.iri);
    case 'inverse':
      return `^${shPath(m, p.item)}`;
    case 'sequence':
      return p.items.map((x) => shPath(m, x)).join(' / ');
    case 'alternative':
      return `(${p.items.map((x) => shPath(m, x)).join(' | ')})`;
    case 'zeroOrMore':
      return `${shPath(m, p.item)}*`;
    case 'oneOrMore':
      return `${shPath(m, p.item)}+`;
    case 'zeroOrOne':
      return `${shPath(m, p.item)}?`;
    default:
      return '<span class="muted">?</span>';
  }
}

function shValueType(m, c) {
  const parts = [];
  for (const x of c.classes) parts.push(`class ${link(m, x)}`);
  if (c.datatype) parts.push(`datatype ${link(m, c.datatype)}`);
  if (c.nodeKind) parts.push(`nodeKind <code>${esc(localName(c.nodeKind))}</code>`);
  if (c.in) parts.push(`in { ${c.in.map((t) => termValueHTML(m, t)).join(', ')} }`);
  for (const v of c.hasValue) parts.push(`hasValue ${termValueHTML(m, v)}`);
  for (const n of c.node) parts.push(`node <code>${esc(m.prefixes.shorten(n))}</code>`);
  if (c.or) parts.push(`or ( ${c.or.map((o) => shValueType(m, o) || '…').join(' | ')} )`);
  if (c.qualified) parts.push(`qualified ${c.qualified.min ?? 0}..${c.qualified.max ?? '*'} of (${shValueType(m, c.qualified.shape) || '…'})`);
  for (const [k, v] of Object.entries(c.facets)) parts.push(`${esc(k)} <code>${esc(v)}</code>`);
  if (c.sparql) parts.push('SPARQL constraint');
  return parts.join('<br>');
}

function shaclRows(m, props) {
  return props
    .map(
      (c) =>
        `<tr${c.deactivated ? ' class="deprecated"' : ''}><td>${shPath(m, c.path)}${c.name ? `<div class="muted small">${esc(c.name)}</div>` : ''}</td><td class="num">${
          c.min != null || c.max != null ? `${c.min ?? 0}..${c.max ?? '*'}` : ''
        }</td><td>${shValueType(m, c)}</td><td>${c.severity && c.severity !== 'Violation' ? `<span class="chip">${esc(c.severity)}</span>` : '<span class="muted small">Violation</span>'}</td><td>${esc(
          c.message || c.description || '',
        )}</td></tr>`,
    )
    .join('');
}

function shaclBlock(ctx, c) {
  const { m } = ctx;
  const shapes = ctx.shacl.byClass.get(c.iri) || [];
  if (!shapes.length) return '';
  let h = '<section class="block"><h2>Validation constraints <span class="h-note">closed-world, SHACL</span></h2>';
  h += '<p class="muted small">SHACL checks the shape of instance data; unlike OWL axioms these constraints do not cause inferences.</p>';
  for (const s of shapes) {
    const own = shValueType(m, s.own);
    h += `<div class="shape"><div class="shape-head"><code>${esc(s.id ? m.prefixes.shorten(s.id) : '[shape]')}</code>${s.closed ? ' <span class="chip">closed</span>' : ''}${
      s.own.message ? ` <span class="muted">${esc(s.own.message)}</span>` : ''
    }${own ? `<div class="small">${own}</div>` : ''}</div>`;
    if (s.properties.length) {
      h += `<div class="table-wrap"><table class="data"><thead><tr><th>Path</th><th>Count</th><th>Value type</th><th>Severity</th><th>Message</th></tr></thead><tbody>${shaclRows(
        m,
        s.properties,
      )}</tbody></table></div>`;
    }
    h += '</div>';
  }
  return h + '</section>';
}

function instanceBlock(ctx, c) {
  const { m, ex } = ctx;
  const pick = pickInstance(ex, c.iri, { docExample: c.docExample, subclasses: subclassClosure(m, c.iri) });
  if (!pick) return '';
  try {
    const hood = neighbourhood(ex, pick.node);
    const d = instanceDiagram(m, ex, hood, pick.node);
    const ttl = toTurtle(hood.quads, m.prefixes, { focus: pick.node });
    const file = ex.fileOf.get(pick.node.value);
    const via =
      pick.via === 'docExample'
        ? 'chosen with <code>smtg:docExample</code>'
        : pick.via === 'subclass'
          ? `an instance of the subclass ${link(m, pick.subclass)}`
          : 'first instance found in the examples';
    return `<section class="block"><h2>Example instance</h2>
<p class="muted small">${pick.node.termType === 'NamedNode' ? `<code>${esc(m.prefixes.shorten(pick.node.value))}</code> — ` : ''}${via}${
      file ? ` (from <a href="ontology/${attr(file)}" download>${esc(file)}</a>)` : ''
    }. Its direct neighbourhood is shown (parts such as faces and costs one level deeper); literals are truncated.</p>
${ctx.diagram(d.src, { title: `Example instance of ${c.label}` })}
${codeBlock(ttl, { lang: 'turtle', label: 'Turtle (excerpt)' })}</section>`;
  } catch (e) {
    ctx.warn(`example instance for ${c.curie}: ${e.message}`, 'examples');
    return '';
  }
}

function subclassClosure(m, v, seen = new Set()) {
  const c = m.classes.get(v);
  if (!c) return [];
  const out = [];
  for (const s of c.subClasses) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s, ...subclassClosure(m, s, seen));
  }
  return out;
}

// ---------- property ----------

export function propertyPage(ctx, p) {
  const { m } = ctx;
  const mod = p.module && m.modules.get(p.module);
  let h = termHeader(ctx, p, {
    crumbs: [{ label: 'Properties', href: '#/properties' }, ...(mod ? [{ label: mod.label, href: `#/module/${mod.id}` }] : []), { label: p.label }],
    extra: p.characteristics.length ? ` <span class="meta-item">${charCell(p)}</span>` : '',
  });
  h += `<div class="lede">${annotationsBlock(ctx, p)}</div>`;
  if (p.propertyKind !== 'annotation' || p.intendedDomains.length || p.domains.length) {
    try {
      const d = propertyDiagram(m, p);
      h += `<section class="block"><h2>Domain and range</h2>${ctx.diagram(d.src, { legend: CLASS_LEGEND, title: `Domain and range of ${p.label}` })}</section>`;
    } catch (e) {
      ctx.warn(`diagram for ${p.curie}: ${e.message}`, 'diagram');
    }
  }
  const rows = [
    ['Kind', esc(propKindShort(p))],
    ['Domain', p.domains.length ? p.domains.map((e) => exprHTML(m, e)).join(', ') : '<span class="muted">not stated</span>'],
    ['Range', p.ranges.length ? p.ranges.map((e) => exprHTML(m, e)).join(', ') : '<span class="muted">not stated</span>'],
  ];
  if (p.intendedDomains.length) rows.push(['Intended domain', `${p.intendedDomains.map((x) => `<span class="intended">${link(m, x)}</span>`).join(', ')} <span class="muted small">(non-logical: no inference)</span>`]);
  if (p.intendedRanges.length) rows.push(['Intended range', `${p.intendedRanges.map((x) => `<span class="intended">${link(m, x)}</span>`).join(', ')} <span class="muted small">(non-logical: no inference)</span>`]);
  if (p.characteristics.length) rows.push(['Characteristics', charCell(p)]);
  if (p.superProperties.length) rows.push(['Subproperty of', p.superProperties.map((x) => link(m, x)).join(', ')]);
  if (p.subProperties.length) rows.push(['Subproperties', p.subProperties.map((x) => link(m, x)).join(', ')]);
  if (p.inverseOf.length) rows.push(['Inverse of', p.inverseOf.map((x) => link(m, x)).join(', ')]);
  if (p.equivalentProperties.length) rows.push(['Equivalent to', p.equivalentProperties.map((x) => link(m, x)).join(', ')]);
  if (p.disjointProperties.length) rows.push(['Disjoint with', p.disjointProperties.map((x) => link(m, x)).join(', ')]);
  for (const ch of p.chains) rows.push(['Property chain', `<span class="axiom">${ch.map((x) => propExprHTML(m, x)).join(' <span class="mkw">∘</span> ')} <span class="mkw">⊑</span> ${link(m, p.iri)}</span>`]);
  h += `<section class="block"><h2>Axioms</h2><table class="axioms"><tbody>${rows.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`).join('')}</tbody></table></section>`;

  // used in class restrictions
  const usedBy = [];
  for (const c of m.classes.values()) {
    for (const e of [...c.superExpressions, ...c.equivalents]) {
      if (mentioned(e).has(p.iri)) usedBy.push({ c, e, eq: c.equivalents.includes(e) });
    }
  }
  if (usedBy.length) {
    h += `<section class="block"><h2>Used in class restrictions</h2><div class="table-wrap"><table class="data"><thead><tr><th>Class</th><th>Axiom</th></tr></thead><tbody>${usedBy
      .map(({ c, e, eq }) => `<tr><td>${link(m, c.iri)}</td><td><span class="mkw">${eq ? '≡' : '⊑'}</span> ${exprHTML(m, e)}</td></tr>`)
      .join('')}</tbody></table></div></section>`;
  }
  const sh = ctx.shacl.byProperty.get(p.iri) || [];
  if (sh.length) {
    h += `<section class="block"><h2>Validation constraints <span class="h-note">closed-world, SHACL</span></h2><div class="table-wrap"><table class="data"><thead><tr><th>Target class</th><th>Path</th><th>Count</th><th>Value type</th><th>Message</th></tr></thead><tbody>${sh
      .map(
        ({ shape, constraint: c }) =>
          `<tr><td>${shape.targets.map((t) => link(m, t)).join(', ') || '<span class="muted">(other target)</span>'}</td><td>${shPath(m, c.path)}</td><td class="num">${
            c.min != null || c.max != null ? `${c.min ?? 0}..${c.max ?? '*'}` : ''
          }</td><td>${shValueType(m, c)}</td><td>${esc(c.message || '')}</td></tr>`,
      )
      .join('')}</tbody></table></div></section>`;
  }
  h += sourceFieldsBlock(ctx, p);
  const refs = refsBlock(ctx, p);
  if (refs) h += `<section class="block"><h2>Review</h2>${refs}</section>`;
  h += otherAnnotationsBlock(ctx, p);
  h += suggestPanel(p);
  return section(`property/${p.key}`, p.label, h, { cls: 'term-page' });
}

// ---------- individual ----------

export function individualPage(ctx, t) {
  const { m } = ctx;
  let h = termHeader(ctx, t, { crumbs: [{ label: 'Individuals' }, { label: t.label }] });
  h += `<div class="lede">${annotationsBlock(ctx, t)}</div>`;
  h += `<section class="block"><h2>Types</h2><p>${t.types.map((x) => link(m, x)).join(', ') || '<span class="muted">none</span>'}</p></section>`;
  if (t.assertions.length) {
    h += `<section class="block"><h2>Assertions</h2><div class="table-wrap"><table class="data"><thead><tr><th>Property</th><th>Value</th></tr></thead><tbody>${t.assertions
      .map((q) => `<tr><td>${link(m, q.predicate.value)}</td><td>${termValueHTML(m, q.object)}</td></tr>`)
      .join('')}</tbody></table></div></section>`;
  }
  h += sourceFieldsBlock(ctx, t);
  const refs = refsBlock(ctx, t);
  if (refs) h += `<section class="block"><h2>Review</h2>${refs}</section>`;
  h += otherAnnotationsBlock(ctx, t);
  h += suggestPanel(t);
  return section(`individual/${t.key}`, t.label, h, { cls: 'term-page' });
}

// ---------- vocabulary (concept scheme) ----------

const CONCEPT_STD = new Set([NS.smtg + 'sourceValueOf']);

export function vocabPage(ctx, sc) {
  const { m, symbols: S } = ctx;
  const concepts = sc.concepts.map((v) => m.concepts.get(v)).filter(Boolean);
  const mod = sc.module && m.modules.get(sc.module);
  let h = termHeader(ctx, sc, {
    hideEmptyStatus: true,
    crumbs: [{ label: 'Vocabularies', href: '#/vocabularies' }, { label: sc.label }],
    extra: ` <span class="meta-item"><span class="lbl">concepts</span> ${fmtInt(concepts.length)}</span>${
      sc.conceptClass ? ` <span class="meta-item"><span class="lbl">concept class</span> ${link(m, sc.conceptClass)}</span>` : ''
    }`,
  });
  void mod;
  h += `<div class="lede">${annotationsBlock(ctx, sc)}</div>`;
  const hasSym = concepts.some((c) => c.symbol);
  const hasAlt = concepts.some((c) => c.altLabels.length);
  const hasBroader = concepts.some((c) => c.broader.length || c.narrower.length);
  const hasStatus = concepts.some((c) => c.status);
  const hasSource = concepts.some((c) => c.other.some((o) => o.p === NS.smtg + 'sourceValueOf'));
  // extra literal annotations used by ≥1 concept (e.g. smtg:faceCount) become columns (max 6)
  const extraCount = new Map();
  for (const c of concepts) for (const o of c.other) if (!CONCEPT_STD.has(o.p)) extraCount.set(o.p, (extraCount.get(o.p) || 0) + 1);
  const extras = [...extraCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([p]) => p);
  const cols = [
    hasSym ? '<th>Symbol</th>' : '',
    '<th>Notation</th><th>Label</th>',
    hasAlt ? '<th>Alt. labels</th>' : '',
    '<th>Definition</th>',
    hasBroader ? '<th>Broader</th>' : '',
    ...extras.map((p) => `<th><a href="${attr(ctxRoute(m, p))}" class="term">${esc(shortName(m, p))}</a></th>`),
    hasStatus ? '<th>Status</th>' : '',
  ].join('');
  const conceptLink = (v) => {
    const c = m.concepts.get(v);
    if (!c) return link(m, v);
    const s = m.schemes.get(c.schemes[0]);
    return `<a class="term" href="#/vocab/${attr(s?.key || sc.key)}/${attr(c.anchor)}" title="${attr(c.label)}">${esc(c.notations[0] || c.label)}</a>`;
  };
  const rows = concepts
    .map((c) => {
      const extraCells = extras
        .map((p) => {
          const vals = c.other.filter((o) => o.p === p).map((o) => (o.o.termType === 'NamedNode' && m.concepts.has(o.o.value) ? conceptLink(o.o.value) : termValueHTML(m, o.o)));
          return `<td>${vals.length > 10 ? `${vals.slice(0, 10).join(', ')} <span class="muted small">+${vals.length - 10}</span>` : vals.join(', ')}</td>`;
        })
        .join('');
      return `<tr data-anchor="${attr(c.anchor)}"${c.deprecated ? ' class="deprecated"' : ''}>${
        hasSym ? `<td class="sym">${c.symbol ? S.pips(c.symbol) : ''}</td>` : ''
      }<td><code title="${attr(c.iri)}">${esc(c.notations.join(', ') || localName(c.iri))}</code> <button type="button" class="btn-icon" data-copy-iri aria-label="Copy IRI">⧉</button></td><td>${esc(c.prefLabel || c.label)}</td>${hasAlt ? `<td>${c.altLabels.map(esc).join(', ')}</td>` : ''}<td>${
        c.definition ? mdInline(S.inline(c.definition)) : ''
      }${
        c.scopeNotes.length ? `<div class="muted small">${c.scopeNotes.map((x) => mdInline(S.inline(x))).join('<br>')}</div>` : ''
      }${refsInline(ctx, c)}</td>${hasBroader ? `<td>${c.broader.map(conceptLink).join(', ')}${c.narrower.length ? `<div class="muted small">narrower: ${c.narrower.map(conceptLink).join(', ')}</div>` : ''}</td>` : ''}${extraCells}${
        hasStatus ? `<td>${c.status ? statusBadge(c.status) : ''}</td>` : ''
      }</tr>`;
    })
    .join('');
  const tid = `vt-${sc.key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  h += `<section class="block"><h2>Concepts</h2>${
    concepts.length > 8
      ? `<div class="filter-row"><label class="filter"><span class="sr-only">Filter concepts</span><input type="search" placeholder="Filter ${fmtInt(concepts.length)} concepts…" data-filter-table="${tid}"></label><span class="muted small" data-filter-count="${tid}"></span></div>`
      : ''
  }<div class="table-wrap"><table class="data vocab${hasSym ? ' with-sym' : ''}" id="${tid}"><thead><tr>${cols}</tr></thead><tbody>${rows}</tbody></table></div>${
    hasSource ? '<p class="muted small">Notations are the exact source code values.</p>' : ''
  }</section>`;
  if (!concepts.length) h += emptyState('This scheme has no concepts yet.');
  h += suggestPanel(sc);
  return section(`vocab/${sc.key}`, sc.label, h, { cls: 'term-page' });
}

function ctxRoute(m, v) {
  const t = m.terms.get(v);
  return t?.kind ? `#/property/${t.key}` : v;
}

function refsInline(ctx, t) {
  const ids = [...(t.reviewQuestions || []), ...(t.antiPatterns || [])];
  if (!ids.length) return '';
  return `<div class="small">${ids
    .map((id) => {
      const r = ctx.idHref(id);
      return `<a class="ref-id${r.missing ? ' missing' : ''}" href="${attr(r.href)}">${esc(id)}</a>`;
    })
    .join(' ')}</div>`;
}

// ---------- module ----------

export function modulePage(ctx, mod) {
  const { m } = ctx;
  const kindLabel = { module: 'module', vocab: 'generated vocabulary', view: 'opt-in view', aggregate: 'aggregate', proposal: 'proposal' }[mod.kind] || mod.kind;
  let h = `<header class="page-head">
<nav class="crumbs" aria-label="Breadcrumb"><a href="#/modules">Modules</a><span class="sep" aria-hidden="true">/</span><span>${esc(mod.label)}</span></nav>
<h1>${esc(mod.label)}</h1>
<div class="term-meta"><span class="kind k-module">${esc(kindLabel)}</span> ${statusBadge(mod.status)}${mod.version ? ` <span class="meta-item"><span class="lbl">version</span> ${esc(mod.version)}</span>` : ''}${
    mod.file ? ` <span class="meta-item"><span class="lbl">file</span> <a href="ontology/${attr(mod.file)}" download><code>${esc(mod.file)}</code></a></span>` : ''
  }</div>
<div class="iri-line"><code class="iri">${esc(mod.iri)}</code><button type="button" class="btn-sm" data-copy="${attr(mod.iri)}">Copy IRI</button></div>
</header>`;
  if (mod.title && mod.title !== mod.label) h += `<p class="subtitle">${esc(mod.title)}</p>`;
  if (mod.description) h += `<div class="lede prose">${ctx.markdownInline(mod.description)}</div>`;
  if (mod.imports.length) h += `<p><span class="lbl">imports</span> ${mod.imports.map((x) => link(m, x)).join(', ')}</p>`;
  if (mod.importedBy?.length) h += `<p><span class="lbl">imported by</span> ${mod.importedBy.map((x) => link(m, x)).join(', ')}</p>`;

  const classes = termsOfModule(m, mod.iri, ['class']);
  if (classes.length) {
    try {
      const d = moduleDiagram(m, ctx.shacl, classes.map((c) => c.iri), { compartments: classes.length <= 18 });
      h += `<section class="block"><h2>Module diagram</h2>${ctx.diagram(d.src, { legend: CLASS_LEGEND, title: `${mod.label} module` })}${
        d.dropped ? `<p class="muted small">${d.dropped} relation(s) omitted for legibility.</p>` : ''
      }</section>`;
    } catch (e) {
      ctx.warn(`module diagram ${mod.id}: ${e.message}`, 'diagram');
    }
  }
  h += termTables(ctx, mod.iri);
  const file = mod.file && m.files.find((f) => f.rel === mod.file);
  if (file?.text != null) {
    const lines = fmtInt(file.text.split('\n').length);
    const kb = Math.round(file.text.length / 1024);
    h += `<section class="block"><h2>Turtle source</h2>${
      file.text.length > 160_000
        ? `<p><a class="btn" href="ontology/${attr(file.rel)}" download>Download <code>${esc(file.rel)}</code></a> <span class="muted small">${lines} lines, ${kb} KB — too large to embed; open the downloaded copy.</span></p>`
        : `<details class="source"><summary>Show <code>${esc(file.rel)}</code> (${lines} lines)</summary>${codeBlock(file.text, { lang: 'turtle', label: file.rel, download: `ontology/${file.rel}`, maxHeight: true })}</details>`
    }</section>`;
  }
  if (file?.error) h += `<div class="callout bad"><strong>Parse error:</strong> <code>${esc(file.error)}</code></div>`;
  h += suggestPanel({ iri: mod.iri, label: mod.label });
  return section(`module/${mod.id}`, mod.label, h);
}

export function termTables(ctx, modIri, { terms = null } = {}) {
  const { m } = ctx;
  const all = terms || termsOfModule(m, modIri);
  const groups = [
    ['Classes', all.filter((t) => t.kind === 'class')],
    ['Object properties', all.filter((t) => t.kind === 'object')],
    ['Datatype properties', all.filter((t) => t.kind === 'datatype')],
    ['Annotation properties', all.filter((t) => t.kind === 'annotation')],
    ['Other properties', all.filter((t) => t.kind === 'property')],
    ['Named individuals', all.filter((t) => t.kind === 'individual')],
    ['Concept schemes', all.filter((t) => t.kind === 'scheme')],
  ];
  let h = '';
  for (const [title, list] of groups) {
    if (!list.length) continue;
    h += `<section class="block"><h2>${esc(title)} <span class="h-note">${list.length}</span></h2><div class="table-wrap"><table class="data"><thead><tr><th>Term</th><th>Definition</th><th>Status</th></tr></thead><tbody>${list
      .map(
        (t) =>
          `<tr${t.deprecated ? ' class="deprecated"' : ''}><td>${link(m, t.iri)}<div class="muted small">${esc(t.label)}</div></td><td>${
            t.definition ? mdInline(ctx.symbols.inline(t.definition)) : '<span class="muted">—</span>'
          }</td><td>${statusBadge(t.status)}</td></tr>`,
      )
      .join('')}</tbody></table></div></section>`;
  }
  return h || emptyState('No terms are defined by this module yet.');
}

// ---------- index pages ----------

export function classesIndex(ctx) {
  const { m } = ctx;
  return indexPage(ctx, 'classes', 'Classes', [...m.classes.values()].filter((c) => c.local));
}
export function propertiesIndex(ctx) {
  const { m } = ctx;
  return indexPage(ctx, 'properties', 'Properties', [...m.properties.values()].filter((c) => c.local), true);
}
function indexPage(ctx, route, title, terms, showKind = false) {
  const { m } = ctx;
  const byMod = new Map();
  for (const t of terms) {
    const k = t.module || '';
    if (!byMod.has(k)) byMod.set(k, []);
    byMod.get(k).push(t);
  }
  const mods = [...byMod.keys()].sort((a, b) => (m.modules.get(a)?.order ?? 999) - (m.modules.get(b)?.order ?? 999) || a.localeCompare(b));
  let h = `<header class="page-head"><h1>${esc(title)}</h1><p class="muted">${terms.length} ${title.toLowerCase()} across ${mods.length} module(s).</p></header>`;
  if (!terms.length) h += emptyState(`No ${title.toLowerCase()} found in the ontology yet.`);
  for (const k of mods) {
    const mod = m.modules.get(k);
    const list = byMod.get(k).sort((a, b) => a.label.localeCompare(b.label));
    h += `<section class="block"><h2>${mod ? `<a href="#/module/${attr(mod.id)}">${esc(mod.label)}</a>` : 'Unassigned'}</h2><div class="table-wrap"><table class="data"><thead><tr><th>Term</th>${
      showKind ? '<th>Kind</th>' : ''
    }<th>Definition</th><th>Status</th></tr></thead><tbody>${list
      .map(
        (t) =>
          `<tr${t.deprecated ? ' class="deprecated"' : ''}><td>${link(m, t.iri)}<div class="muted small">${esc(t.label)}</div></td>${showKind ? `<td>${kindBadge(t.kind)}</td>` : ''}<td>${
            t.definition ? mdInline(ctx.symbols.inline(t.definition)) : '<span class="muted">—</span>'
          }</td><td>${statusBadge(t.status)}</td></tr>`,
      )
      .join('')}</tbody></table></div></section>`;
  }
  return section(route, title, h);
}

export function modulesIndex(ctx) {
  const { m } = ctx;
  const mods = sortedModules(m, ['module', 'aggregate', 'view', 'vocab']);
  let h = `<header class="page-head"><h1>Modules</h1><p class="muted">Each module is one Turtle file with its own <code>owl:Ontology</code> header.</p></header>`;
  h += moduleCards(ctx, mods);
  return section('modules', 'Modules', h);
}

export function moduleCards(ctx, mods) {
  const { m } = ctx;
  if (!mods.length) return emptyState('No modules (owl:Ontology headers) found yet.');
  return `<div class="cards">${mods
    .map((mod) => {
      const n = (k) => termsOfModule(m, mod.iri, k).length;
      const counts = [
        [n(['class']), 'classes'],
        [n(['object', 'datatype', 'annotation', 'property']), 'properties'],
        [n(['scheme']), 'schemes'],
      ]
        .filter(([c]) => c)
        .map(([c, l]) => `${c} ${l}`)
        .join(' · ');
      const kind = mod.kind !== 'module' ? `<span class="kind k-module">${esc({ vocab: 'vocabulary', view: 'opt-in view', aggregate: 'aggregate' }[mod.kind] || mod.kind)}</span> ` : '';
      return `<a class="card" href="#/module/${attr(mod.id)}"><span class="card-title">${esc(mod.label)}</span><span class="card-sub">${kind}${statusBadge(mod.status)}</span><span class="card-body">${esc(
        trimText(mod.title && mod.title !== mod.label ? mod.title : mod.description || '', 160),
      )}</span><span class="card-foot muted">${counts || 'no terms yet'}</span></a>`;
    })
    .join('')}</div>`;
}

function trimText(s, n) {
  const t = String(s || '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

export function vocabIndex(ctx) {
  const { m, symbols: S } = ctx;
  const schemes = [...m.schemes.values()].sort((a, b) => a.label.localeCompare(b.label));
  let h = `<header class="page-head"><h1>Vocabularies</h1><p class="muted">Controlled vocabularies (SKOS concept schemes). Concept notations are the exact source values.</p></header>`;
  if (!schemes.length) h += emptyState('No SKOS concept schemes found yet (ontology/vocab/ is generated by <code>npm run vocab</code>).');
  else {
    h += `<div class="table-wrap"><table class="data"><thead><tr><th>Scheme</th><th>Concepts</th><th>Concept class</th><th>Sample</th></tr></thead><tbody>${schemes
      .map((sc) => {
        const sample = sc.concepts
          .slice(0, 6)
          .map((v) => m.concepts.get(v))
          .map((c) => (c.symbol ? S.pips(c.symbol) : `<code>${esc(c.notations[0] || c.label)}</code>`))
          .join(' ');
        return `<tr><td><a class="term" href="#/vocab/${attr(sc.key)}">${esc(sc.label)}</a>${sc.definition ? `<div class="muted small">${esc(trimText(sc.definition, 140))}</div>` : ''}</td><td class="num">${fmtInt(
          sc.concepts.length,
        )}</td><td>${sc.conceptClass ? link(m, sc.conceptClass) : ''}</td><td>${sample}${sc.concepts.length > 6 ? ' …' : ''}</td></tr>`;
      })
      .join('')}</tbody></table></div>`;
  }
  return section('vocabularies', 'Vocabularies', h);
}

// ---------- layout matrix ----------

export function layoutMatrix(ctx) {
  const { m } = ctx;
  const census = ctx.inputs.census;
  const oracleCensus = ctx.inputs.oracleCensus;
  const layoutClass = NS.smtg + 'Layout';
  const scheme =
    [...m.schemes.values()].find((s) => s.key === 'layout' || s.key.endsWith('/layout')) ||
    [...m.schemes.values()].find((s) => s.conceptClass === layoutClass);
  const concepts = scheme ? scheme.concepts.map((v) => m.concepts.get(v)) : [...m.concepts.values()].filter((c) => c.types.includes(layoutClass));
  let h = `<header class="page-head"><h1>Layout matrix</h1><p class="lede">How each published layout configures faces, physical sides and Oracle identity — the three concerns that a single <code>layout</code> string flattens.</p></header>`;
  const A = (c, name) => c.other.filter((o) => o.p === NS.smtg + name).map((o) => o.o);
  const plain = (t) => {
    if (t.termType === 'NamedNode') {
      const cc = m.concepts.get(t.value);
      return cc ? link(m, t.value, { text: cc.label }) : link(m, t.value);
    }
    const v = String(t.value);
    if (/boolean$/.test(t.datatype?.value || '') || /^(true|false)$/.test(v)) return v === 'true' ? '<span class="yes">yes</span>' : '<span class="no">no</span>';
    if (/^no$/i.test(v)) return '<span class="no">no</span>';
    if (/^yes\b/i.test(v)) return `<span class="yes">yes</span>${esc(v.replace(/^yes\s*[:—–-]?\s*/i, '') ? ': ' + v.replace(/^yes\s*[:—–-]?\s*/i, '') : '')}`;
    return esc(v);
  };
  const val = (c, name) => {
    const v = A(c, name);
    return v.length ? v.map(plain).join(', ') : '<span class="muted">—</span>';
  };
  const layouts = census?.layouts || {};
  const oracleLayouts = oracleCensus?.layouts || {};
  const known = new Set(concepts.flatMap((c) => c.notations.map(String)));
  if (!concepts.length && !Object.keys(layouts).length) {
    h += emptyState('No layout vocabulary (scheme <code>layout</code> or concepts typed <code>smtg:Layout</code>) and no census yet.');
    return section('layouts', 'Layout matrix', h);
  }
  const num = (n) => (Number.isFinite(Number(n)) && n !== undefined && n !== null ? fmtInt(Number(n)) : '<span class="muted">—</span>');
  const hasFC = concepts.some((c) => A(c, 'impliesFaceConfiguration').length);
  const rows = concepts.map((c) => {
    const code = c.notations[0] || localName(c.iri);
    const def = A(c, 'definedClass')
      .filter((t) => t.termType === 'NamedNode')
      .map((t) => link(m, t.value))
      .join(', ');
    const oc = oracleLayouts[code] ?? A(c, 'observedCount')[0]?.value;
    return `<tr><td class="nowrap"><a class="term" href="#/vocab/${attr(scheme?.key || 'layout')}/${attr(c.anchor)}">${esc(code)}</a></td><td>${esc(c.label)}</td><td class="layout-ex">${c.examples?.length ? withCardInstances(false, () => c.examples.map((x) => mdInline(esc(x))).join('<br>')) : '<span class="muted">—</span>'}</td><td class="num">${val(c, 'faceCount')}</td><td class="num">${val(
      c,
      'physicalSides',
    )}</td><td>${val(c, 'faceArrangement')}</td><td>${val(c, 'separateOracleIdentity')}</td>${hasFC ? `<td>${val(c, 'impliesFaceConfiguration')}</td>` : ''}<td>${def || '<span class="muted">—</span>'}</td><td class="num">${num(oc)}</td><td class="num">${num(layouts[code])}</td></tr>`;
  });
  const missing = [...new Set([...Object.keys(layouts), ...Object.keys(oracleLayouts)])].filter((k) => !known.has(k));
  for (const k of missing) {
    rows.push(
      `<tr class="flag"><td class="nowrap"><code>${esc(k)}</code></td><td colspan="${hasFC ? 7 : 6}"><span class="badge bad"><span aria-hidden="true">✕</span> not in vocabulary</span> observed in the census but no layout concept defines it</td><td></td><td class="num">${num(oracleLayouts[k])}</td><td class="num">${num(layouts[k])}</td></tr>`,
    );
  }
  h += `<div class="table-wrap"><table class="data matrix"><thead><tr><th>Layout</th><th>Label</th><th>Example</th><th class="num">Faces</th><th class="num">Sides</th><th>Face arrangement</th><th>Separate Oracle identity</th>${
    hasFC ? '<th>Face configuration</th>' : ''
  }<th>Defined class</th><th class="num" title="Oracle cards with this layout (oracle_cards census)">Oracle cards</th><th class="num" title="Card objects/printings with this layout (all_cards census)">Printings</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const src = [oracleCensus && `${esc(oracleCensus.source || 'oracle census')}: ${fmtInt(oracleCensus.records)} records`, census && `${esc(census.source || 'census')}: ${fmtInt(census.records)} records`].filter(Boolean);
  if (src.length) h += `<p class="muted small">Counts from ${src.join('; ')}. See <a href="#/audit">Source audit</a>.</p>`;
  return section('layouts', 'Layout matrix', h);
}

export { highlightTurtle };
