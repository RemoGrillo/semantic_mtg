// Mermaid flowchart generators: class "how it is modelled", module, overview, property, instance.
// All labels are HTML (htmlLabels) and escaped for Mermaid; every diagram is parse-checked at build time.
import { NS, localName } from './rdf.mjs';
import { conjunctRestrictions, cardinalityText } from './axioms.mjs';
import { propertiesFrom, propertiesTo, rangeTargets, domainTargets } from './model.mjs';

export const PALETTE = {
  ink: '#27221c',
  muted: '#6e6559',
  faint: '#a89e8f',
  surface: '#faf6ee',
  bg: '#f3ecdd',
  accent: '#2b4f7e',
  accentTint: '#e3e9f1',
  concept: '#efe6d3',
  sub: '#8c6d3f',
};

/** Escape text for use inside a quoted Mermaid label (which is itself HTML). */
export function mtext(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/#/g, '#35;')
    .replace(/"/g, '#quot;')
    .replace(/[\r\n]+/g, ' ');
}
const trunc = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

export class Flow {
  constructor(direction = 'LR') {
    this.direction = direction;
    this.nodes = new Map(); // key -> { id, label, shape, cls, href, tip, group }
    this.edges = [];
    this.edgeKeys = new Set();
    this.groups = new Map(); // group id -> label
  }
  node(key, label, { shape = 'rect', cls = null, href = null, tip = null, group = null } = {}) {
    if (this.nodes.has(key)) {
      const n = this.nodes.get(key);
      if (cls === 'focus') n.cls = 'focus';
      return n.id;
    }
    const id = `n${this.nodes.size}`;
    this.nodes.set(key, { id, label, shape, cls, href, tip, group });
    return id;
  }
  has(key) {
    return this.nodes.has(key);
  }
  idOf(key) {
    return this.nodes.get(key)?.id;
  }
  group(id, label) {
    this.groups.set(id, label);
  }
  /** style: solid | dashed | sub | restr | inverse */
  edge(fromKey, toKey, label, style = 'solid') {
    const a = this.idOf(fromKey);
    const b = this.idOf(toKey);
    if (!a || !b) return false;
    const k = `${a}|${b}|${label}|${style}`;
    if (this.edgeKeys.has(k)) return false;
    this.edgeKeys.add(k);
    this.edges.push({ a, b, label, style });
    return true;
  }
  get size() {
    return this.edges.length;
  }
  toString() {
    const L = [`flowchart ${this.direction}`];
    const shape = (n) => {
      const lab = `"${n.label}"`;
      switch (n.shape) {
        case 'round':
          return `(${lab})`;
        case 'stadium':
          return `([${lab}])`;
        case 'data':
          return `[/${lab}/]`;
        case 'sub':
          return `[[${lab}]]`;
        default:
          return `[${lab}]`;
      }
    };
    const emitNode = (n, indent = '  ') => L.push(`${indent}${n.id}${shape(n)}`);
    const grouped = new Map();
    for (const n of this.nodes.values()) {
      if (n.group && this.groups.has(n.group)) {
        if (!grouped.has(n.group)) grouped.set(n.group, []);
        grouped.get(n.group).push(n);
      } else emitNode(n);
    }
    for (const [gid, nodes] of grouped) {
      L.push(`  subgraph ${gid} ["${mtext(this.groups.get(gid))}"]`);
      for (const n of nodes) emitNode(n, '    ');
      L.push('  end');
    }
    const arrow = { solid: '-->', dashed: '-.->', sub: '==>', restr: '-->', inverse: '-.-' };
    this.edges.forEach((e) => {
      const lab = e.label ? `|"${mtext(e.label)}"|` : '';
      L.push(`  ${e.a} ${arrow[e.style] || '-->'}${lab} ${e.b}`);
    });
    for (const n of this.nodes.values()) {
      if (n.href) L.push(`  click ${n.id} href "${n.href.replace(/"/g, '%22')}"${n.tip ? ` "${mtext(n.tip).replace(/"/g, '')}"` : ''}`);
    }
    const P = PALETTE;
    L.push(`  classDef focus fill:${P.accentTint},stroke:${P.accent},stroke-width:2px,color:${P.ink}`);
    L.push(`  classDef ext fill:${P.bg},stroke:${P.faint},stroke-dasharray:3 3,color:${P.muted}`);
    L.push(`  classDef concept fill:${P.concept},stroke:${P.faint},color:${P.ink}`);
    L.push(`  classDef data fill:${P.surface},stroke:${P.faint},color:${P.muted}`);
    L.push(`  classDef inst fill:${P.surface},stroke:${P.muted},color:${P.ink}`);
    L.push(`  classDef prop fill:${P.accentTint},stroke:${P.accent},color:${P.ink}`);
    const byCls = new Map();
    for (const n of this.nodes.values()) {
      if (!n.cls) continue;
      if (!byCls.has(n.cls)) byCls.set(n.cls, []);
      byCls.get(n.cls).push(n.id);
    }
    for (const [c, ids] of byCls) L.push(`  class ${ids.join(',')} ${c}`);
    this.edges.forEach((e, i) => {
      if (e.style === 'sub') L.push(`  linkStyle ${i} stroke:${P.sub},stroke-width:2px`);
      else if (e.style === 'dashed' || e.style === 'inverse') L.push(`  linkStyle ${i} stroke:${P.muted},stroke-width:1.2px,stroke-dasharray:5 4`);
      else if (e.style === 'restr') L.push(`  linkStyle ${i} stroke:${P.accent},stroke-width:1.4px`);
    });
    return L.join('\n');
  }
}

// ---------- shared helpers ----------

function shortName(m, iriValue) {
  if (iriValue.startsWith(NS.smtg)) return iriValue.slice(NS.smtg.length);
  return m.prefixes.curie(iriValue) || localName(iriValue);
}
function datatypeName(m, expr) {
  if (!expr) return '';
  if (expr.type === 'named') return shortName(m, expr.iri).replace(/^xsd:/, '');
  if (expr.type === 'datatype') return `${shortName(m, expr.base || '').replace(/^xsd:/, '')}[…]`;
  if (expr.type === 'or') return expr.ops.map((e) => datatypeName(m, e)).join(' | ');
  return '…';
}

/** Cardinality text from SHACL for (class, property), e.g. "1..*". */
export function shaclCard(shacl, clsIri, propIri) {
  const shapes = shacl?.byClass.get(clsIri) || [];
  for (const s of shapes) {
    for (const c of s.properties) {
      if (c.path.kind === 'predicate' && c.path.iri === propIri && (c.min != null || c.max != null)) {
        const lo = c.min ?? 0;
        const hi = c.max ?? '*';
        return lo === hi ? `${lo}` : `${lo}..${hi}`;
      }
    }
  }
  return null;
}

function classHref(m, v) {
  const c = m.classes.get(v);
  if (c?.overlayRoute) return c.overlayRoute;
  return c && c.local ? `#/class/${c.key}` : null;
}

function addClass(fb, m, v, { focus = false, compartment = null, group = null, faded = null } = {}) {
  const c = m.classes.get(v);
  const local = !!c?.local;
  const isExternal = faded ?? !local;
  let label = `<span class='mm-nm'>${mtext(shortName(m, v))}</span>`;
  if (compartment && compartment.length) label += `<span class='mm-cmp'>${compartment.join('<br/>')}</span>`;
  return fb.node(v, label, {
    cls: focus ? 'focus' : isExternal ? 'ext' : null,
    href: classHref(m, v),
    tip: c ? c.label : shortName(m, v),
    group,
  });
}

function addConcept(fb, m, v) {
  const c = m.concepts.get(v);
  const sc = c && m.schemes.get(c.schemes[0]);
  const lab = c ? `${sc && !sc.pseudo ? sc.key + ': ' : ''}${c.notations[0] || c.label}` : shortName(m, v);
  // official symbol (Scryfall PNG via CSS class) when the concept has smtg:symbol
  const pip = c?.symbol && m.pipClass ? String(c.symbol).match(/\{[^{}]+\}/g)?.map((x) => m.pipClass(x)).filter(Boolean).map((k) => `<span class='pip ${k}'></span>`).join('') : '';
  return fb.node(v, `${pip ? pip + ' ' : ''}<span class='mm-cv'>${mtext(trunc(lab, 40))}</span>`, {
    shape: 'stadium',
    cls: 'concept',
    href: c && sc ? `#/vocab/${sc.key}/${c.anchor}` : null,
    tip: c?.label,
  });
}

function addValueNode(fb, m, term) {
  if (term.termType === 'NamedNode') {
    if (m.concepts.has(term.value)) return { key: term.value, id: addConcept(fb, m, term.value) };
    if (m.classes.has(term.value)) return { key: term.value, id: addClass(fb, m, term.value) };
    const k = term.value;
    return { key: k, id: fb.node(k, `<span class='mm-cv'>${mtext(shortName(m, k))}</span>`, { shape: 'stadium', cls: 'concept' }) };
  }
  const k = `lit:${term.value}`;
  return { key: k, id: fb.node(k, mtext(`"${trunc(term.value, 30)}"`), { shape: 'data', cls: 'data' }) };
}

/** Lines for the datatype "compartment" of a class node. */
export function dataCompartment(m, shacl, clsIri, limit = 14) {
  const lines = [];
  for (const { prop, intended } of propertiesFrom(m, clsIri)) {
    if (!prop.isDataLike || prop.propertyKind === 'annotation') continue;
    const range = prop.ranges.length ? prop.ranges.map((r) => datatypeName(m, r)).join(' ∧ ') : 'literal';
    const card = shaclCard(shacl, clsIri, prop.iri);
    const txt = `${mtext(shortName(m, prop.iri))} : ${mtext(range)}${card ? ` [${card}]` : ''}`;
    lines.push(intended ? `<i>${txt}</i>` : txt);
  }
  lines.sort();
  if (lines.length > limit) {
    const n = lines.length - limit;
    lines.length = limit;
    lines.push(`<i>… ${n} more</i>`);
  }
  return lines;
}

// ---------- class page ----------

export function classDiagram(m, cls, shacl, { maxEdges = 36, maxIncoming = 8, maxSub = 10 } = {}) {
  const fb = new Flow('LR');
  const v = cls.iri;
  addClass(fb, m, v, { focus: true, compartment: dataCompartment(m, shacl, v) });
  let dropped = 0;
  const edge = (a, b, label, style) => {
    if (fb.size >= maxEdges) {
      dropped++;
      return;
    }
    fb.edge(a, b, label, style);
  };
  for (const s of cls.superClasses) {
    addClass(fb, m, s);
    edge(v, s, 'subClassOf', 'sub');
  }
  for (const s of cls.impliedSuper) {
    addClass(fb, m, s);
    edge(v, s, '≡ … and', 'sub');
  }
  // restrictions from subClassOf / equivalentClass
  const restr = [
    ...cls.superExpressions.flatMap(conjunctRestrictions).map((r) => ({ r, eq: false })),
    ...cls.equivalents.flatMap(conjunctRestrictions).map((r) => ({ r, eq: true })),
  ];
  for (const { r, eq } of restr) {
    const pl = (r.prop.type === 'inverse' ? 'inverse ' : '') + shortName(m, r.prop.iri);
    const lab = `${eq ? '≡ ' : ''}${pl} ${cardinalityText(r)}`.trim();
    if (r.type === 'value') {
      const vn = addValueNode(fb, m, r.value);
      edge(v, vn.key, lab, 'restr');
    } else if (r.filler && r.filler.type === 'named') {
      if (m.classes.has(r.filler.iri) || !r.filler.iri.startsWith(NS.xsd)) {
        addClass(fb, m, r.filler.iri);
        edge(v, r.filler.iri, lab, 'restr');
      }
    } else if (r.filler && r.filler.type === 'or') {
      for (const op of r.filler.ops.filter((o) => o.type === 'named')) {
        addClass(fb, m, op.iri);
        edge(v, op.iri, lab, 'restr');
      }
    } else if (!r.filler && ['min', 'max', 'exactly', 'some'].includes(r.type)) {
      // unqualified cardinality — no target class to draw; listed in the axioms table
    }
  }
  // outgoing object properties
  for (const { prop, intended } of propertiesFrom(m, v)) {
    if (prop.isDataLike || prop.propertyKind === 'annotation') continue;
    const card = shaclCard(shacl, v, prop.iri);
    const lab = shortName(m, prop.iri) + (card ? ` [${card}]` : '');
    const targets = rangeTargets(prop);
    if (!targets.length) {
      fb.node('owl:Thing', `<span class='mm-nm'>owl:Thing</span>`, { cls: 'ext', tip: 'no range declared' });
      edge(v, 'owl:Thing', lab, intended ? 'dashed' : 'solid');
      continue;
    }
    for (const t of targets) {
      if (m.concepts.has(t.iri)) addConcept(fb, m, t.iri);
      else addClass(fb, m, t.iri);
      edge(v, t.iri, lab, intended || !t.logical ? 'dashed' : 'solid');
    }
  }
  // incoming object properties (capped: hubs such as OracleCard are the range of many properties)
  let incoming = 0;
  for (const { prop, intended } of propertiesTo(m, v)) {
    if (prop.isDataLike || prop.propertyKind === 'annotation') continue;
    for (const s of domainTargets(prop)) {
      if (s.iri === v) continue; // self-loops already drawn as outgoing
      if (incoming >= maxIncoming) {
        dropped++;
        continue;
      }
      addClass(fb, m, s.iri);
      edge(s.iri, v, shortName(m, prop.iri), intended || !s.logical ? 'dashed' : 'solid');
      incoming++;
    }
  }
  cls.subClasses.forEach((s, i) => {
    if (i >= maxSub) return void dropped++;
    addClass(fb, m, s);
    edge(s, v, 'subClassOf', 'sub');
  });
  return { src: fb.toString(), edges: fb.size, nodes: fb.nodes.size, dropped };
}

// ---------- module / overview ----------

export function moduleDiagram(m, shacl, classIris, { compartments = true, groupBy = null, maxEdges = 90, highlight = new Set() } = {}) {
  const fb = new Flow('LR');
  const inSet = new Set(classIris);
  if (groupBy) for (const [gid, label] of groupBy.groups) fb.group(gid, label);
  for (const v of classIris) {
    addClass(fb, m, v, {
      compartment: compartments ? dataCompartment(m, shacl, v, 6) : null,
      group: groupBy ? groupBy.of(v) : null,
      focus: highlight.has(v),
      faded: false,
    });
  }
  let dropped = 0;
  const edge = (a, b, l, s) => {
    if (fb.size >= maxEdges) return void dropped++;
    fb.edge(a, b, l, s);
  };
  const ensure = (v) => {
    if (fb.has(v)) return true;
    if (groupBy) return false; // overview: do not pull in classes outside the selection
    addClass(fb, m, v, { faded: true });
    return true;
  };
  for (const v of classIris) {
    const c = m.classes.get(v);
    if (!c) continue;
    for (const s of [...c.superClasses, ...c.impliedSuper]) if (ensure(s)) edge(v, s, '', 'sub');
  }
  for (const p of m.properties.values()) {
    if (p.isDataLike || p.propertyKind === 'annotation') continue;
    const ds = domainTargets(p).filter((d) => inSet.has(d.iri));
    const rs = rangeTargets(p);
    if (!ds.length) continue;
    for (const d of ds) {
      for (const r of rs) {
        if (!inSet.has(r.iri) && (groupBy || m.concepts.has(r.iri))) continue;
        if (!ensure(r.iri)) continue;
        edge(d.iri, r.iri, shortName(m, p.iri), d.logical && r.logical ? 'solid' : 'dashed');
      }
    }
  }
  // properties from outside the set into it (module page only)
  if (!groupBy) {
    for (const p of m.properties.values()) {
      if (p.isDataLike || p.propertyKind === 'annotation') continue;
      const rs = rangeTargets(p).filter((r) => inSet.has(r.iri));
      if (!rs.length) continue;
      for (const d of domainTargets(p)) {
        if (inSet.has(d.iri)) continue;
        if (!m.classes.has(d.iri)) continue;
        ensure(d.iri);
        for (const r of rs) edge(d.iri, r.iri, shortName(m, p.iri), d.logical && r.logical ? 'solid' : 'dashed');
      }
    }
  }
  return { src: fb.toString(), edges: fb.size, nodes: fb.nodes.size, dropped };
}

// ---------- property page ----------

export function propertyDiagram(m, prop) {
  const fb = new Flow('LR');
  const pk = `prop:${prop.iri}`;
  const label = `<span class='mm-nm'>${mtext(shortName(m, prop.iri))}</span>${
    prop.characteristics.length ? `<span class='mm-cmp'>${prop.characteristics.map(mtext).join(', ')}</span>` : ''
  }`;
  fb.node(pk, label, { shape: 'round', cls: 'prop' });
  const doms = domainTargets(prop);
  const rans = rangeTargets(prop);
  if (!doms.length) fb.node('dom:any', `<span class='mm-nm'>owl:Thing</span>`, { cls: 'ext', tip: 'no domain declared' });
  for (const d of doms) addClass(fb, m, d.iri);
  for (const d of doms.length ? doms : [{ iri: 'dom:any', logical: true }]) fb.edge(d.iri, pk, d.logical ? 'domain' : 'intended domain', d.logical ? 'solid' : 'dashed');
  if (prop.isDataLike) {
    const names = prop.ranges.length ? prop.ranges.map((r) => datatypeName(m, r)) : ['literal'];
    for (const n of names) {
      fb.node(`dt:${n}`, mtext(n), { shape: 'data', cls: 'data' });
      fb.edge(pk, `dt:${n}`, 'range', 'solid');
    }
  } else {
    if (!rans.length) fb.node('ran:any', `<span class='mm-nm'>owl:Thing</span>`, { cls: 'ext', tip: 'no range declared' });
    for (const r of rans) {
      if (m.concepts.has(r.iri)) addConcept(fb, m, r.iri);
      else addClass(fb, m, r.iri);
    }
    for (const r of rans.length ? rans : [{ iri: 'ran:any', logical: true }]) fb.edge(pk, r.iri, r.logical ? 'range' : 'intended range', r.logical ? 'solid' : 'dashed');
  }
  for (const s of prop.superProperties) {
    const sp = m.properties.get(s);
    fb.node(`prop:${s}`, `<span class='mm-nm'>${mtext(shortName(m, s))}</span>`, { shape: 'round', cls: sp?.local ? null : 'ext', href: sp?.local ? `#/property/${sp.key}` : null });
    fb.edge(pk, `prop:${s}`, 'subPropertyOf', 'sub');
  }
  for (const s of prop.inverseOf) {
    const sp = m.properties.get(s);
    fb.node(`prop:${s}`, `<span class='mm-nm'>${mtext(shortName(m, s))}</span>`, { shape: 'round', cls: sp?.local ? null : 'ext', href: sp?.local ? `#/property/${sp.key}` : null });
    fb.edge(pk, `prop:${s}`, 'inverseOf', 'inverse');
  }
  return { src: fb.toString(), edges: fb.size, nodes: fb.nodes.size, dropped: 0 };
}

// ---------- instance diagram ----------

/** Compact display of an instance IRI: CURIE without long UUID runs, e.g. smtgid:oracle-card/d6d72f5f…/face/0 */
export function compactIri(m, v) {
  const c = m.prefixes.curie(v) || v;
  return c.replace(/([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '$1…').replace(/([0-9a-f]{10})[0-9a-f]{6,}/gi, '$1…');
}

/** Short tail of an instance IRI that fits a node (full IRIs are in the Turtle excerpt). */
export function iriTail(m, v) {
  const c = compactIri(m, v);
  const i = c.indexOf(':');
  const pre = i > 0 && !/^https?:/.test(c) ? c.slice(0, i + 1) : '';
  if (!pre) return trunc(c.replace(/^https?:\/\//, ''), 30);
  const segs = c.slice(i + 1).split('/').filter(Boolean);
  let out = segs.pop() || c;
  while (segs.length && out.length + segs[segs.length - 1].length < 26) out = `${segs.pop()}/${out}`;
  return trunc(segs.length ? `…/${out}` : `${pre}${out}`, 30);
}

export function instanceDiagram(m, ex, hood, focusTerm) {
  const fb = new Flow('LR');
  const name = (n) => {
    if (n.label) return trunc(n.label, 40);
    if (n.term.termType === 'BlankNode') return '[ ]';
    return iriTail(m, n.term.value);
  };
  for (const [k, n] of hood.nodes) {
    const t = n.term;
    if (t.termType === 'NamedNode' && m.concepts.has(t.value) && !n.literals.length) {
      addConcept(fb, m, t.value);
      continue;
    }
    const types = n.types.map((x) => shortName(m, x));
    const lits = n.literals
      .filter((l) => !(n.label && l.o.value === n.label && /label|name$/i.test(l.p)))
      .slice(0, 8)
      .map(({ p, o }) => `${mtext(shortName(m, p))} = ${mtext(JSON.stringify(trunc(o.value, 38)))}`);
    if (n.truncated) lits.push('<i>…</i>');
    let label = `<span class='mm-nm'>${mtext(name(n))}</span>`;
    if (types.length) label += `<span class='mm-ty'>: ${mtext(types.join(', '))}</span>`;
    if (n.label && t.termType === 'NamedNode') label += `<span class='mm-ty'>${mtext(iriTail(m, t.value))}</span>`;
    if (lits.length) label += `<span class='mm-cmp'>${lits.join('<br/>')}</span>`;
    const typed = n.types.map((x) => m.classes.get(x)).find((c) => c?.local);
    const bare = n.hop > 0 && !n.types.length && !n.literals.length && !n.label;
    fb.node(k, label, {
      cls: k === focusTerm.value ? 'focus' : bare ? 'ext' : 'inst',
      href: typed ? `#/class/${typed.key}` : null,
      tip: typed ? `instance of ${typed.label}` : null,
    });
  }
  for (const e of hood.edges) fb.edge(e.from, e.to, shortName(m, e.p), 'solid');
  return { src: fb.toString(), edges: fb.size, nodes: fb.nodes.size, dropped: 0 };
}
