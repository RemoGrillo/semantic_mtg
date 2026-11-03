// RDF helpers on top of n3: parsing, namespaces, CURIEs, literal access, RDF lists.
import fs from 'node:fs';
import { Parser, Store, DataFactory } from 'n3';
import { CONFIG } from '../../lib/common.mjs';

const { namedNode } = DataFactory;

export const NS = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dcterms: 'http://purl.org/dc/terms/',
  dc: 'http://purl.org/dc/elements/1.1/',
  prov: 'http://www.w3.org/ns/prov#',
  sh: 'http://www.w3.org/ns/shacl#',
  vs: 'http://www.w3.org/2003/06/sw-vocab-status/ns#',
  dcat: 'http://www.w3.org/ns/dcat#',
  foaf: 'http://xmlns.com/foaf/0.1/',
  schema: 'https://schema.org/',
  smtg: CONFIG.namespaces?.ontology || 'https://w3id.org/smtg/ontology#',
  smtgv: CONFIG.namespaces?.vocab || 'https://w3id.org/smtg/vocab/',
  smtgid: CONFIG.namespaces?.id || 'https://w3id.org/smtg/id/',
  smtgm: (CONFIG.namespaces?.base || 'https://w3id.org/smtg/') + 'ontology/',
};

/** Expand "rdf:type" style names (only for our known prefixes) into IRIs. */
export const iri = (curie) => {
  const i = curie.indexOf(':');
  const pre = curie.slice(0, i);
  if (!(pre in NS)) throw new Error(`Unknown prefix in ${curie}`);
  return NS[pre] + curie.slice(i + 1);
};
export const nn = (curie) => namedNode(iri(curie));

export const RDF_TYPE = iri('rdf:type');

/** Parse a Turtle/TriG text. Returns { quads, prefixes } or throws with a useful message. */
export function parseTurtle(text, { baseIRI, format } = {}) {
  const prefixes = {};
  const parser = new Parser({ baseIRI, format: format || 'text/turtle' });
  const quads = parser.parse(text, null, (prefix, ns) => {
    prefixes[prefix] = typeof ns === 'string' ? ns : ns.value;
  });
  return { quads, prefixes };
}

export function parseFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const format = /\.trig$/i.test(file) ? 'application/trig' : 'text/turtle';
  const { quads, prefixes } = parseTurtle(text, { baseIRI: 'file://' + file, format });
  return { text, quads, prefixes };
}

/** Small wrapper over an N3.Store with convenience accessors used throughout the generator. */
export class Graph {
  constructor(quads = []) {
    this.store = new Store();
    this.order = []; // insertion order of quads (n3 stores are indexed, not ordered)
    this.addAll(quads);
  }
  addAll(quads) {
    for (const q of quads) {
      if (!this.store.has(q)) {
        this.store.addQuad(q);
        this.order.push(q);
      }
    }
  }
  get size() {
    return this.store.size;
  }
  /** Objects of (s, p). s/p may be Term or IRI string. */
  objects(s, p) {
    return this.store.getObjects(toTerm(s), toTerm(p), null);
  }
  subjects(p, o) {
    return this.store.getSubjects(toTerm(p), toTerm(o), null);
  }
  quads(s, p, o) {
    return this.store.getQuads(s ? toTerm(s) : null, p ? toTerm(p) : null, o ? toTerm(o) : null, null);
  }
  has(s, p, o) {
    return this.store.countQuads(toTerm(s), toTerm(p), toTerm(o), null) > 0;
  }
  types(s) {
    return this.objects(s, RDF_TYPE)
      .filter((t) => t.termType === 'NamedNode')
      .map((t) => t.value);
  }
  isA(s, typeIri) {
    return this.has(s, RDF_TYPE, typeIri);
  }
  /** First literal in preferred language (en, then untagged, then anything). */
  literal(s, p, langs = ['en', '']) {
    const lits = this.objects(s, p).filter((o) => o.termType === 'Literal');
    for (const l of langs) {
      const hit = lits.find((o) => o.language === l);
      if (hit) return hit.value;
    }
    return lits[0]?.value;
  }
  /** All literal values (deduplicated; English/untagged first). */
  literals(s, p) {
    const lits = this.objects(s, p).filter((o) => o.termType === 'Literal');
    const rank = (o) => (o.language === 'en' ? 0 : o.language === '' ? 1 : 2);
    return [...new Set(lits.sort((a, b) => rank(a) - rank(b)).map((o) => o.value))];
  }
  /** Values that may be literals or IRIs (e.g. smtg:reviewQuestion "RQ-ID-1"). */
  values(s, p) {
    return [...new Set(this.objects(s, p).map((o) => o.value))];
  }
  iris(s, p) {
    return [...new Set(this.objects(s, p).filter((o) => o.termType === 'NamedNode').map((o) => o.value))];
  }
  /** Read an RDF collection starting at node; returns array of terms, or null if malformed. */
  list(node) {
    const out = [];
    const seen = new Set();
    let cur = node;
    while (cur && !(cur.termType === 'NamedNode' && cur.value === NS.rdf + 'nil')) {
      if (seen.has(cur.value) || out.length > 10000) return null;
      seen.add(cur.value);
      const first = this.objects(cur, NS.rdf + 'first');
      const rest = this.objects(cur, NS.rdf + 'rest');
      if (first.length !== 1 || rest.length !== 1) return null;
      out.push(first[0]);
      cur = rest[0];
    }
    return out;
  }
}

export function toTerm(x) {
  if (x == null) return null;
  return typeof x === 'string' ? namedNode(x) : x;
}

/** Prefix map used for display (CURIEs). Longest namespace wins. */
export class Prefixes {
  constructor(map = {}) {
    this.map = {};
    for (const [k, v] of Object.entries(NS)) this.map[k] = v;
    this.add(map);
  }
  add(map) {
    for (const [k, v] of Object.entries(map || {})) {
      if (!v || typeof v !== 'string') continue;
      // never let a file rebind our canonical prefixes to something else
      if (k in NS && NS[k] !== v) continue;
      if (Object.values(this.map).includes(v) && !(k in this.map)) continue;
      this.map[k] = v;
    }
    this._sorted = null;
  }
  get sorted() {
    if (!this._sorted) this._sorted = Object.entries(this.map).sort((a, b) => b[1].length - a[1].length);
    return this._sorted;
  }
  /** IRI -> "prefix:local" if the local part is a simple name, else null. */
  curie(value) {
    for (const [pre, ns] of this.sorted) {
      if (pre && value.startsWith(ns) && value.length > ns.length) {
        const local = value.slice(ns.length);
        if (/^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/.test(local) && !local.endsWith('.')) return `${pre}:${local}`;
      }
    }
    return null;
  }
  shorten(value) {
    return this.curie(value) || value;
  }
  /** Prefixes actually needed by a set of IRIs (for Turtle snippets). */
  subsetFor(iris) {
    const out = {};
    for (const v of iris) {
      for (const [pre, ns] of this.sorted) {
        if (pre && v.startsWith(ns)) {
          out[pre] = ns;
          break;
        }
      }
    }
    return out;
  }
  /** Expand a CURIE or return the input if it is already an IRI / unknown. */
  expand(s) {
    if (typeof s !== 'string') return s;
    const m = /^([A-Za-z][\w-]*):(.*)$/.exec(s);
    if (m && this.map[m[1]] && !s.startsWith('http')) return this.map[m[1]] + m[2];
    return s;
  }
}

/** Local name of an IRI (after #, else after last /). */
export function localName(v) {
  const h = v.lastIndexOf('#');
  if (h >= 0 && h < v.length - 1) return v.slice(h + 1);
  const s = v.replace(/\/+$/, '').lastIndexOf('/');
  return s >= 0 ? v.replace(/\/+$/, '').slice(s + 1) : v;
}
