#!/usr/bin/env node
// Validation: (1) every Turtle file parses; (2) SHACL on the example ABox must
// conform; (3) every deliberately invalid fixture must FAIL with the expected
// message; (4) documentation lint (every term labelled, defined, attributed to
// a module, with a status). Writes docs/status/validation.json.
import fs from 'node:fs';
import path from 'node:path';
import N3 from 'n3';
import SHACLValidator from 'rdf-validate-shacl';
import { p, ROOT, writeJSON, log } from '../lib/common.mjs';
import { PREFIXES } from '../lib/rdf.mjs';

const walk = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.ttl') ? [path.join(dir, d.name)] : [])) : []);
const rel = (f) => path.relative(ROOT, f);

const parsed = new Map();
const parse = [];
for (const f of [...walk(p('ontology')), ...walk(p('shapes')), ...walk(p('examples')), ...walk(p('fixtures', 'invalid-rdf')), ...walk(p('fixtures', 'invalid-owl')), ...walk(p('proposals')), ...walk(p('inferred'))]) {
  try {
    const quads = new N3.Parser({ baseIRI: 'file://' + f }).parse(fs.readFileSync(f, 'utf8'));
    parsed.set(f, quads);
    parse.push({ file: rel(f), ok: true, triples: quads.length });
  } catch (e) {
    parse.push({ file: rel(f), ok: false, error: e.message });
  }
}
const parseFailures = parse.filter((x) => !x.ok);
log(`parsed ${parse.length} files, ${parseFailures.length} failures`);
parseFailures.forEach((x) => log('  PARSE ERROR', x.file, x.error));

const quadsOf = (files) => files.flatMap((f) => parsed.get(f) ?? []);
const tbox = quadsOf([...walk(p('ontology')).filter((f) => !f.includes(`${path.sep}views${path.sep}`))]);
const shapes = new N3.Store(quadsOf(walk(p('shapes'))));
// Non-logical domains and ranges (smtg:intendedDomain / smtg:intendedRange) are a contract, not
// mere documentation: OWL draws no inference from them, SHACL checks them. The shapes are
// generated here from the annotations, so the contract is written once, in the ontology.
const generatedShapes = intendedShapes(tbox);
shapes.addQuads(generatedShapes.quads);
log(`generated ${generatedShapes.count} SHACL shapes from smtg:intendedDomain / smtg:intendedRange`);
const exampleFiles = walk(p('examples'));
const validator = () => new SHACLValidator(shapes);

const summarise = (report, limit = 50) => report.results.slice(0, limit).map((r) => ({
  focusNode: r.focusNode?.value,
  path: r.path?.value,
  message: r.message?.map((m) => m.value).join(' ') || null,
  constraint: r.sourceConstraintComponent?.value?.split('#')[1],
  shape: r.sourceShape?.value,
}));

// (2) positive: examples must conform, together with the entailments materialised by the rules
// (npm run infer): SHACL does no OWL reasoning, so a class defined in OWL (e.g. smtg:MeldCard, by
// layout) is known to SHACL only through the materialised inferred graph
const posStore = new N3.Store([...tbox, ...quadsOf(exampleFiles), ...quadsOf(walk(p('inferred')))]);
const posReport = await validator().validate(posStore);
const positive = {
  files: exampleFiles.map(rel),
  triples: posStore.size,
  conforms: posReport.conforms,
  violations: posReport.results.length,
  results: summarise(posReport),
};
log(`SHACL on examples: conforms=${positive.conforms} (${positive.violations} results, ${positive.triples} triples incl. TBox)`);
positive.results.slice(0, 15).forEach((r) => log('  ', r.constraint, r.focusNode, r.path ?? '', r.message ?? ''));

// (3) negative: each invalid fixture must fail with its expected message
const negative = [];
const snapshots = quadsOf(exampleFiles.filter((f) => path.basename(f) === '_snapshots.ttl'));
for (const f of walk(p('fixtures', 'invalid-rdf'))) {
  const text = fs.readFileSync(f, 'utf8');
  const expect = (text.match(/^# expect:\s*(.+)$/m) ?? [])[1]?.trim();
  const why = (text.match(/^# why:\s*(.+)$/m) ?? [])[1]?.trim();
  const own = parsed.get(f) ?? [];
  const subjects = new Set(own.map((q) => q.subject.value));
  const store = new N3.Store([...tbox, ...snapshots, ...own]);
  const report = await validator().validate(store);
  const relevant = report.results.filter((r) => subjects.has(r.focusNode?.value));
  const matched = expect ? relevant.some((r) => (r.message ?? []).some((m) => m.value.includes(expect))) : relevant.length > 0;
  negative.push({ file: rel(f), why, expect, failedAsExpected: !report.conforms && matched, results: summarise({ results: relevant }, 10) });
  log(`negative ${path.basename(f)}: ${!report.conforms && matched ? 'FAILS as expected ✓' : 'DID NOT FAIL AS EXPECTED ✗'}`);
}

// (4) documentation lint over SMTG terms
const store = new N3.Store(tbox);
const S = PREFIXES.smtg;
const typesOfInterest = ['Class', 'ObjectProperty', 'DatatypeProperty', 'AnnotationProperty'].map((t) => PREFIXES.owl + t);
const terms = new Set();
for (const t of typesOfInterest) for (const q of store.getQuads(null, PREFIXES.rdf + 'type', t, null)) if (q.subject.value.startsWith(S)) terms.add(q.subject.value);
const has = (s, pred) => store.getQuads(s, pred, null, null).length > 0;
const lint = [];
for (const t of [...terms].sort()) {
  const missing = [];
  if (!has(t, PREFIXES.rdfs + 'label')) missing.push('rdfs:label');
  if (!has(t, PREFIXES.skos + 'definition')) missing.push('skos:definition');
  if (!has(t, PREFIXES.rdfs + 'isDefinedBy')) missing.push('rdfs:isDefinedBy');
  const isAnnotation = store.getQuads(t, PREFIXES.rdf + 'type', PREFIXES.owl + 'AnnotationProperty', null).length > 0;
  if (!isAnnotation && !has(t, PREFIXES.vs + 'term_status')) missing.push('vs:term_status');
  if (missing.length) lint.push({ term: t.replace(S, 'smtg:'), missing });
}
log(`doc lint: ${terms.size} SMTG terms, ${lint.length} with missing annotations`);
lint.slice(0, 20).forEach((l) => log('  ', l.term, l.missing.join(', ')));

const out = {
  generatedAt: new Date().toISOString(),
  parse,
  shacl: { positive, negative },
  lint: { terms: terms.size, incomplete: lint },
  summary: {
    parseOk: parseFailures.length === 0,
    examplesConform: positive.conforms,
    negativeAllFail: negative.every((n) => n.failedAsExpected),
    negativeCount: negative.length,
  },
};
writeJSON(p('docs', 'status', 'validation.json'), out);
const ok = out.summary.parseOk && out.summary.examplesConform && out.summary.negativeAllFail;
log(ok ? 'VALIDATION PASSED' : 'VALIDATION FAILED');
process.exitCode = ok ? 0 : 1;

/** SHACL shapes for every smtg:intendedDomain / smtg:intendedRange annotation in the TBox. */
function intendedShapes(quads) {
  const { namedNode, blankNode, literal, quad } = N3.DataFactory;
  const SMTG = 'https://w3id.org/smtg/ontology#';
  const SH = 'http://www.w3.org/ns/shacl#';
  const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
  const short = (iri) => iri.replace(SMTG, 'smtg:').replace('http://www.w3.org/2004/02/skos/core#', 'skos:');
  const byProp = new Map(); // property -> { domain: [], range: [] }
  for (const q of quads) {
    const kind = q.predicate.value === SMTG + 'intendedDomain' ? 'domain' : q.predicate.value === SMTG + 'intendedRange' ? 'range' : null;
    if (!kind || q.object.termType !== 'NamedNode') continue;
    const e = byProp.get(q.subject.value) ?? byProp.set(q.subject.value, { domain: [], range: [] }).get(q.subject.value);
    e[kind].push(q.object.value);
  }
  const out = [];
  let count = 0;
  const list = (items) => {
    // an RDF list of the given nodes
    if (!items.length) return namedNode(RDF + 'nil');
    const head = blankNode();
    out.push(quad(head, namedNode(RDF + 'first'), items[0]), quad(head, namedNode(RDF + 'rest'), list(items.slice(1))));
    return head;
  };
  const classConstraint = (shape, classes) => {
    if (classes.length === 1) return out.push(quad(shape, namedNode(SH + 'class'), namedNode(classes[0])));
    const alts = classes.map((c) => {
      const b = blankNode();
      out.push(quad(b, namedNode(SH + 'class'), namedNode(c)));
      return b;
    });
    out.push(quad(shape, namedNode(SH + 'or'), list(alts)));
  };
  for (const [prop, { domain, range }] of [...byProp].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [kind, classes, target] of [['domain', domain, 'targetSubjectsOf'], ['range', range, 'targetObjectsOf']]) {
      if (!classes.length) continue;
      const s = blankNode();
      out.push(quad(s, namedNode(RDF + 'type'), namedNode(SH + 'NodeShape')), quad(s, namedNode(SH + target), namedNode(prop)));
      classConstraint(s, classes);
      const what = kind === 'domain' ? 'subject' : 'value';
      out.push(quad(s, namedNode(SH + 'message'), literal(`The ${what} of ${short(prop)} must be a ${classes.map(short).join(' or ')} (smtg:intended${kind === 'domain' ? 'Domain' : 'Range'}).`, 'en')));
      count++;
    }
  }
  return { quads: out, count };
}
