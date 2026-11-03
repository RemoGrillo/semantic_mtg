// Example instances (ABox) for class pages: pick one, cut its neighbourhood, serialise as Turtle.
import { Writer } from 'n3';
import { Graph, NS } from './rdf.mjs';

const RDF_TYPE = NS.rdf + 'type';
export const LABEL_PREDICATES = [NS.rdfs + 'label', NS.skos + 'prefLabel', NS.smtg + 'name', NS.smtg + 'faceName', NS.dcterms + 'title', NS.smtg + 'notation'];

export function loadExamples(files) {
  const g = new Graph();
  const fileOf = new Map();
  for (const f of files) {
    if (!f.quads) continue;
    g.addAll(f.quads);
    for (const q of f.quads) if (!fileOf.has(q.subject.value)) fileOf.set(q.subject.value, f.rel);
  }
  // class -> instances in first-seen (file) order
  const byType = new Map();
  for (const q of g.order) {
    if (q.predicate.value !== RDF_TYPE || q.object.termType !== 'NamedNode') continue;
    const list = byType.get(q.object.value) || [];
    if (!list.some((t) => t.equals(q.subject))) list.push(q.subject);
    byType.set(q.object.value, list);
  }
  return { graph: g, byType, fileOf };
}

/** Choose the instance to show for class `cls`: docExample, else first direct instance, else of a subclass. */
export function pickInstance(ex, cls, { docExample, subclasses = [] } = {}) {
  if (!ex || !ex.graph.size) return null;
  if (docExample) {
    const hits = ex.graph.quads(docExample, null, null);
    if (hits.length) return { node: hits[0].subject, via: 'docExample' };
  }
  const list = ex.byType.get(cls) || [];
  const direct = list.find((n) => n.termType === 'NamedNode') || list[0];
  if (direct) return { node: direct, via: 'type' };
  for (const sub of subclasses) {
    const n = (ex.byType.get(sub) || [])[0];
    if (n) return { node: n, via: 'subclass', subclass: sub };
  }
  return null;
}

export function labelOf(g, term) {
  for (const p of LABEL_PREDICATES) {
    const v = g.literal(term, p);
    if (v) return v;
  }
  return null;
}

/**
 * The focus instance's 1-hop neighbourhood (outgoing first, then a few incoming edges), with each
 * neighbour's types, label and a few literals. Neighbours that are *parts* of the focus (IRI extends
 * the focus IRI, e.g. …/face/0 → …/face/0/mana-cost) and blank nodes are expanded one more level.
 * Returns { nodes: Map(id -> {term, types, literals, hop, truncated}), edges: [{from, p, to}], quads }.
 */
export function neighbourhood(ex, focus, { maxEdges = 25, maxIncoming = 6, maxLiterals = 8 } = {}) {
  const g = ex.graph;
  const nodes = new Map();
  const edges = [];
  const quads = [];
  const quadKeys = new Set();
  const addQuad = (q) => {
    const k = `${q.subject.value}|${q.predicate.value}|${q.object.value}`;
    if (!quadKeys.has(k)) {
      quadKeys.add(k);
      quads.push(q);
    }
  };
  const describe = (term, hop) => {
    if (nodes.has(term.value)) return nodes.get(term.value);
    const n = { term, types: [], literals: [], hop, truncated: false, label: labelOf(g, term) };
    for (const q of g.quads(term, RDF_TYPE, null)) if (q.object.termType === 'NamedNode') n.types.push(q.object.value);
    nodes.set(term.value, n);
    return n;
  };
  const isPart = (t) => t.termType === 'BlankNode' || (t.termType === 'NamedNode' && t.value.startsWith(focus.value + '/'));
  const expand = (term, hop, budgetLiterals) => {
    const node = describe(term, hop);
    const out = [];
    for (const q of g.quads(term, null, null)) {
      if (q.predicate.value === RDF_TYPE) {
        addQuad(q);
        continue;
      }
      if (q.object.termType === 'Literal') {
        if (node.literals.length < budgetLiterals) {
          node.literals.push({ p: q.predicate.value, o: q.object });
          addQuad(q);
        } else node.truncated = true;
        continue;
      }
      out.push(q);
    }
    return { node, out };
  };
  const { node: fnode, out } = expand(focus, 0, maxLiterals);
  const second = [];
  for (const q of out) {
    if (edges.length >= maxEdges) {
      fnode.truncated = true;
      break;
    }
    addQuad(q);
    const nb = describe(q.object, 1);
    edges.push({ from: focus.value, p: q.predicate.value, to: q.object.value });
    for (const t of g.quads(q.object, RDF_TYPE, null)) addQuad(t);
    for (const p of LABEL_PREDICATES) for (const t of g.quads(q.object, p, null)) addQuad(t);
    if (isPart(q.object)) second.push(q.object);
    void nb;
  }
  // parts and blank nodes: their literals and outgoing edges (one more level, no further)
  for (const t of second) {
    const { node, out: o2 } = expand(t, 1, 4);
    for (const q of o2) {
      if (edges.length >= maxEdges) {
        node.truncated = true;
        break;
      }
      addQuad(q);
      describe(q.object, 2);
      for (const x of g.quads(q.object, RDF_TYPE, null)) addQuad(x);
      edges.push({ from: t.value, p: q.predicate.value, to: q.object.value });
    }
  }
  // a few incoming edges (e.g. printings pointing at an Oracle card), picked round-robin across
  // predicates (at most 2 per predicate) so that one busy predicate (legalityOf ×23) does not
  // crowd out the others (isPrintingOf, assignmentTarget, usesCard …)
  const byPred = new Map();
  for (const q of g.quads(null, null, focus)) {
    if (!byPred.has(q.predicate.value)) byPred.set(q.predicate.value, []);
    byPred.get(q.predicate.value).push(q);
  }
  const incoming = [];
  for (let round = 0; round < 2; round++) for (const list of byPred.values()) if (list[round]) incoming.push(list[round]);
  let inc = 0;
  for (const q of incoming) {
    if (inc >= maxIncoming || edges.length >= maxEdges) break;
    if (nodes.has(q.subject.value) && edges.some((e) => e.from === q.subject.value && e.to === focus.value)) continue;
    if (edges.some((e) => e.from === focus.value && e.to === q.subject.value)) continue; // inverse already drawn
    describe(q.subject, 1);
    addQuad(q);
    for (const t of g.quads(q.subject, RDF_TYPE, null)) addQuad(t);
    for (const p of LABEL_PREDICATES) for (const t of g.quads(q.subject, p, null)) addQuad(t);
    edges.push({ from: q.subject.value, p: q.predicate.value, to: focus.value });
    inc++;
  }
  return { nodes, edges, quads };
}

/** Serialise quads as pretty Turtle with n3's Writer: blank nodes referenced once are nested as [ … ]. */
export function toTurtle(quads, prefixes, { focus = null } = {}) {
  const iris = new Set();
  for (const q of quads) {
    for (const t of [q.subject, q.predicate, q.object]) if (t.termType === 'NamedNode') iris.add(t.value);
    if (q.object.termType === 'Literal' && q.object.datatype) iris.add(q.object.datatype.value);
  }
  iris.delete(RDF_TYPE); // written as `a`
  const writer = new Writer({ prefixes: prefixes.subsetFor(iris) });
  const bySubject = new Map();
  for (const q of quads) {
    const k = q.subject.value;
    if (!bySubject.has(k)) bySubject.set(k, { term: q.subject, quads: [] });
    bySubject.get(k).quads.push(q);
  }
  const refCount = new Map();
  for (const q of quads) if (q.object.termType === 'BlankNode') refCount.set(q.object.value, (refCount.get(q.object.value) || 0) + 1);
  const nestable = (t) => t.termType === 'BlankNode' && refCount.get(t.value) === 1 && bySubject.has(t.value);
  const nested = new Set();
  const sortPO = (qs) => [...qs].sort((a, b) => (a.predicate.value === RDF_TYPE ? -1 : b.predicate.value === RDF_TYPE ? 1 : 0));
  const objectFor = (o, depth = 0) => {
    if (nestable(o) && depth < 6 && !nested.has(o.value)) {
      nested.add(o.value);
      const entry = bySubject.get(o.value);
      return writer.blank(sortPO(entry.quads).map((q) => ({ predicate: q.predicate, object: objectFor(q.object, depth + 1) })));
    }
    return o;
  };
  // focus first, then other named subjects (in given order), then un-nestable blank nodes
  const subjects = [...bySubject.values()];
  const ordered = [
    ...subjects.filter((s) => focus && s.term.value === focus.value),
    ...subjects.filter((s) => s.term.termType !== 'BlankNode' && !(focus && s.term.value === focus.value)),
    ...subjects.filter((s) => s.term.termType === 'BlankNode'),
  ];
  for (const s of ordered) {
    if (s.term.termType === 'BlankNode' && (nested.has(s.term.value) || nestable(s.term))) continue;
    for (const q of sortPO(s.quads)) writer.addQuad(s.term, q.predicate, objectFor(q.object));
  }
  let out = '';
  writer.end((err, res) => {
    if (err) throw err;
    out = res;
  });
  return prettify(out);
}

// n3 writes "a b c." – add the conventional space before the final dot and use `a` for rdf:type.
function prettify(ttl) {
  return ttl
    .replace(/<http:\/\/www\.w3\.org\/1999\/02\/22-rdf-syntax-ns#type>/g, 'a')
    .replace(/(^|\s)rdf:type(?=\s)/g, '$1a')
    .replace(/([^\s.])\.\n/g, '$1 .\n')
    .replace(/;\n/g, ' ;\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
