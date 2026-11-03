// Tests for the documentation generator (run with `npm test` or `node --test tools/docs/`).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseTurtle, Prefixes } from './lib/rdf.mjs';
import { buildModel } from './lib/model.mjs';
import { exprHTML } from './render/common.mjs';
import { Flow, mtext } from './lib/diagrams.mjs';
import { renderMarkdown, ghSlug } from './lib/markdown.mjs';
import { validateSuggestion, slugify } from './serve.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const TTL = `
@prefix owl: <http://www.w3.org/2002/07/owl#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> . @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix smtg: <https://w3id.org/smtg/ontology#> . @prefix smtgm: <https://w3id.org/smtg/ontology/> .
@prefix vs: <http://www.w3.org/2003/06/sw-vocab-status/ns#> .
smtgm:cards a owl:Ontology ; rdfs:label "Cards"@en .
smtg:OracleCard a owl:Class ; rdfs:label "Oracle card"@en ; skos:definition "x"@en ; rdfs:isDefinedBy smtgm:cards ; vs:term_status "stable-draft" ;
  rdfs:subClassOf [ a owl:Restriction ; owl:onProperty smtg:hasFace ; owl:minQualifiedCardinality "1"^^xsd:nonNegativeInteger ; owl:onClass smtg:CardFace ] .
smtg:CardFace a owl:Class ; rdfs:isDefinedBy smtgm:cards .
smtg:MDFC a owl:Class ; rdfs:isDefinedBy smtgm:cards ;
  owl:equivalentClass [ owl:intersectionOf ( smtg:OracleCard [ a owl:Restriction ; owl:onProperty smtg:hasLayout ; owl:hasValue <https://w3id.org/smtg/vocab/layout/modal_dfc> ] ) ] .
smtg:hasFace a owl:ObjectProperty, owl:FunctionalProperty ; rdfs:domain [ owl:unionOf ( smtg:OracleCard smtg:CardFace ) ] ; rdfs:range smtg:CardFace ; rdfs:isDefinedBy smtgm:cards .
smtg:hasLayout a owl:ObjectProperty ; smtg:intendedDomain smtg:OracleCard ; rdfs:isDefinedBy smtgm:cards .
prov:Entity a owl:Class .
`.replace('prov:Entity', '<http://www.w3.org/ns/prov#Entity>');

function model() {
  const { quads, prefixes } = parseTurtle(TTL);
  const pf = new Prefixes(prefixes);
  return buildModel({ files: [{ rel: 'smtg-cards.ttl', kind: 'module', quads, text: TTL }], prefixes: pf });
}

test('model: classes, restrictions, unions, intended domains, external terms', () => {
  const m = model();
  const oc = m.classes.get('https://w3id.org/smtg/ontology#OracleCard');
  assert.equal(oc.label, 'Oracle card');
  assert.equal(oc.status, 'stable-draft');
  assert.equal(strip(exprHTML(m, oc.superExpressions[0])), 'hasFace min 1 CardFace');
  const mdfc = m.classes.get('https://w3id.org/smtg/ontology#MDFC');
  assert.match(strip(exprHTML(m, mdfc.equivalents[0])), /^OracleCard and \(hasLayout value .*modal_dfc\)$/);
  assert.ok(oc.subClasses.includes(mdfc.iri), 'named conjunct of an equivalence counts as implied superclass');
  const hasFace = m.properties.get('https://w3id.org/smtg/ontology#hasFace');
  assert.deepEqual(hasFace.domainClasses.sort(), ['https://w3id.org/smtg/ontology#CardFace', 'https://w3id.org/smtg/ontology#OracleCard']);
  assert.deepEqual(hasFace.characteristics, ['Functional']);
  const hasLayout = m.properties.get('https://w3id.org/smtg/ontology#hasLayout');
  assert.deepEqual(hasLayout.intendedDomains, ['https://w3id.org/smtg/ontology#OracleCard']);
  assert.equal(m.classes.get('http://www.w3.org/ns/prov#Entity').local, false, 'bare re-declarations are not SMTG terms');
});

test('diagrams: Mermaid label escaping and edge styles', () => {
  assert.equal(mtext('a "b" #c <d>'), 'a #quot;b#quot; #35;c &lt;d&gt;');
  const f = new Flow('LR');
  f.node('a', 'A');
  f.node('b', 'B', { cls: 'ext', href: '#/class/B' });
  f.edge('a', 'b', 'p', 'dashed');
  f.edge('a', 'b', 'p', 'dashed'); // duplicate ignored
  const src = f.toString();
  assert.match(src, /n0 -\.->\|"p"\| n1/);
  assert.match(src, /click n1 href "#\/class\/B"/);
  assert.equal(src.match(/-\.->/g).length, 1);
});

test('markdown: GitHub slugs, ID anchors and auto-links', () => {
  const out = renderMarkdown('# T\n\n## RQ-ID-1 — Oracle identity\n\nSee AP-02 and `RQ-ID-9`.', {
    route: 'page/review-questions',
    file: 'docs/ontology/review-questions.md',
    idHref: (id) => ({ href: `#/x/${id}` }),
  });
  assert.equal(ghSlug('RQ-ID-1 — Oracle identity'), 'rq-id-1--oracle-identity');
  assert.match(out.html, /data-anchor-id="RQ-ID-1"/);
  assert.match(out.html, /<a class="ref-id" href="#\/x\/AP-02">AP-02<\/a>/);
  assert.doesNotMatch(out.html, /href="#\/x\/RQ-ID-9"/, 'IDs inside code spans are not linked');
});

test('client: hash parsing, route resolution, issue links', () => {
  const ctx = { module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(HERE, 'assets', 'client.js'), 'utf8'), ctx);
  const api = ctx.module.exports;
  assert.equal(api.parseHash('#/class/OracleCard'), 'class/OracleCard');
  assert.equal(api.parseHash('#main'), null);
  assert.equal(api.parseHash(''), '');
  const has = (r) => ['overview', 'page/review-questions', 'vocab/layout'].includes(r);
  assert.deepEqual({ ...api.resolveRoute('page/review-questions/RQ-ID-1', has) }, { route: 'page/review-questions', anchor: 'RQ-ID-1' });
  assert.deepEqual({ ...api.resolveRoute('vocab/layout/modal_dfc', has) }, { route: 'vocab/layout', anchor: 'modal_dfc' });
  assert.equal(api.resolveRoute('class/Nope', has).route, '404');
  const url = api.issueUrl('https://github.com/o/r/', { kind: 'tweak', termLabel: 'Oracle card', termIri: 'https://w3id.org/smtg/ontology#OracleCard', text: 'x' }, ['term']);
  assert.match(url, /^https:\/\/github\.com\/o\/r\/issues\/new\?template=concept-change\.yml&title=/);
  assert.match(url, /&term=https%3A%2F%2Fw3id\.org/);
});

test('serve: suggestion validation and safe slugs', () => {
  const ok = validateSuggestion({ termIri: 'https://w3id.org/smtg/ontology#OracleCard', termLabel: 'Oracle\ncard', kind: 'tweak', author: 'A', text: ' Hello ' });
  assert.equal(ok.termLabel, 'Oracle card');
  assert.equal(ok.text, 'Hello');
  assert.throws(() => validateSuggestion({ termIri: '../etc/passwd', kind: 'tweak', text: 'x' }), /absolute IRI/);
  assert.throws(() => validateSuggestion({ termIri: 'https://x/y', kind: 'evil', text: 'x' }), /kind/);
  assert.throws(() => validateSuggestion({ termIri: 'https://x/y', kind: 'tweak', text: 'x'.repeat(10001) }), /too long/);
  assert.equal(slugify('../../Évil/Name!'), 'evil-name');
  assert.equal(slugify(''), 'suggestion');
});

test('build: produces a self-contained page with valid scripts and resolvable routes', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'smtg-docs-'));
  try {
    execFileSync(process.execPath, [path.join(HERE, 'build.mjs'), '--out', out, '--quiet'], { stdio: 'pipe', timeout: 300000 });
    const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
    assert.ok(!html.includes('<!--MMD:'), 'all diagram placeholders substituted');
    const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length >= 3);
    for (const [, attrs, body] of scripts) {
      if (/application\/json/.test(attrs || '')) JSON.parse(body);
      else new vm.Script(body); // throws on syntax errors
    }
    const routes = new Set([...html.matchAll(/<section class="route" data-route="([^"]+)"/g)].map((x) => x[1]));
    for (const r of ['overview', 'about', 'status', 'coverage', 'audit', 'layouts', '404']) assert.ok(routes.has(r), `route ${r}`);
    const sidebar = html.slice(html.indexOf('<nav id="sidebar"'), html.indexOf('</nav>', html.indexOf('<nav id="sidebar"')));
    const navs = [...sidebar.matchAll(/data-nav="([^"]+)"/g)].map((x) => x[1]);
    assert.ok(navs.length > 10);
    for (const n of navs) assert.ok(routes.has(n), `sidebar link #/${n} has a page`);
    assert.ok(html.includes('unofficial Fan Content permitted under the Fan Content Policy'));
    assert.ok(!/src="https?:/.test(html.replace(/<pre[\s\S]*?<\/pre>/g, '')), 'no external resources');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
