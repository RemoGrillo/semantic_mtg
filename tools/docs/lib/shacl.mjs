// Extract SHACL node/property shapes into a documentation-friendly structure.
import { Graph, NS } from './rdf.mjs';

const SH = NS.sh;
const { rdf, rdfs, owl } = NS;

/** sh:path → { kind, ... } (predicate | inverse | sequence | alternative | zeroOrMore | oneOrMore | zeroOrOne) */
function parsePath(g, node, depth = 0) {
  if (!node || depth > 8) return { kind: 'unknown' };
  if (node.termType === 'NamedNode') return { kind: 'predicate', iri: node.value };
  const seq = g.list(node);
  if (seq && seq.length) return { kind: 'sequence', items: seq.map((x) => parsePath(g, x, depth + 1)) };
  const one = (p) => g.objects(node, SH + p)[0];
  let t;
  if ((t = one('inversePath'))) return { kind: 'inverse', item: parsePath(g, t, depth + 1) };
  if ((t = one('alternativePath'))) return { kind: 'alternative', items: (g.list(t) || []).map((x) => parsePath(g, x, depth + 1)) };
  if ((t = one('zeroOrMorePath'))) return { kind: 'zeroOrMore', item: parsePath(g, t, depth + 1) };
  if ((t = one('oneOrMorePath'))) return { kind: 'oneOrMore', item: parsePath(g, t, depth + 1) };
  if ((t = one('zeroOrOnePath'))) return { kind: 'zeroOrOne', item: parsePath(g, t, depth + 1) };
  return { kind: 'unknown' };
}

const FACETS = ['minInclusive', 'maxInclusive', 'minExclusive', 'maxExclusive', 'minLength', 'maxLength', 'pattern', 'flags', 'languageIn', 'uniqueLang', 'equals', 'disjoint', 'lessThan', 'lessThanOrEquals'];

function constraintsOf(g, node) {
  const one = (p) => g.objects(node, SH + p)[0];
  const num = (p) => {
    const v = one(p);
    return v ? Number(v.value) : null;
  };
  const c = {
    min: num('minCount'),
    max: num('maxCount'),
    classes: g.iris(node, SH + 'class'),
    datatype: one('datatype')?.value || null,
    nodeKind: one('nodeKind')?.value || null,
    in: one('in') ? g.list(one('in')) || [] : null,
    hasValue: g.objects(node, SH + 'hasValue'),
    node: g.objects(node, SH + 'node').map((x) => x.value),
    qualified: null,
    or: one('or') ? (g.list(one('or')) || []).map((x) => constraintsOf(g, x)) : null,
    facets: {},
    message: g.literal(node, SH + 'message'),
    name: g.literal(node, SH + 'name'),
    description: g.literal(node, SH + 'description'),
    severity: (one('severity')?.value || '').replace(SH, '') || null,
    deactivated: one('deactivated')?.value === 'true',
    sparql: g.objects(node, SH + 'sparql').length > 0,
  };
  for (const f of FACETS) {
    const vals = g.objects(node, SH + f);
    if (vals.length) c.facets[f] = vals.map((v) => v.value).join(', ');
  }
  const qvs = one('qualifiedValueShape');
  if (qvs) {
    c.qualified = {
      shape: constraintsOf(g, qvs),
      min: num('qualifiedMinCount'),
      max: num('qualifiedMaxCount'),
    };
  }
  return c;
}

export function extractShapes(files, warn = () => {}) {
  const g = new Graph();
  for (const f of files) if (f.quads) g.addAll(f.quads);
  const nodeShapes = new Set();
  for (const s of g.subjects(rdf + 'type', SH + 'NodeShape')) nodeShapes.add(s);
  for (const p of ['targetClass', 'targetNode', 'targetSubjectsOf', 'targetObjectsOf', 'property']) {
    for (const q of g.quads(null, SH + p, null)) nodeShapes.add(q.subject);
  }
  const byClass = new Map();
  const byProperty = new Map();
  const shapes = [];
  const seen = new Set();
  for (const s of nodeShapes) {
    if (seen.has(s.value)) continue;
    seen.add(s.value);
    // property shapes that are themselves the object of sh:property are handled below
    if (g.quads(null, SH + 'property', s).length && !g.objects(s, SH + 'targetClass').length) continue;
    const targets = new Set(g.iris(s, SH + 'targetClass'));
    // implicit class targets: a shape that is also an rdfs:Class / owl:Class
    if (g.isA(s, rdfs + 'Class') || g.isA(s, owl + 'Class')) targets.add(s.value);
    const shape = {
      id: s.termType === 'NamedNode' ? s.value : null,
      targets: [...targets],
      targetSubjectsOf: g.iris(s, SH + 'targetSubjectsOf'),
      targetObjectsOf: g.iris(s, SH + 'targetObjectsOf'),
      targetNodes: g.values(s, SH + 'targetNode'),
      closed: g.objects(s, SH + 'closed')[0]?.value === 'true',
      ignored: (g.list(g.objects(s, SH + 'ignoredProperties')[0]) || []).map((x) => x.value),
      own: constraintsOf(g, s),
      properties: [],
    };
    for (const ps of g.objects(s, SH + 'property')) {
      const path = parsePath(g, g.objects(ps, SH + 'path')[0]);
      const prop = { path, ...constraintsOf(g, ps), id: ps.termType === 'NamedNode' ? ps.value : null };
      shape.properties.push(prop);
      const simple = path.kind === 'predicate' ? path.iri : path.kind === 'inverse' && path.item.kind === 'predicate' ? path.item.iri : null;
      if (simple) {
        if (!byProperty.has(simple)) byProperty.set(simple, []);
        byProperty.get(simple).push({ shape, constraint: prop, inverse: path.kind === 'inverse' });
      }
    }
    shapes.push(shape);
    for (const t of shape.targets) {
      if (!byClass.has(t)) byClass.set(t, []);
      byClass.get(t).push(shape);
    }
  }
  if (!shapes.length && files.some((f) => f.quads?.length)) warn('SHACL: no node shapes found in shapes/*.ttl', 'shacl');
  return { graph: g, shapes, byClass, byProperty };
}
