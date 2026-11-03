#!/usr/bin/env node
// Build mappings/<source>.fields.json: for every field path observed by the
// census, which ontology terms represent it (from smtg:sourceField annotations)
// or which explicit disposition it has (mappings/<source>.overrides.json).
// Anything else is reported as "unmapped" — no silent loss.
import fs from 'node:fs';
import N3 from 'n3';
import { p, readJSON, writeJSON, log, rawFile } from '../lib/common.mjs';

const S = 'https://w3id.org/smtg/ontology#';
const SRC = S + 'sourceField';
const quads = fs.readdirSync(p('ontology')).filter((f) => f.endsWith('.ttl')).flatMap((f) => new N3.Parser().parse(fs.readFileSync(p('ontology', f), 'utf8')));
const annotations = quads.filter((q) => q.predicate.value === SRC).map((q) => ({ term: q.subject.value.replace(S, 'smtg:'), field: q.object.value }));

const norm = (s) => s.replace(/\[\]/g, '');
function termsFor(source, path) {
  const out = new Set();
  for (const { term, field } of annotations) {
    if (!field.startsWith(source + ':')) continue;
    const f = field.slice(source.length + 1);
    if (f.endsWith('.*')) {
      const base = f.slice(0, -2);
      if (norm(path) === norm(base) || norm(path).startsWith(norm(base) + '.')) out.add(term);
    } else if (norm(f) === norm(path)) out.add(term);
  }
  return [...out].sort();
}

const ORACLE_LEVEL = new Set(['oracle_id', 'name', 'layout', 'cmc', 'color_identity', 'keywords', 'produced_mana', 'reserved', 'edhrec_rank', 'penny_rank', 'game_changer', 'mana_cost', 'type_line', 'oracle_text', 'power', 'toughness', 'loyalty', 'defense', 'hand_modifier', 'life_modifier', 'colors', 'color_indicator', 'all_parts']);
const SOURCE_SCOPE = {
  'scryfall-rulings': () => 'ruling (claim about an Oracle card)',
  'scryfall-sets': () => 'set',
  tagger: (path) => (path.startsWith('taggings') ? 'tag assignment (claim)' : 'tag concept'),
  spellbook: (path) => (path.startsWith('uses') ? 'combo card use' : path.startsWith('requires') ? 'template requirement' : path.startsWith('produces') ? 'feature production' : path.startsWith('of') || path.startsWith('includes') ? 'combo recipe' : 'combo variant'),
};
function scopeOf(path, source = 'scryfall') {
  if (SOURCE_SCOPE[source]) return SOURCE_SCOPE[source](path);
  const top = path.split(/[.[]/)[0];
  if (path.startsWith('card_faces')) return /printed_|flavor|artist|illustration|image_uris|watermark/.test(path) ? 'printed-face' : 'face';
  if (top === 'legalities') return 'observation (Oracle card)';
  if (top === 'prices') return 'observation (printing)';
  if (top.startsWith('set') || top === 'scryfall_set_uri') return 'set';
  if (top === 'image_uris') return 'image';
  if (['illustration_id', 'artist', 'artist_ids'].includes(top)) return 'illustration';
  if (ORACLE_LEVEL.has(top)) return top === 'name' || top === 'layout' ? 'oracle card / face' : ['mana_cost', 'type_line', 'oracle_text', 'power', 'toughness', 'loyalty', 'defense', 'hand_modifier', 'life_modifier', 'colors', 'color_indicator'].includes(top) ? 'face' : 'oracle card';
  if (['printed_name', 'printed_text', 'printed_type_line', 'flavor_text', 'flavor_name', 'watermark'].includes(top)) return 'printed-face';
  return 'printing';
}

// ---------------------------------------------------------------------------
// Fixture check: a "mapped" field only counts if the prototype mapper really emits one of its terms.
// For each mapped path: is it present in the fixtures? If so, does any claimed term occur in examples/?
const pathsOf = (obj, prefix = '', out = new Set()) => {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (['taggingsTotal', 'childIdsTotal'].includes(k)) continue; // fixture-added keys, not source fields
    const path = prefix ? `${prefix}.${k}` : k;
    // only values that carry something count (null, "" and [] are absent for this purpose)
    if (v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    out.add(path);
    if (Array.isArray(v)) {
      out.add(`${path}[]`);
      for (const el of v) if (el && typeof el === 'object') pathsOf(el, `${path}[]`, out);
    } else if (v && typeof v === 'object') pathsOf(v, path, out);
  }
  return out;
};
const fixtureRecords = (dir) => (fs.existsSync(p('fixtures', dir)) ? fs.readdirSync(p('fixtures', dir)).filter((x) => x.endsWith('.json')).flatMap((x) => JSON.parse(fs.readFileSync(p('fixtures', dir, x), 'utf8')).records ?? []) : []);
const fixturePaths = {
  scryfall: new Set(fixtureRecords('scryfall').flatMap((r) => [...pathsOf(r)])),
  tagger: new Set(fixtureRecords('tagger').flatMap((r) => [...pathsOf(r)])),
  spellbook: new Set(fixtureRecords('spellbook').filter((r) => 'uses' in r).flatMap((r) => [...pathsOf(r)])),
  'scryfall-rulings': new Set(fixtureRecords('rulings').flatMap((r) => [...pathsOf(r)])),
};
const sets = (() => { try { return readJSON(rawFile('scryfall:sets')).data; } catch { return []; } })();
const usedSetIds = new Set(fixtureRecords('scryfall').map((r) => r.set_id));
fixturePaths['scryfall-sets'] = new Set(sets.filter((x) => usedSetIds.has(x.id)).flatMap((x) => [...pathsOf(x)]));
const usedTerms = new Set();
for (const f of fs.readdirSync(p('examples')).filter((x) => x.endsWith('.ttl')))
  for (const q of new N3.Parser().parse(fs.readFileSync(p('examples', f), 'utf8'))) {
    if (q.predicate.value.startsWith(S)) usedTerms.add(q.predicate.value.replace(S, 'smtg:'));
    if (q.predicate.value.endsWith('#type') && q.object.value.startsWith(S)) usedTerms.add(q.object.value.replace(S, 'smtg:'));
  }
// a term counts as used if it, or a sub-class / sub-property of it, occurs in the examples
const superOf = new Map();
for (const q of quads) {
  if (!/#subClassOf$|#subPropertyOf$/.test(q.predicate.value) || !q.subject.value.startsWith(S) || !q.object.value.startsWith(S)) continue;
  const a = q.subject.value.replace(S, 'smtg:'), b = q.object.value.replace(S, 'smtg:');
  superOf.set(a, [...(superOf.get(a) ?? []), b]);
}
for (const t of [...usedTerms]) {
  const stack = [t];
  while (stack.length) for (const sup of superOf.get(stack.pop()) ?? []) if (!usedTerms.has(sup)) { usedTerms.add(sup); stack.push(sup); }
}
function fixtureCheck(source, row) {
  if (row.disposition !== 'mapped') return undefined;
  const fp = fixturePaths[source];
  if (!fp || !fp.has(row.path)) return 'not in fixtures';
  if (!row.terms.length) return 'mapped by rule (no term annotation)';
  return row.terms.some((t) => usedTerms.has(t)) ? 'emitted' : 'NOT EMITTED';
}

const TAGGER_FIELDS = ['object', 'id', 'label', 'slug', 'type', 'uri', 'description', 'parent_ids', 'parent_ids[]', 'child_ids', 'child_ids[]', 'aliases', 'aliases[]', 'taggings', 'taggings[]', 'taggings[].oracle_id', 'taggings[].illustration_id', 'taggings[].weight', 'taggings[].annotation'].map((path) => ({ path }));

function build(source, censusFile, overridesFile, outFile, { prefix = '', fields } = {}) {
  const census = fields ? { fields } : readJSON(p('docs', 'source-audit', censusFile), null);
  if (!census?.fields) { log(`skip ${source}: no fields in ${censusFile}`); return; }
  const overrides = readJSON(p('mappings', overridesFile), {});
  const rows = census.fields.map((f) => {
    const terms = termsFor(source, prefix + f.path);
    // an override on a parent path (e.g. "legalities") also covers its children ("legalities.modern")
    let o = overrides[f.path];
    for (let q = f.path; !o && q.includes('.'); ) { q = q.slice(0, q.lastIndexOf('.')); o = overrides[q]; }
    const disposition = terms.length ? 'mapped' : o?.disposition ?? 'unmapped';
    const row = { path: f.path, scope: scopeOf(f.path, source), disposition, terms, note: o?.note ?? (terms.length ? undefined : 'No ontology term claims this field yet.'), present: f.present };
    row.fixtureCheck = fixtureCheck(source, row);
    return row;
  });
  writeJSON(p('mappings', outFile), rows);
  const by = rows.reduce((acc, r) => ((acc[r.disposition] = (acc[r.disposition] ?? 0) + 1), acc), {});
  const chk = rows.reduce((acc, r) => (r.fixtureCheck ? ((acc[r.fixtureCheck] = (acc[r.fixtureCheck] ?? 0) + 1), acc) : acc), {});
  log(`${outFile}: ${rows.length} paths`, JSON.stringify(by), '| fixture check', JSON.stringify(chk));
  rows.filter((r) => r.disposition === 'unmapped').forEach((r) => log('   unmapped:', r.path));
  rows.filter((r) => r.fixtureCheck === 'NOT EMITTED').forEach((r) => log('   claimed but not emitted by the mapper:', r.path, r.terms.join(', ')));
}

build('scryfall', 'scryfall-census.json', 'scryfall.overrides.json', 'scryfall.fields.json');
build('spellbook', 'spellbook-profile.json', 'spellbook.overrides.json', 'spellbook.fields.json', { prefix: 'variants[].' });
build('tagger', null, 'tagger.overrides.json', 'tagger.fields.json', { fields: TAGGER_FIELDS });
build('scryfall-rulings', null, 'rulings.overrides.json', 'rulings.fields.json', { fields: ['object', 'oracle_id', 'source', 'published_at', 'comment'].map((path) => ({ path })) });
build('scryfall-sets', null, 'sets.overrides.json', 'sets.fields.json', { fields: [...new Set(sets.flatMap((x) => Object.keys(x)))].sort().map((path) => ({ path, present: sets.filter((x) => x[path] !== undefined).length })) });
