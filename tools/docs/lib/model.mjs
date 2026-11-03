// Build the documentation model (modules, classes, properties, vocabularies...) from RDF graphs.
// Everything is defensive: partial or inconsistent ontologies must still produce a model.
import { Graph, NS, localName, toTerm } from './rdf.mjs';
import { parseExpr, parsePropExpr, coveredClasses, namedConjuncts } from './axioms.mjs';

const { rdf, rdfs, owl, skos, dcterms, vs, smtg, smtgm, smtgv } = NS;

const CHARACTERISTICS = {
  [owl + 'FunctionalProperty']: 'Functional',
  [owl + 'InverseFunctionalProperty']: 'InverseFunctional',
  [owl + 'TransitiveProperty']: 'Transitive',
  [owl + 'SymmetricProperty']: 'Symmetric',
  [owl + 'AsymmetricProperty']: 'Asymmetric',
  [owl + 'ReflexiveProperty']: 'Reflexive',
  [owl + 'IrreflexiveProperty']: 'Irreflexive',
};
const PROPERTY_TYPES = {
  [owl + 'ObjectProperty']: 'object',
  [owl + 'DatatypeProperty']: 'datatype',
  [owl + 'AnnotationProperty']: 'annotation',
  [rdf + 'Property']: 'property',
  [owl + 'OntologyProperty']: 'annotation',
};
const STATUS_VALUES = ['stable-draft', 'unstable', 'proposal', 'deprecated', 'testing', 'stable', 'archaic'];

// Predicates rendered explicitly somewhere; everything else literal-valued shows as "other annotations".
const KNOWN_PREDICATES = new Set(
  [
    rdf + 'type', rdfs + 'label', rdfs + 'comment', rdfs + 'isDefinedBy', rdfs + 'subClassOf', rdfs + 'subPropertyOf',
    rdfs + 'domain', rdfs + 'range', rdfs + 'seeAlso',
    owl + 'equivalentClass', owl + 'disjointWith', owl + 'inverseOf', owl + 'propertyChainAxiom', owl + 'deprecated',
    owl + 'equivalentProperty', owl + 'propertyDisjointWith', owl + 'hasKey', owl + 'disjointUnionOf', owl + 'versionInfo',
    owl + 'imports', owl + 'versionIRI', owl + 'priorVersion',
    skos + 'definition', skos + 'scopeNote', skos + 'example', skos + 'prefLabel', skos + 'altLabel', skos + 'notation',
    skos + 'inScheme', skos + 'broader', skos + 'narrower', skos + 'topConceptOf', skos + 'hasTopConcept',
    vs + 'term_status', dcterms + 'title', dcterms + 'description',
    smtg + 'sourceField', smtg + 'reviewQuestion', smtg + 'antiPattern', smtg + 'docExample', smtg + 'intendedDomain',
    smtg + 'intendedRange', smtg + 'symbol', smtg + 'moduleOrder', smtg + 'conceptClass', smtg + 'replacesTerm',
    smtg + 'proposalOf', smtg + 'proposalKind',
  ].filter(Boolean),
);

export function isLocalIri(v) {
  return v.startsWith(smtg) || v.startsWith(smtgv) || v.startsWith(smtgm) || v.startsWith(NS.smtgid);
}

function normStatus(s) {
  if (!s) return null;
  const v = String(s).trim().toLowerCase().replace(/^.*[#/]/, '');
  return STATUS_VALUES.includes(v) ? v : v || null;
}

/** Route-safe key for a term: local name for our namespace, CURIE otherwise. */
function makeKeyer(prefixes) {
  const used = new Map(); // key -> iri
  return (iriValue, scope) => {
    let base;
    if (iriValue.startsWith(smtg)) base = iriValue.slice(smtg.length);
    else if (scope === 'vocab' && iriValue.startsWith(smtgv)) base = iriValue.slice(smtgv.length);
    else if (scope === 'module' && iriValue.startsWith(smtgm)) base = iriValue.slice(smtgm.length);
    else base = prefixes.curie(iriValue) || localName(iriValue);
    base = base.replace(/[^A-Za-z0-9_.:\-/]+/g, '-').replace(/^[-/]+|[-/]+$/g, '') || 'term';
    if (scope === 'module') base = base.replace(/\//g, '-');
    let key = base;
    let n = 2;
    const scoped = (k) => `${scope}|${k}`;
    while (used.has(scoped(key)) && used.get(scoped(key)) !== iriValue) key = `${base}-${n++}`;
    used.set(scoped(key), iriValue);
    return key;
  };
}

/**
 * @param {object} opts
 * @param {Array} opts.files  parsed ontology files: { rel, kind, text, quads, prefixes, error }
 * @param {Prefixes} opts.prefixes
 * @param {Function} opts.warn
 */
export function buildModel({ files, prefixes, warn = () => {}, keyer = null }) {
  const g = new Graph();
  const fileOfSubject = new Map(); // iri -> first file rel declaring it as subject
  for (const f of files) {
    if (!f.quads) continue;
    g.addAll(f.quads);
    for (const q of f.quads) {
      if (q.subject.termType === 'NamedNode' && !fileOfSubject.has(q.subject.value)) fileOfSubject.set(q.subject.value, f.rel);
    }
  }
  const key = keyer || makeKeyer(prefixes);
  const m = {
    graph: g,
    prefixes,
    files,
    modules: new Map(),
    classes: new Map(),
    properties: new Map(),
    individuals: new Map(),
    schemes: new Map(),
    concepts: new Map(),
    terms: new Map(), // every documented resource by IRI
    byKey: { class: new Map(), property: new Map(), individual: new Map(), vocab: new Map(), module: new Map() },
    fileOfSubject,
    key,
  };

  // ---------- modules ----------
  for (const s of g.subjects(rdf + 'type', owl + 'Ontology')) {
    if (s.termType !== 'NamedNode') continue;
    const v = s.value;
    const file = files.find((f) => f.quads?.some((q) => q.subject.equals(s) && q.predicate.value === rdf + 'type'));
    const id = v.replace(/[#/]+$/, '') === (smtgm.replace(/\/$/, '')) ? 'smtg' : key(v, 'module');
    const order = Number(g.literal(s, smtg + 'moduleOrder'));
    const mod = {
      iri: v,
      id,
      kind: file?.kind === 'vocab' ? 'vocab' : file?.kind === 'view' ? 'view' : file?.kind === 'proposal' ? 'proposal' : 'module',
      label: g.literal(s, rdfs + 'label') || g.literal(s, dcterms + 'title') || localName(v),
      title: g.literal(s, dcterms + 'title'),
      description: g.literal(s, dcterms + 'description') || g.literal(s, rdfs + 'comment'),
      version: g.literal(s, owl + 'versionInfo'),
      versionIri: g.iris(s, owl + 'versionIRI')[0],
      order: Number.isFinite(order) ? order : 999,
      status: normStatus(g.literal(s, vs + 'term_status')),
      imports: g.iris(s, owl + 'imports'),
      file: file?.rel,
      creators: g.values(s, dcterms + 'creator'),
      proposalOf: g.iris(s, smtg + 'proposalOf'),
      proposalKind: g.literal(s, smtg + 'proposalKind'),
      terms: [],
    };
    m.modules.set(v, mod);
    m.byKey.module.set(id, mod);
  }
  const moduleOfFile = new Map();
  for (const mod of m.modules.values()) if (mod.file && !moduleOfFile.has(mod.file)) moduleOfFile.set(mod.file, mod.iri);

  // ---------- helpers ----------
  const typesOf = (s) => g.types(s);
  const conceptClasses = new Set([skos + 'Concept']);
  {
    // classes that are (transitively) rdfs:subClassOf skos:Concept, plus smtg:conceptClass of schemes
    let grew = true;
    while (grew) {
      grew = false;
      for (const q of g.quads(null, rdfs + 'subClassOf', null)) {
        if (conceptClasses.has(q.object.value) && q.subject.termType === 'NamedNode' && !conceptClasses.has(q.subject.value)) {
          conceptClasses.add(q.subject.value);
          grew = true;
        }
      }
    }
    for (const q of g.quads(null, smtg + 'conceptClass', null)) conceptClasses.add(q.object.value);
  }
  const moduleFor = (s) => {
    const defs = g.iris(s, rdfs + 'isDefinedBy');
    const known = defs.find((d) => m.modules.has(d));
    if (known) return known;
    if (defs[0]) return defs[0];
    const f = fileOfSubject.get(s.value ?? s);
    return f ? moduleOfFile.get(f) || null : null;
  };
  const otherAnnotations = (s) => {
    const out = [];
    for (const q of g.quads(s, null, null)) {
      if (KNOWN_PREDICATES.has(q.predicate.value)) continue;
      if (q.object.termType === 'BlankNode') continue;
      out.push({ p: q.predicate.value, o: q.object });
    }
    return out;
  };
  const baseTerm = (s, kind) => {
    const v = s.value;
    const status = normStatus(g.literal(s, vs + 'term_status'));
    const deprecated = g.values(s, owl + 'deprecated').some((x) => x === 'true' || x === '1') || status === 'deprecated';
    const t = {
      iri: v,
      kind,
      curie: prefixes.shorten(v),
      label: g.literal(s, rdfs + 'label') || g.literal(s, skos + 'prefLabel') || localName(v),
      definition: g.literal(s, skos + 'definition'),
      comments: g.literals(s, rdfs + 'comment'),
      scopeNotes: g.literals(s, skos + 'scopeNote'),
      examples: g.literals(s, skos + 'example'),
      status: status || (deprecated ? 'deprecated' : null),
      deprecated,
      module: moduleFor(s),
      sourceFields: g.values(s, smtg + 'sourceField').sort(),
      reviewQuestions: g.values(s, smtg + 'reviewQuestion').map(String).sort(),
      antiPatterns: g.values(s, smtg + 'antiPattern').map(String).sort(),
      docExample: g.iris(s, smtg + 'docExample')[0] || null,
      seeAlso: g.values(s, rdfs + 'seeAlso'),
      replaces: g.iris(s, smtg + 'replacesTerm'),
      other: otherAnnotations(s),
      // bare re-declarations of reused vocabularies (e.g. `prov:Entity a owl:Class .`) are not SMTG terms
      local: isLocalIri(v) || g.iris(s, rdfs + 'isDefinedBy').some((d) => m.modules.has(d)),
      file: fileOfSubject.get(v) || null,
    };
    return t;
  };
  const register = (t, keyScope) => {
    t.key = key(t.iri, keyScope);
    m.terms.set(t.iri, t);
    m.byKey[keyScope].set(t.key, t);
    const mod = t.module && m.modules.get(t.module);
    if (mod) mod.terms.push(t.iri);
    return t;
  };

  // ---------- schemes & concepts first (so they are not mistaken for individuals) ----------
  for (const s of g.subjects(rdf + 'type', skos + 'ConceptScheme')) {
    if (s.termType !== 'NamedNode') continue;
    const t = baseTerm(s, 'scheme');
    t.conceptClass = g.iris(s, smtg + 'conceptClass')[0] || null;
    t.concepts = [];
    t.topConcepts = g.iris(s, skos + 'hasTopConcept');
    register(t, 'vocab');
    m.schemes.set(t.iri, t);
  }
  const conceptSubjects = new Set();
  for (const q of g.quads(null, skos + 'inScheme', null)) if (q.subject.termType === 'NamedNode') conceptSubjects.add(q.subject.value);
  for (const c of conceptClasses) {
    for (const s of g.subjects(rdf + 'type', c)) if (s.termType === 'NamedNode') conceptSubjects.add(s.value);
  }
  for (const v of conceptSubjects) {
    if (m.schemes.has(v)) continue;
    const subj = toTerm(v);
    const t = baseTerm(subj, 'concept');
    t.prefLabel = g.literal(subj, skos + 'prefLabel');
    t.label = t.prefLabel || t.label;
    t.altLabels = g.literals(subj, skos + 'altLabel');
    t.notations = g.values(subj, skos + 'notation');
    t.schemes = g.iris(subj, skos + 'inScheme');
    t.broader = g.iris(subj, skos + 'broader');
    t.narrower = g.iris(subj, skos + 'narrower');
    t.symbol = g.literal(subj, smtg + 'symbol') || null;
    t.types = typesOf(subj).filter((x) => x !== skos + 'Concept' && x !== owl + 'NamedIndividual');
    t.key = v; // concepts are addressed via their scheme (#/vocab/<scheme>/<concept>)
    m.terms.set(v, t);
    m.concepts.set(v, t);
  }
  // attach concepts to schemes; orphans (no inScheme) go to a pseudo-scheme per concept class
  for (const c of m.concepts.values()) {
    let schemes = c.schemes.filter((x) => m.schemes.has(x));
    if (!schemes.length) {
      const byClass = [...m.schemes.values()].find((sc) => sc.conceptClass && c.types.includes(sc.conceptClass));
      if (byClass) schemes = [byClass.iri];
    }
    if (!schemes.length) {
      const pseudoIri = (c.types[0] || skos + 'Concept') + '#__scheme';
      if (!m.schemes.has(pseudoIri)) {
        const cls = c.types[0] || skos + 'Concept';
        const t = {
          iri: pseudoIri, kind: 'scheme', curie: prefixes.shorten(cls), label: `${localName(cls)} (no concept scheme)`,
          definition: `Concepts typed ${prefixes.shorten(cls)} that declare no skos:inScheme.`, comments: [], scopeNotes: [],
          examples: [], status: null, module: null, sourceFields: [], reviewQuestions: [], antiPatterns: [], other: [],
          seeAlso: [], replaces: [], local: true, conceptClass: cls, concepts: [], topConcepts: [], pseudo: true,
        };
        register(t, 'vocab');
        m.schemes.set(pseudoIri, t);
      }
      schemes = [pseudoIri];
    }
    c.schemes = schemes;
    for (const sc of schemes) m.schemes.get(sc).concepts.push(c.iri);
  }
  for (const c of m.concepts.values()) {
    for (const b of c.broader) {
      const bc = m.concepts.get(b);
      if (bc && !bc.narrower.includes(c.iri)) bc.narrower.push(c.iri);
    }
    const sc = m.schemes.get(c.schemes[0]);
    c.schemeKey = sc?.key;
    const n = c.notations[0] || localName(c.iri);
    c.anchor = String(n).replace(/[^A-Za-z0-9_.\-]+/g, '_');
  }
  // Colour codes (W, U, B, R, G, C and combinations such as WUB) sort in the conventional
  // order: by number of colours, then WUBRG — so C, W, U, B, R, G, WU, WB, … WUBRG.
  const WUBRG = 'WUBRG';
  const colourKey = (n) => (/^(C|[WUBRG]{1,5})$/.test(n) ? (n === 'C' ? [0] : [n.length, ...[...n].map((ch) => WUBRG.indexOf(ch))]) : null);
  for (const sc of m.schemes.values()) {
    sc.concepts.sort((a, b) => {
      const A = m.concepts.get(a);
      const B = m.concepts.get(b);
      const ka = colourKey(String(A.notations[0] ?? ''));
      const kb = colourKey(String(B.notations[0] ?? ''));
      if (ka && kb) {
        for (let i = 0; i < Math.max(ka.length, kb.length); i++) if ((ka[i] ?? -1) !== (kb[i] ?? -1)) return (ka[i] ?? -1) - (kb[i] ?? -1);
        return 0;
      }
      return String(A.notations[0] ?? A.label).localeCompare(String(B.notations[0] ?? B.label), 'en', { numeric: true });
    });
    // de-duplicate anchors within a scheme
    const seen = new Map();
    for (const ci of sc.concepts) {
      const c = m.concepts.get(ci);
      if (c.schemeKey !== sc.key) continue;
      let a = c.anchor;
      let i = 2;
      while (seen.has(a) && seen.get(a) !== ci) a = `${c.anchor}-${i++}`;
      seen.set(a, ci);
      c.anchor = a;
    }
  }

  // ---------- classes ----------
  const classIris = new Set();
  for (const t of [owl + 'Class', rdfs + 'Class']) {
    for (const s of g.subjects(rdf + 'type', t)) if (s.termType === 'NamedNode') classIris.add(s.value);
  }
  // classes only used in subClassOf/equivalentClass but declared nowhere are still worth a page if local
  for (const q of g.quads(null, rdfs + 'subClassOf', null)) {
    if (q.subject.termType === 'NamedNode' && isLocalIri(q.subject.value)) classIris.add(q.subject.value);
  }
  classIris.delete(owl + 'Thing');
  for (const v of classIris) {
    if (m.concepts.has(v) || m.schemes.has(v)) continue;
    const s = g.quads(v, null, null)[0]?.subject;
    if (!s) continue;
    const t = baseTerm(s, 'class');
    t.superClasses = [];
    t.superExpressions = [];
    for (const o of g.objects(s, rdfs + 'subClassOf')) {
      if (o.termType === 'NamedNode') t.superClasses.push(o.value);
      else t.superExpressions.push(parseExpr(g, o));
    }
    t.equivalents = [];
    for (const o of g.objects(s, owl + 'equivalentClass')) t.equivalents.push(parseExpr(g, o));
    for (const o of g.subjects(owl + 'equivalentClass', s)) {
      if (o.termType === 'NamedNode') t.equivalents.push({ type: 'named', iri: o.value });
    }
    t.disjoint = new Set(g.iris(s, owl + 'disjointWith'));
    for (const o of g.subjects(owl + 'disjointWith', s)) if (o.termType === 'NamedNode') t.disjoint.add(o.value);
    t.disjointUnion = (g.list(g.objects(s, owl + 'disjointUnionOf')[0]) || []).map((x) => x.value);
    t.keys = g.objects(s, owl + 'hasKey').map((l) => (g.list(l) || []).map((x) => x.value));
    t.subClasses = [];
    t.impliedSuper = []; // named conjuncts of equivalent intersections
    for (const e of t.equivalents) {
      if (e.type === 'and') for (const n of namedConjuncts(e)) if (n !== v) t.impliedSuper.push(n);
    }
    register(t, 'class');
    m.classes.set(v, t);
  }
  // AllDisjointClasses
  for (const s of g.subjects(rdf + 'type', owl + 'AllDisjointClasses')) {
    const members = (g.list(g.objects(s, owl + 'members')[0]) || []).map((x) => x.value);
    for (const a of members) {
      const ca = m.classes.get(a);
      if (!ca) continue;
      for (const b of members) if (b !== a) ca.disjoint.add(b);
    }
  }
  for (const c of m.classes.values()) {
    c.disjoint = [...c.disjoint].sort();
    for (const sup of c.superClasses) m.classes.get(sup)?.subClasses.push(c.iri);
    for (const sup of c.impliedSuper) {
      const sc = m.classes.get(sup);
      if (sc && !sc.subClasses.includes(c.iri)) sc.subClasses.push(c.iri);
    }
  }

  // ---------- properties ----------
  const propIris = new Map(); // iri -> kind
  for (const [t, kind] of Object.entries(PROPERTY_TYPES)) {
    for (const s of g.subjects(rdf + 'type', t)) {
      if (s.termType !== 'NamedNode') continue;
      const prev = propIris.get(s.value);
      if (!prev || prev === 'property') propIris.set(s.value, kind);
    }
  }
  for (const t of Object.keys(CHARACTERISTICS)) {
    for (const s of g.subjects(rdf + 'type', t)) if (s.termType === 'NamedNode' && !propIris.has(s.value)) propIris.set(s.value, 'object');
  }
  for (const [v, kind] of propIris) {
    if (m.classes.has(v) || m.concepts.has(v)) continue;
    const s = g.quads(v, null, null)[0]?.subject;
    if (!s) continue;
    const t = baseTerm(s, kind);
    t.propertyKind = kind;
    const types = typesOf(s);
    t.characteristics = types.filter((x) => CHARACTERISTICS[x]).map((x) => CHARACTERISTICS[x]);
    t.domains = g.objects(s, rdfs + 'domain').map((o) => parseExpr(g, o));
    t.ranges = g.objects(s, rdfs + 'range').map((o) => parseExpr(g, o));
    t.intendedDomains = g.iris(s, smtg + 'intendedDomain');
    t.intendedRanges = g.iris(s, smtg + 'intendedRange');
    t.superProperties = g.iris(s, rdfs + 'subPropertyOf');
    t.subProperties = [];
    t.equivalentProperties = g.iris(s, owl + 'equivalentProperty');
    t.disjointProperties = g.iris(s, owl + 'propertyDisjointWith');
    const inv = new Set(g.iris(s, owl + 'inverseOf'));
    for (const o of g.subjects(owl + 'inverseOf', s)) if (o.termType === 'NamedNode') inv.add(o.value);
    t.inverseOf = [...inv];
    t.chains = g.objects(s, owl + 'propertyChainAxiom').map((l) => (g.list(l) || []).map((x) => parsePropExpr(g, x)));
    register(t, 'property');
    m.properties.set(v, t);
  }
  for (const pr of m.properties.values()) {
    for (const sup of pr.superProperties) m.properties.get(sup)?.subProperties.push(pr.iri);
    pr.domainClasses = [...new Set(pr.domains.flatMap(coveredClasses))];
    pr.rangeClasses = [...new Set(pr.ranges.flatMap(coveredClasses))];
    // literal-valued?
    pr.isDataLike =
      pr.propertyKind === 'datatype' ||
      pr.rangeClasses.some((r) => r.startsWith(NS.xsd) || r === rdf + 'langString' || r === rdfs + 'Literal') ||
      pr.ranges.some((r) => r.type === 'datatype');
  }

  // ---------- named individuals ----------
  const skipTypes = new Set([owl + 'Ontology', owl + 'AllDisjointClasses', owl + 'AllDifferent', owl + 'Restriction', owl + 'Axiom', skos + 'ConceptScheme']);
  const indivCandidates = new Set();
  for (const s of g.subjects(rdf + 'type', owl + 'NamedIndividual')) if (s.termType === 'NamedNode') indivCandidates.add(s.value);
  for (const q of g.quads(null, rdf + 'type', null)) {
    if (q.subject.termType === 'NamedNode' && m.classes.has(q.object.value) && isLocalIri(q.subject.value)) indivCandidates.add(q.subject.value);
  }
  for (const v of indivCandidates) {
    if (m.terms.has(v) || m.modules.has(v)) continue;
    const s = g.quads(v, null, null)[0]?.subject;
    if (!s) continue;
    const types = typesOf(s).filter((x) => x !== owl + 'NamedIndividual');
    if (types.some((x) => skipTypes.has(x))) continue;
    const t = baseTerm(s, 'individual');
    t.types = types;
    t.assertions = g.quads(s, null, null).filter((q) => q.predicate.value !== rdf + 'type' && !KNOWN_PREDICATES.has(q.predicate.value));
    register(t, 'individual');
    m.individuals.set(v, t);
  }

  // ---------- sanity warnings ----------
  for (const t of [...m.classes.values(), ...m.properties.values()]) {
    if (!t.local) continue;
    if (!t.definition) warn(`${t.curie}: missing skos:definition`, 'annotation');
    if (!t.module) warn(`${t.curie}: no rdfs:isDefinedBy module`, 'annotation');
    else if (!m.modules.has(t.module)) warn(`${t.curie}: rdfs:isDefinedBy ${prefixes.shorten(t.module)} is not a known module`, 'annotation');
  }
  return m;
}

// ---------- queries used by renderers ----------

export function label(m, v) {
  const t = m.terms.get(v);
  return t ? t.label : m.prefixes.shorten(v);
}

/** Ancestors through named superclasses (+ implied from equivalences), nearest first. */
export function ancestors(m, v, seen = new Set()) {
  const c = m.classes.get(v);
  if (!c) return [];
  const out = [];
  for (const s of [...c.superClasses, ...c.impliedSuper]) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s, ...ancestors(m, s, seen));
  }
  return out;
}

/** Properties whose (logical or intended) domain mentions class v. */
export function propertiesFrom(m, v) {
  const out = [];
  for (const p of m.properties.values()) {
    const logical = p.domainClasses.includes(v);
    const intended = p.intendedDomains.includes(v);
    if (logical || intended) out.push({ prop: p, logical, intended: intended && !logical });
  }
  return out;
}

/** Properties whose (logical or intended) range mentions class v. */
export function propertiesTo(m, v) {
  const out = [];
  for (const p of m.properties.values()) {
    const logical = p.rangeClasses.includes(v);
    const intended = p.intendedRanges.includes(v);
    if (logical || intended) out.push({ prop: p, logical, intended: intended && !logical });
  }
  return out;
}

/** Range targets of a property, each flagged logical / intended. */
export function rangeTargets(p) {
  const out = p.rangeClasses.map((r) => ({ iri: r, logical: true }));
  for (const r of p.intendedRanges) if (!p.rangeClasses.includes(r)) out.push({ iri: r, logical: false });
  return out;
}
export function domainTargets(p) {
  const out = p.domainClasses.map((r) => ({ iri: r, logical: true }));
  for (const r of p.intendedDomains) if (!p.domainClasses.includes(r)) out.push({ iri: r, logical: false });
  return out;
}

export function sortedModules(m, kinds = ['module']) {
  return [...m.modules.values()]
    .filter((x) => kinds.includes(x.kind))
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export function termsOfModule(m, modIri, kinds) {
  return [...m.terms.values()]
    .filter((t) => t.module === modIri && (!kinds || kinds.includes(t.kind)))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));
}
