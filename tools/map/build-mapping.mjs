#!/usr/bin/env node
// Build mappings/<source>.fields.json: for every field path observed by the
// census, which ontology terms represent it (from smtg:sourceField annotations)
// or which explicit disposition it has (mappings/<source>.overrides.json).
// Anything else is reported as "unmapped" — no silent loss.
import fs from 'node:fs';
import N3 from 'n3';
import { p, readJSON, writeJSON, log } from '../lib/common.mjs';

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
function scopeOf(path) {
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
    return { path: f.path, scope: scopeOf(f.path), disposition, terms, note: o?.note ?? (terms.length ? undefined : 'No ontology term claims this field yet.'), present: f.present };
  });
  writeJSON(p('mappings', outFile), rows);
  const by = rows.reduce((acc, r) => ((acc[r.disposition] = (acc[r.disposition] ?? 0) + 1), acc), {});
  log(`${outFile}: ${rows.length} paths`, JSON.stringify(by));
  rows.filter((r) => r.disposition === 'unmapped').forEach((r) => log('   unmapped:', r.path));
}

build('scryfall', 'scryfall-census.json', 'scryfall.overrides.json', 'scryfall.fields.json');
build('spellbook', 'spellbook-profile.json', 'spellbook.overrides.json', 'spellbook.fields.json', { prefix: 'variants[].' });
build('tagger', null, 'tagger.overrides.json', 'tagger.fields.json', { fields: TAGGER_FIELDS });
