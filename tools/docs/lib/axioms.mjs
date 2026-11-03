// OWL class / property expressions: parse blank-node structures into plain objects,
// and query them (named classes mentioned, restrictions...). Rendering lives in render/common.mjs.
import { NS } from './rdf.mjs';

const O = NS.owl;
const R = NS.rdf;

/**
 * Expression shapes:
 *   { type: 'named', iri }
 *   { type: 'some'|'only', prop, filler }
 *   { type: 'value', prop, value: Term }
 *   { type: 'min'|'max'|'exactly', prop, n, filler|null }
 *   { type: 'self', prop }
 *   { type: 'and'|'or', ops: [...] }
 *   { type: 'not', op }
 *   { type: 'oneOf', items: [Term] }
 *   { type: 'datatype', base: iri|null, facets: [{ facet, value: Term }] }
 *   { type: 'unknown', id }
 * Property expressions: { type: 'named', iri } | { type: 'inverse', iri }
 */
export function parseExpr(g, term, depth = 0) {
  if (!term) return { type: 'unknown', id: '?' };
  if (term.termType === 'NamedNode') return { type: 'named', iri: term.value };
  if (depth > 12) return { type: 'unknown', id: term.value };
  const one = (p) => g.objects(term, p)[0];
  const sub = (t) => parseExpr(g, t, depth + 1);

  const inter = one(O + 'intersectionOf');
  if (inter) return { type: 'and', ops: (g.list(inter) || []).map(sub) };
  const uni = one(O + 'unionOf');
  if (uni) return { type: 'or', ops: (g.list(uni) || []).map(sub) };
  const comp = one(O + 'complementOf') || one(O + 'datatypeComplementOf');
  if (comp) return { type: 'not', op: sub(comp) };
  const oneOf = one(O + 'oneOf');
  if (oneOf) return { type: 'oneOf', items: g.list(oneOf) || [] };

  const onProp = one(O + 'onProperty');
  if (onProp) {
    const prop = parsePropExpr(g, onProp);
    const filler = one(O + 'onClass') || one(O + 'onDataRange');
    const fillerExpr = filler ? sub(filler) : null;
    const num = (p) => {
      const v = one(O + p);
      return v ? Number(v.value) : null;
    };
    let t;
    if ((t = one(O + 'someValuesFrom'))) return { type: 'some', prop, filler: sub(t) };
    if ((t = one(O + 'allValuesFrom'))) return { type: 'only', prop, filler: sub(t) };
    if ((t = one(O + 'hasValue'))) return { type: 'value', prop, value: t };
    if ((t = one(O + 'hasSelf'))) return { type: 'self', prop };
    for (const [p, ty] of [
      ['minQualifiedCardinality', 'min'],
      ['maxQualifiedCardinality', 'max'],
      ['qualifiedCardinality', 'exactly'],
      ['minCardinality', 'min'],
      ['maxCardinality', 'max'],
      ['cardinality', 'exactly'],
    ]) {
      const n = num(p);
      if (n != null) return { type: ty, prop, n, filler: fillerExpr };
    }
    return { type: 'unknown', id: term.value };
  }

  const onDatatype = one(O + 'onDatatype');
  if (onDatatype) {
    const facets = [];
    for (const f of g.list(one(O + 'withRestrictions')) || []) {
      for (const q of g.quads(f, null, null)) facets.push({ facet: q.predicate.value, value: q.object });
    }
    return { type: 'datatype', base: onDatatype.value, facets };
  }
  // A typed but otherwise empty owl:Class / rdfs:Datatype node, or an unsupported construct.
  return { type: 'unknown', id: term.value };
}

export function parsePropExpr(g, term) {
  if (term.termType === 'NamedNode') return { type: 'named', iri: term.value };
  const inv = g.objects(term, O + 'inverseOf')[0];
  if (inv && inv.termType === 'NamedNode') return { type: 'inverse', iri: inv.value };
  return { type: 'named', iri: term.value };
}

/** Named classes that a domain/range expression "covers" (named, union members, intersection operands). */
export function coveredClasses(expr) {
  if (!expr) return [];
  if (expr.type === 'named') return [expr.iri];
  if (expr.type === 'or' || expr.type === 'and') return expr.ops.flatMap(coveredClasses);
  return [];
}

/** All named IRIs mentioned anywhere in an expression (classes, properties, values). */
export function mentioned(expr, out = new Set()) {
  if (!expr) return out;
  switch (expr.type) {
    case 'named':
      out.add(expr.iri);
      break;
    case 'and':
    case 'or':
      expr.ops.forEach((e) => mentioned(e, out));
      break;
    case 'not':
      mentioned(expr.op, out);
      break;
    case 'some':
    case 'only':
    case 'min':
    case 'max':
    case 'exactly':
      out.add(expr.prop.iri);
      if (expr.filler) mentioned(expr.filler, out);
      break;
    case 'value':
    case 'self':
      out.add(expr.prop.iri);
      if (expr.value?.termType === 'NamedNode') out.add(expr.value.value);
      break;
    case 'oneOf':
      expr.items.forEach((t) => t.termType === 'NamedNode' && out.add(t.value));
      break;
    case 'datatype':
      if (expr.base) out.add(expr.base);
      break;
  }
  return out;
}

/** Restrictions directly reachable as conjuncts (subClassOf X, or operands of an intersection). */
export function conjunctRestrictions(expr) {
  if (!expr) return [];
  if (expr.type === 'and') return expr.ops.flatMap(conjunctRestrictions);
  if (['some', 'only', 'min', 'max', 'exactly', 'value', 'self'].includes(expr.type)) return [expr];
  return [];
}

/** Named conjuncts of an expression (for "C ≡ A and (p some B)" → [A]). */
export function namedConjuncts(expr) {
  if (!expr) return [];
  if (expr.type === 'named') return [expr.iri];
  if (expr.type === 'and') return expr.ops.filter((e) => e.type === 'named').map((e) => e.iri);
  return [];
}

export function cardinalityText(r) {
  switch (r.type) {
    case 'some':
      return 'some';
    case 'only':
      return 'only';
    case 'min':
      return `min ${r.n}`;
    case 'max':
      return `max ${r.n}`;
    case 'exactly':
      return `exactly ${r.n}`;
    case 'value':
      return 'value';
    case 'self':
      return 'Self';
    default:
      return '';
  }
}
