#!/usr/bin/env node
// Phase 0 — extract small, deterministic, UNMODIFIED source fixtures from the raw dumps.
//   fixtures/scryfall/<slug>.json, fixtures/tagger/<slug>.json, fixtures/spellbook/<slug>.json
//   fixtures/README.md
// Every record is selected by a recorded query over the snapshot; nothing is invented.
// Only change to source objects: Tagger tag records get their taggings[] filtered to the
// fixture's targets and a fixture-added `taggingsTotal` key (documented in each file).
// Usage: node tools/audit/extract-fixtures.mjs   (npm run fixtures)
import fs from 'node:fs';
import { readJSONL, streamJSONGz, manifestEntry, sourceOf, writeJSON, writeText, log, p, fmt, mdTable } from './audit-lib.mjs';

const MAX_BYTES = 150 * 1024;
// Raw source text of each parsed JSONL record, so Scryfall fixtures can embed the exact
// original bytes (JSON.stringify would e.g. rewrite "cmc":3.0 as 3).
const RAW = new WeakMap();
async function* records(key) {
  for await (const line of readJSONL(p(sha[key].localPath), { raw: true })) {
    const o = JSON.parse(line);
    RAW.set(o, line);
    yield o;
  }
}
const ALL = 'scryfall:all_cards';
const ORA = 'scryfall:oracle_cards';
const OTAG = 'scryfall:oracle_tags';
const ATAG = 'scryfall:art_tags';
const SB = 'spellbook:variants';
const RUL = 'scryfall:rulings';

// ---------------------------------------------------------------------------------------
// Fixture definitions (Scryfall). `oracles` = exact oracle_cards names (game cards only).
// ---------------------------------------------------------------------------------------
const NON_GAME_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series', 'planar', 'scheme', 'vanguard', 'front_card']);
const EARLIEST_EN = 'earliest printing by (released_at, id) with lang=en, digital=false, promo=false (fallbacks: lang=en & digital=false; then any)';
const isPaper = (c) => !c.digital && (c.games ?? []).includes('paper');

const CARD_FIXTURES = [
  { slug: 'lightning-bolt', purpose: 'Simple single-faced instant (PLAN §4.2 #1); several printings, an Italian printing with printed_name/printed_text, ≥2 distinct illustrations.', oracles: ['Lightning Bolt'], printings: 'lightning-bolt' },
  { slug: 'blood-artist', purpose: 'Single-faced creature with printed power/toughness and functional oracle tags (PLAN §4.2 #2); also used by Spellbook fixtures.', oracles: ['Blood Artist'] },
  { slug: 'transform-dfc', purpose: 'Transform double-faced card (PLAN §4.2 #3): faces carry mana cost/text/image; root has no image_uris.', oracles: ['Delver of Secrets // Insectile Aberration'] },
  { slug: 'mdfc', purpose: 'Modal double-faced cards (PLAN §4.2 #4): a planeswalker/creature MDFC and a spell//land MDFC.', oracles: ['Valki, God of Lies // Tibalt, Cosmic Impostor', "Agadeem's Awakening // Agadeem, the Undercrypt"] },
  { slug: 'split', purpose: 'Split card (PLAN §4.2 #5): one physical card, two castable halves, combined mana value at root.', oracles: ['Fire // Ice'] },
  { slug: 'aftermath', purpose: 'Aftermath card: Scryfall layout is still `split`; the distinction is only in keywords/text.', oracles: ['Commit // Memory'] },
  { slug: 'fuse', purpose: 'Fuse split card (layout `split`, keyword Fuse).', query: { describe: "oracle_cards: layout == 'split' and keywords contains 'Fuse'; first by name", pick: (c) => c.layout === 'split' && c.keywords?.includes('Fuse') } },
  { slug: 'adventure', purpose: 'Adventure card (PLAN §4.2 #6): single-sided card with two card_faces; not a double-faced card.', oracles: ['Bonecrusher Giant // Stomp'] },
  { slug: 'flip', purpose: 'Flip card (PLAN §4.2 #7): two faces on one side; not a transform DFC.', oracles: ['Akki Lavarunner // Tok-Tok, Volcano Born'] },
  { slug: 'meld', purpose: 'Meld pair and meld result (PLAN §4.2 #8) with all_parts meld_part/meld_result links.', oracles: ['Bruna, the Fading Light', 'Gisela, the Broken Blade', 'Brisela, Voice of Nightmares'] },
  { slug: 'mana-cost-absent-vs-zero', purpose: 'Mana cost absent (Ancestral Vision, suspend only) versus zero mana cost {0} (Ornithopter) (PLAN §4.2 #13).', oracles: ['Ancestral Vision', 'Ornithopter'] },
  { slug: 'variable-pt', purpose: 'Variable / non-numeric power and toughness (`*`, `1+*`) (PLAN §4.2 #13).', oracles: ['Tarmogoyf'] },
  { slug: 'variable-loyalty', purpose: 'Planeswalker with non-numeric starting loyalty (X).', query: { describe: "oracle_cards: layout == 'normal' and loyalty == 'X'; first by name", pick: (c) => c.layout === 'normal' && c.loyalty === 'X' } },
  { slug: 'battle-defense', purpose: 'Battle with defense (on the front face of a transform card).', query: { describe: 'oracle_cards: defense present at root or on any card_faces[]; first by name', pick: (c) => c.defense != null || c.card_faces?.some((f) => f.defense != null) } },
  { slug: 'modal-spell', purpose: 'Modal spell ("Choose two —") with layout normal, to contrast with MDFCs (PLAN §4.2 #17).', oracles: ["Kolaghan's Command"] },
  { slug: 'prototype', purpose: 'Prototype layout: alternative cost/P/T printed inside one face.', query: { describe: "oracle_cards: layout == 'prototype'; first by name", pick: (c) => c.layout === 'prototype' } },
  { slug: 'class', purpose: 'Class enchantment layout (levels).', query: { describe: "oracle_cards: layout == 'class'; first by name", pick: (c) => c.layout === 'class' } },
  { slug: 'saga', purpose: 'Saga layout (chapter abilities).', query: { describe: "oracle_cards: layout == 'saga'; first by name", pick: (c) => c.layout === 'saga' } },
  { slug: 'prepare', purpose: 'Layout `prepare` (new in the 2026 data, Adventure-like two-face layout; not in older Scryfall docs).', query: { describe: "oracle_cards: layout == 'prepare'; first by name", pick: (c) => c.layout === 'prepare' } },
  { slug: 'ashnods-altar', purpose: 'Oracle card used by the Spellbook fixtures (cross-source link target).', oracles: ["Ashnod's Altar"] },
  { slug: 'mana-token-maker', purpose: 'A card that creates a token which can itself produce mana (Eldrazi Scion), with the exact token printings its all_parts point to: input for the producesManaViaToken inference.', oracles: ['Eldrazi Confluence'], withTokens: true },
];

// Printing-level / layout-level fixtures selected while streaming all_cards.
const PRINT_FIXTURES = [
  { slug: 'reversible-card', purpose: 'reversible_card (PLAN §4.2 #9): oracle_id only on card_faces[], not at root; includes oracle_cards records of the face oracle ids.', n: 2, describe: "all_cards: layout == 'reversible_card'; first 2 by id (any language)", pick: (c) => c.layout === 'reversible_card', faceOracles: true },
  { slug: 'double-faced-token', purpose: 'Double-faced token (PLAN §4.2 #10).', n: 1, describe: "all_cards: layout == 'double_faced_token' and lang == 'en'; first by id", pick: (c) => c.layout === 'double_faced_token' && c.lang === 'en' },
  { slug: 'token', purpose: 'Regular token (PLAN §4.2 #14).', n: 1, describe: "all_cards: layout == 'token' and lang == 'en'; first by id", pick: (c) => c.layout === 'token' && c.lang === 'en' },
  { slug: 'emblem', purpose: 'Emblem (PLAN §4.2 #14).', n: 1, describe: "all_cards: layout == 'emblem' and lang == 'en'; first by id", pick: (c) => c.layout === 'emblem' && c.lang === 'en' },
  { slug: 'art-series', purpose: 'Art series card (PLAN §4.2 #14): own oracle_id, shares illustration_id with the real card.', n: 1, describe: "all_cards: layout == 'art_series' and lang == 'en'; first by id", pick: (c) => c.layout === 'art_series' && c.lang === 'en' },
  { slug: 'planar', purpose: 'Planechase plane (PLAN §4.2 #14).', n: 1, describe: "all_cards: layout == 'planar' and lang == 'en' and type_line contains 'Plane —'; first by id", pick: (c) => c.layout === 'planar' && c.lang === 'en' && c.type_line?.includes('Plane —') },
  { slug: 'scheme', purpose: 'Archenemy scheme (PLAN §4.2 #14).', n: 1, describe: "all_cards: layout == 'scheme' and lang == 'en'; first by id", pick: (c) => c.layout === 'scheme' && c.lang === 'en' },
  { slug: 'vanguard', purpose: 'Vanguard card with hand/life modifiers (PLAN §4.2 #14).', n: 1, describe: "all_cards: layout == 'vanguard' and lang == 'en'; first by id", pick: (c) => c.layout === 'vanguard' && c.lang === 'en' },
  { slug: 'multi-artist', purpose: 'Printing credited to ≥2 artists (PLAN §4.2 #11).', n: 1, describe: "all_cards: layout == 'normal' and lang == 'en' and artist_ids.length >= 2; first by id", pick: (c) => c.layout === 'normal' && c.lang === 'en' && (c.artist_ids?.length ?? 0) >= 2, withOracle: true },
  { slug: 'flavor-name', purpose: 'Printing with a special flavor_name (PLAN §4.2 #12) and the oracle record of its normal-named card.', n: 1, describe: "all_cards: lang == 'en' and flavor_name present, preferring promo_types contains 'godzillaseries'; first by id", pick: (c) => c.lang === 'en' && c.flavor_name != null, prefer: (c) => c.promo_types?.includes('godzillaseries'), withOracle: true, counterpart: (c) => c.flavor_name == null },
];

// ---------------------------------------------------------------------------------------
const byKey = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const printKey = (c) => `${c.released_at ?? '9999'}|${c.id}`;
const sha = {};
for (const k of [ALL, ORA, OTAG, ATAG, SB, RUL]) sha[k] = manifestEntry(k);

function fixtureFile(dir, slug, body) {
  const file = p('fixtures', dir, `${slug}.json`);
  if (body.records.length && body.records.every((r) => RAW.has(r))) {
    // byte-exact source records, one per line, inside an otherwise pretty-printed file
    const head = JSON.stringify({ ...body, records: '\u0000RECORDS' }, null, 2);
    const recs = `[\n${body.records.map((r) => `    ${RAW.get(r)}`).join(',\n')}\n  ]`;
    const text = head.replace('"\\u0000RECORDS"', () => recs) + '\n';
    JSON.parse(text); // sanity: still valid JSON
    fs.writeFileSync(file, text);
  } else writeJSON(file, body);
  const bytes = fs.statSync(file).size;
  if (bytes > MAX_BYTES) log(`  WARNING ${dir}/${slug}.json is ${fmt(bytes)} bytes (> ${fmt(MAX_BYTES)})`);
  const ids = dir === 'tagger' ? body.recordIndex.map((r) => `${r.slug}`) : body.recordIndex.map((r) => r.id);
  return { dir, slug, file: `fixtures/${dir}/${slug}.json`, bytes, purpose: body.purpose, selector: body.selector, source: body.source, extraSources: body.extraSources, ids };
}
const written = [];

// 1. oracle_cards: named targets and query targets ------------------------------------------
log('pass 1: oracle_cards');
const wantedNames = new Set(CARD_FIXTURES.flatMap((f) => f.oracles ?? []));
const oracleByName = new Map();
const queryHits = new Map(); // slug -> [records]
for await (const c of records(ORA)) {
  if (NON_GAME_LAYOUTS.has(c.layout)) continue;
  if (wantedNames.has(c.name)) (oracleByName.get(c.name) ?? oracleByName.set(c.name, []).get(c.name)).push(c);
  for (const f of CARD_FIXTURES) if (f.query && isPaper(c) && f.query.pick(c)) (queryHits.get(f.slug) ?? queryHits.set(f.slug, []).get(f.slug)).push(c);
}
// keep only what we need
const oracleRecords = new Map(); // slug -> [oracle records]
for (const f of CARD_FIXTURES) {
  let recs;
  if (f.oracles) {
    recs = f.oracles.map((n) => {
      const hits = oracleByName.get(n) ?? [];
      if (hits.length !== 1) throw new Error(`oracle_cards name "${n}" matched ${hits.length} game records`);
      return hits[0];
    });
    f.selector = `oracle_cards: name == ${f.oracles.map((n) => JSON.stringify(n)).join(' / ')} (layout not token/art_series/emblem/…); all_cards: printings of those oracle_id values, `;
  } else {
    const hits = (queryHits.get(f.slug) ?? []).sort((a, b) => byKey(a.name, b.name) || byKey(a.id, b.id));
    if (!hits.length) throw new Error(`no oracle_cards hit for ${f.slug}`);
    recs = [hits[0]];
    f.selector = `${f.query.describe.replace('; first by name', ' and digital == false and games contains paper; first by name')}; all_cards: printings of that oracle_id, `;
  }
  oracleRecords.set(f.slug, recs);
}
oracleByName.clear();
const targetOracle = new Map(); // oracle_id -> slug
for (const [slug, recs] of oracleRecords) for (const r of recs) targetOracle.set(r.oracle_id, slug);

// 2. all_cards: printings of target oracle ids + layout/printing picks -----------------------
log('pass 2: all_cards');
const printingsByOracle = new Map();
const picks = new Map(PRINT_FIXTURES.map((f) => [f.slug, []]));
const preferredPicks = new Map(PRINT_FIXTURES.map((f) => [f.slug, []]));
let n = 0;
const keepSmallest = (arr, c, k) => {
  if (arr.length < k || c.id < arr[arr.length - 1].id) {
    arr.push(c);
    arr.sort((a, b) => byKey(a.id, b.id));
    if (arr.length > k) arr.pop();
  }
};
for await (const c of records(ALL)) {
  if (++n % 100000 === 0) log(`  ${fmt(n)}…`);
  if (c.oracle_id && targetOracle.has(c.oracle_id)) (printingsByOracle.get(c.oracle_id) ?? printingsByOracle.set(c.oracle_id, []).get(c.oracle_id)).push(c);
  for (const f of PRINT_FIXTURES) {
    if (!f.pick(c)) continue;
    keepSmallest(picks.get(f.slug), c, f.n);
    if (f.prefer && f.prefer(c)) keepSmallest(preferredPicks.get(f.slug), c, f.n);
  }
}

function earliest(list, pred = () => true) {
  const sorted = list.filter(pred).sort((a, b) => byKey(printKey(a), printKey(b)));
  return sorted.find((c) => c.lang === 'en' && !c.digital && !c.promo) ?? sorted.find((c) => c.lang === 'en' && !c.digital) ?? sorted[0] ?? null;
}
const illusOf = (c) => [c.illustration_id, ...(c.card_faces ?? []).map((f) => f.illustration_id)].filter(Boolean);

// Extra oracle records needed by print fixtures (multi-artist, flavor-name, reversible faces).
const extraOracleIds = new Set();
const printSel = new Map();
for (const f of PRINT_FIXTURES) {
  const pref = preferredPicks.get(f.slug);
  const recs = f.prefer && pref.length ? pref : picks.get(f.slug);
  if (!recs.length) {
    log(`  WARNING no all_cards record for ${f.slug}`);
    continue;
  }
  printSel.set(f.slug, recs);
  for (const r of recs) {
    if (f.withOracle && r.oracle_id) extraOracleIds.add(r.oracle_id);
    if (f.faceOracles) for (const fc of r.card_faces ?? []) if (fc.oracle_id) extraOracleIds.add(fc.oracle_id);
  }
}
// counterpart (normal-named) printings for fixtures that ask for one
const counterpartOracle = new Set();
for (const f of PRINT_FIXTURES) if (f.counterpart) for (const r of printSel.get(f.slug) ?? []) if (r.oracle_id) counterpartOracle.add(r.oracle_id);
const counterpartPrintings = new Map();
if (counterpartOracle.size) {
  log('pass 2b: all_cards (counterpart printings)');
  for await (const c of records(ALL)) if (c.oracle_id && counterpartOracle.has(c.oracle_id)) (counterpartPrintings.get(c.oracle_id) ?? counterpartPrintings.set(c.oracle_id, []).get(c.oracle_id)).push(c);
}
log('pass 3: oracle_cards (records for printing fixtures)');
const extraOracle = new Map();
for await (const c of records(ORA)) if (c.oracle_id && extraOracleIds.has(c.oracle_id)) extraOracle.set(c.oracle_id, c);

// 3. write Scryfall fixtures ---------------------------------------------------------------
const scryfallTargets = new Map(); // slug -> {oracle:Set, illus:Set}
function writeScryfall(slug, purpose, selector, items) {
  // items: [{record, sourceKey, role, note?}]
  const keys = [...new Set(items.map((i) => i.sourceKey))];
  const primary = keys.includes(ALL) ? ALL : keys[0];
  const body = {
    slug,
    purpose,
    selector,
    source: sourceOf(primary),
    ...(keys.length > 1 ? { extraSources: keys.filter((k) => k !== primary).map(sourceOf) } : {}),
    recordIndex: items.map((i) => ({ id: i.record.id, sourceKey: i.sourceKey, role: i.role, name: i.record.name, layout: i.record.layout, lang: i.record.lang, set: i.record.set, collector_number: i.record.collector_number, ...(i.note ? { note: i.note } : {}) })),
    records: items.map((i) => i.record),
  };
  written.push(fixtureFile('scryfall', slug, body));
  const t = { oracle: new Set(), illus: new Set(), names: items.map((i) => i.record.name) };
  for (const { record: r } of items) {
    if (r.oracle_id) t.oracle.add(r.oracle_id);
    for (const fc of r.card_faces ?? []) if (fc.oracle_id) t.oracle.add(fc.oracle_id);
    for (const i of illusOf(r)) t.illus.add(i);
  }
  scryfallTargets.set(slug, t);
}

const deferredWithTokens = [];
for (const f of CARD_FIXTURES) {
  const oracles = oracleRecords.get(f.slug);
  const items = oracles.map((o) => ({ record: o, sourceKey: ORA, role: 'oracle', note: 'oracle_cards representative object for this oracle_id' }));
  let sel = f.selector;
  if (f.printings === 'lightning-bolt') {
    const all = printingsByOracle.get(oracles[0].oracle_id) ?? [];
    const a = earliest(all);
    const it = all.filter((c) => c.lang === 'it' && c.printed_name && c.printed_text).sort((x, y) => byKey(printKey(x), printKey(y)))[0];
    const used = new Set([...illusOf(a), ...(it ? illusOf(it) : [])]);
    const b = earliest(all, (c) => illusOf(c).some((i) => !used.has(i)));
    if (!it) log('  WARNING no Italian Lightning Bolt printing with printed_name/printed_text');
    items.push({ record: a, sourceKey: ALL, role: 'printing', note: 'earliest English paper (non-promo) printing' });
    if (it) items.push({ record: it, sourceKey: ALL, role: 'printing', note: 'earliest Italian printing with printed_name and printed_text' });
    if (b) items.push({ record: b, sourceKey: ALL, role: 'printing', note: 'earliest English paper (non-promo) printing with an illustration_id not used by the printings above' });
    sel += `picks (1) ${EARLIEST_EN}; (2) earliest lang=it with printed_name and printed_text, by (released_at, id); (3) same rule as (1) restricted to printings whose illustration_id differs from (1) and (2). ${fmt(all.length)} printings available.`;
  } else {
    for (const o of oracles) {
      const all = printingsByOracle.get(o.oracle_id) ?? [];
      const e = earliest(all);
      if (e) items.push({ record: e, sourceKey: ALL, role: 'printing', note: `earliest printing of ${o.name}` });
    }
    sel += `pick per oracle_id: ${EARLIEST_EN}.`;
  }
  if (f.withTokens) deferredWithTokens.push({ f, sel, items });
  else writeScryfall(f.slug, f.purpose, sel, items);
}
// fixtures that also need the token printings referenced by their all_parts (component == token)
if (deferredWithTokens.length) {
  const tokenIds = new Map(); // printing id -> slug
  for (const { f, items } of deferredWithTokens)
    for (const { record } of items) for (const part of record.all_parts ?? []) if (part.component === 'token' && part.id !== record.id) tokenIds.set(part.id, f.slug);
  log(`pass 2c: all_cards (token printings referenced by all_parts: ${tokenIds.size})`);
  const tokenRecs = new Map();
  for await (const c of records(ALL)) if (tokenIds.has(c.id)) tokenRecs.set(c.id, c);
  for (const { f, sel, items } of deferredWithTokens) {
    const ids = [...tokenIds].filter(([, s]) => s === f.slug).map(([id]) => id).sort();
    for (const id of ids) {
      const t = tokenRecs.get(id);
      if (t) items.push({ record: t, sourceKey: ALL, role: 'token', note: 'token printing referenced by all_parts (component token) of the records above' });
      else log(`  WARNING token printing ${id} not found in all_cards`);
    }
    writeScryfall(f.slug, f.purpose, `${sel} Plus every token printing whose id appears in all_parts[] (component == 'token') of those records, sorted by id.`, items);
  }
}

for (const f of PRINT_FIXTURES) {
  const recs = printSel.get(f.slug);
  if (!recs) continue;
  const items = recs.map((r) => ({ record: r, sourceKey: ALL, role: 'printing' }));
  let sel = f.describe;
  if (f.withOracle || f.faceOracles) {
    const ids = [...new Set(recs.flatMap((r) => (f.faceOracles ? (r.card_faces ?? []).map((fc) => fc.oracle_id) : [r.oracle_id])).filter(Boolean))];
    for (const id of ids) {
      const o = extraOracle.get(id);
      if (o) items.push({ record: o, sourceKey: ORA, role: 'oracle', note: f.faceOracles ? 'oracle_cards object whose root oracle_id equals a card_faces[].oracle_id of the reversible printing' : 'oracle_cards object for the printing’s oracle_id' });
      else log(`  WARNING oracle ${id} not found in oracle_cards`);
    }
    sel += f.faceOracles ? '; plus oracle_cards records whose oracle_id equals a face oracle_id' : '; plus the oracle_cards record of its oracle_id';
  }
  if (f.counterpart) {
    for (const r of recs) {
      const cp = earliest(counterpartPrintings.get(r.oracle_id) ?? [], f.counterpart);
      if (cp) items.push({ record: cp, sourceKey: ALL, role: 'printing', note: 'normal-named printing of the same oracle_id (no flavor_name)' });
    }
    sel += `; plus the normal-named printing of the same oracle_id: flavor_name absent, ${EARLIEST_EN}`;
  }
  writeScryfall(f.slug, f.purpose, sel, items);
}
log(`  wrote ${written.filter((w) => w.dir === 'scryfall').length} Scryfall fixtures`);

// 4. Tagger fixtures ------------------------------------------------------------------------
log('pass 4: Tagger tags');
async function loadTags(key) {
  const tags = [];
  for await (const t of readJSONL(p(sha[key].localPath))) tags.push(t);
  return tags;
}
const otags = await loadTags(OTAG);
const atags = await loadTags(ATAG);
const tagById = new Map([...otags, ...atags].map((t) => [t.id, t]));
const tagSource = (t) => (t.type === 'oracle' ? OTAG : ATAG);
const targetOf = (g) => g.oracle_id ?? g.illustration_id;

// index: target -> [{tag, tagging}]
const byTarget = new Map();
const allTargets = new Set();
for (const t of scryfallTargets.values()) {
  for (const x of t.oracle) allTargets.add(x);
  for (const x of t.illus) allTargets.add(x);
}
for (const t of [...otags, ...atags])
  for (const g of t.taggings) {
    const x = targetOf(g);
    if (allTargets.has(x)) (byTarget.get(x) ?? byTarget.set(x, []).get(x)).push({ tag: t, tagging: g });
  }

function ancestors(ids) {
  const out = new Set();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop();
    for (const pid of tagById.get(id)?.parent_ids ?? []) if (!out.has(pid) && !ids.includes(pid)) (out.add(pid), stack.push(pid));
  }
  return [...out];
}
function filtered(t, keep, included, fallbackN = 0, extraPred = null) {
  let kept = t.taggings.filter((g) => keep.has(targetOf(g)) || (extraPred && extraPred(g)));
  if (!kept.length && fallbackN) kept = [...t.taggings].sort((a, b) => byKey(targetOf(a), targetOf(b))).slice(0, fallbackN);
  return { ...t, child_ids: t.child_ids.filter((id) => included.has(id)), taggings: kept, taggingsTotal: t.taggings.length, childIdsTotal: t.child_ids.length };
}
const special = (g) => (g.annotation != null ? 2 : 0) + (g.weight !== 'median' ? 1 : 0);
const TAGGER_NOTE = 'Tag records are the original Tagger objects except: (1) taggings[] is FILTERED (see selector) and the fixture-added key `taggingsTotal` gives the unfiltered count; (2) child_ids[] is filtered to tags present in this file and the fixture-added key `childIdsTotal` gives the unfiltered count. parent_ids[] is complete: every ancestor is included, so the file is a closed sub-hierarchy in which child_ids is still the exact inverse of parent_ids. `taggingsTotal` and `childIdsTotal` are NOT source fields.';

function writeTagger(slug, purpose, selector, direct, keep, { fallbackN = 0, extraPred = null } = {}) {
  // direct: [{tag, role, for?}]
  const directIds = [...new Set(direct.map((d) => d.tag.id))];
  const anc = ancestors(directIds).map((id) => tagById.get(id)).filter(Boolean).sort((a, b) => byKey(a.type, b.type) || byKey(a.slug, b.slug));
  const seen = new Set();
  const items = [];
  for (const d of direct) if (!seen.has(d.tag.id)) (seen.add(d.tag.id), items.push({ tag: d.tag, role: d.role, for: d.for }));
  for (const t of anc) if (!seen.has(t.id)) (seen.add(t.id), items.push({ tag: t, role: 'ancestor' }));
  const keys = [...new Set(items.map((i) => tagSource(i.tag)))];
  const body = {
    slug,
    purpose,
    selector,
    note: TAGGER_NOTE,
    source: sourceOf(keys.includes(OTAG) ? OTAG : keys[0]),
    ...(keys.length > 1 ? { extraSources: keys.filter((k) => k !== (keys.includes(OTAG) ? OTAG : keys[0])).map(sourceOf) } : {}),
    targets: [...keep],
    recordIndex: items.map((i) => ({ id: i.tag.id, slug: i.tag.slug, type: i.tag.type, sourceKey: tagSource(i.tag), role: i.role, ...(i.for ? { for: i.for } : {}), parents: i.tag.parent_ids.length })),
    records: items.map((i) => filtered(i.tag, keep, seen, i.role === 'ancestor' ? 0 : fallbackN, extraPred)),
  };
  written.push(fixtureFile('tagger', slug, body));
}

const TAGGER_FOR = ['lightning-bolt', 'blood-artist', 'transform-dfc', 'mdfc', 'split', 'adventure', 'flip', 'meld', 'reversible-card', 'mana-cost-absent-vs-zero', 'variable-pt', 'modal-spell', 'ashnods-altar'];
const ORACLE_CAP = 15;
const ART_CAP = 10;
for (const slug of TAGGER_FOR) {
  const t = scryfallTargets.get(slug);
  if (!t) continue;
  const direct = [];
  const choose = (target, type, cap) => {
    const hits = (byTarget.get(target) ?? []).filter((h) => h.tag.type === type);
    hits.sort((a, b) => special(b.tagging) - special(a.tagging) || (b.tag.parent_ids.length > 0) - (a.tag.parent_ids.length > 0) || byKey(a.tag.slug, b.tag.slug));
    for (const h of hits.slice(0, cap)) direct.push({ tag: h.tag, role: type === 'oracle' ? 'assigned-oracle-tag' : 'assigned-art-tag', for: target });
    return hits.length;
  };
  const counts = [];
  for (const o of [...t.oracle].sort()) counts.push(`${o.slice(0, 8)}…: ${choose(o, 'oracle', ORACLE_CAP)} oracle tags`);
  for (const i of [...t.illus].sort()) counts.push(`${i.slice(0, 8)}…: ${choose(i, 'illustration', ART_CAP)} art tags`);
  if (!direct.length) continue;
  const keep = new Set([...t.oracle, ...t.illus]);
  writeTagger(
    slug,
    `Tagger tags assigned to the cards/illustrations of fixtures/scryfall/${slug}.json, plus the full parent chain of each tag.`,
    `oracle_tags: taggings[].oracle_id ∈ fixture oracle ids; art_tags: taggings[].illustration_id ∈ fixture illustration ids. Per target, tags sorted by (tagging has annotation / non-median weight first, tag has parents first, slug) and capped at ${ORACLE_CAP} oracle / ${ART_CAP} art tags. Ancestors = transitive closure over parent_ids. taggings[] filtered to the fixture targets. Available per target: ${counts.join('; ')}.`,
    direct,
    keep,
  );
}

// multi-parent oracle tag
{
  const cand = otags.filter((t) => t.parent_ids.length >= 3);
  const onFixture = (t) => t.taggings.some((g) => allTargets.has(targetOf(g)));
  cand.sort((a, b) => onFixture(b) - onFixture(a) || b.taggings.length - a.taggings.length || byKey(a.slug, b.slug));
  const t = cand[0];
  writeTagger(
    'multi-parent-tag',
    'An oracle tag with ≥3 parents (multiple inheritance in the Tagger hierarchy) and its full parent chain (PLAN §4.2 #16).',
    `oracle_tags: parent_ids.length >= 3; prefer tags with a tagging on any Scryfall fixture oracle id, then most taggings, then slug → ${t.slug} (${t.parent_ids.length} parents). taggings[] filtered to Scryfall fixture oracle ids (fallback: first 3 by oracle_id).`,
    [{ tag: t, role: 'example-multi-parent' }],
    allTargets,
    { fallbackN: 3 },
  );
}

// weak + annotated art taggings
{
  const pickArt = (pred) => {
    const sorted = [...atags].sort((a, b) => byKey(a.slug, b.slug));
    return sorted.find((t) => t.taggings.some((g) => pred(g) && allTargets.has(targetOf(g)))) ?? sorted.find((t) => t.taggings.some(pred));
  };
  const isWeak = (g) => g.weight === 'weak';
  const hasAnn = (g) => g.annotation != null;
  const weak = pickArt(isWeak);
  const ann = pickArt(hasAnn);
  const firstOf = (t, pred) => [...t.taggings].filter(pred).sort((a, b) => byKey(targetOf(a), targetOf(b)))[0];
  const keepIds = new Set([...allTargets]);
  const wg = firstOf(weak, (g) => isWeak(g) && allTargets.has(targetOf(g))) ?? firstOf(weak, isWeak);
  const ag = firstOf(ann, (g) => hasAnn(g) && allTargets.has(targetOf(g))) ?? firstOf(ann, hasAnn);
  const special2 = (g) => g === wg || g === ag;
  writeTagger(
    'art-tag-weak-and-annotated',
    'An art tag with a `weak` tagging and an art tag with an `annotation` (PLAN §4.2 #16), plus their parent chains.',
    `art_tags sorted by slug; first tag having a weight=='weak' tagging (preferring one on a Scryfall fixture illustration) → ${weak.slug}; first tag having a tagging with annotation (same preference) → ${ann.slug}. taggings[] keeps the selected weak/annotated tagging (first by illustration_id) plus any tagging on fixture illustrations.`,
    [{ tag: weak, role: 'example-weak-tagging' }, { tag: ann, role: 'example-annotated-tagging' }],
    keepIds,
    { extraPred: special2 },
  );
}
log(`  wrote ${written.filter((w) => w.dir === 'tagger').length} Tagger fixtures`);

// 5. Spellbook fixtures --------------------------------------------------------------------
log('pass 5: Spellbook variants (streaming)');
const BA = oracleRecords.get('blood-artist')[0].oracle_id;
const AA = oracleRecords.get('ashnods-altar')[0].oracle_id;
const fixtureOracleIds = new Set([...scryfallTargets.values()].flatMap((t) => [...t.oracle]));
const sizeKey = (v) => [(v.uses ?? []).length, (v.requires ?? []).length, JSON.stringify(v).length, v.id];
const cmpKey = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};
const best = { ba: [], aa: [], tpl: [], nonok: [], aliasNull: [], aliasRedirect: [], usedFace: [] };
const keepBest = (arr, v, k, key) => {
  const kv = key(v);
  if (arr.length < k || cmpKey(kv, arr[arr.length - 1].k) < 0) {
    arr.push({ v, k: kv });
    arr.sort((a, b) => cmpKey(a.k, b.k));
    if (arr.length > k) arr.pop();
  }
};
const meta = {};
const queue = [];
const filter = (stack) => {
  if (stack.length === 1 && stack[0] !== 'variants' && stack[0] !== 'aliases') return queue.push(stack[0]), true;
  if (stack.length === 2 && (stack[0] === 'variants' || stack[0] === 'aliases') && typeof stack[1] === 'number') return queue.push(stack[0]), true;
  return false;
};
let statusCounts = {};
await streamJSONGz(p(sha[SB].localPath), filter, (v) => {
  const k = queue.shift();
  if (k === 'aliases') {
    if (v.variant == null) keepBest(best.aliasNull, v, 2, (a) => [a.id]);
    else keepBest(best.aliasRedirect, v, 2, (a) => [a.id]);
    return;
  }
  if (k !== 'variants') return void (meta[k] = v);
  statusCounts[v.status] = (statusCounts[v.status] ?? 0) + 1;
  const oids = new Set((v.uses ?? []).map((u) => u.card?.oracleId));
  if (v.status === 'OK' && oids.has(BA)) keepBest(best.ba, v, 2, sizeKey);
  if (v.status === 'OK' && oids.has(AA) && !oids.has(BA)) keepBest(best.aa, v, 2, sizeKey);
  if ((v.requires ?? []).length) keepBest(best.tpl, v, 1, (x) => [[...oids].some((o) => fixtureOracleIds.has(o)) ? 0 : 1, ...sizeKey(x)]);
  if (v.status !== 'OK') keepBest(best.nonok, v, 1, sizeKey);
  if ((v.uses ?? []).some((u) => u.usedFace != null)) keepBest(best.usedFace, v, 1, sizeKey);
});
const sbSource = { ...sourceOf(SB), exportTimestamp: meta.timestamp ?? null, exportVersion: meta.version ?? null };
const SIZE_RULE = 'sorted by (uses.length, requires.length, serialized length, id) ascending';
function writeSpellbook(slug, purpose, selector, variants, role = 'variant') {
  const body = {
    slug,
    purpose,
    selector,
    source: sbSource,
    recordIndex: variants.map((v) => ({ id: v.id, role, status: v.status, cards: (v.uses ?? []).map((u) => u.card?.name), templates: (v.requires ?? []).map((r) => r.template?.name), features: (v.produces ?? []).length })),
    records: variants,
  };
  written.push(fixtureFile('spellbook', slug, body));
}
writeSpellbook('blood-artist-variants', 'Small Commander Spellbook variants using Blood Artist (cards → features), linkable to fixtures/scryfall/blood-artist.json.', `variants: status == 'OK' and uses[].card.oracleId == ${BA} (Blood Artist); ${SIZE_RULE}; first 2.`, best.ba.map((x) => x.v));
writeSpellbook('ashnods-altar-variants', "Small Commander Spellbook variants using Ashnod's Altar (and not Blood Artist), linkable to fixtures/scryfall/ashnods-altar.json.", `variants: status == 'OK' and uses[].card.oracleId == ${AA} (Ashnod's Altar) and not Blood Artist; ${SIZE_RULE}; first 2.`, best.aa.map((x) => x.v));
writeSpellbook('variant-with-template', 'A variant whose requirements include a template (requires[].template), i.e. "any card matching …" rather than a named card (PLAN §4.2 #15).', `variants: requires non-empty; prefer variants using any Scryfall fixture oracle id, then ${SIZE_RULE}; first 1.`, best.tpl.map((x) => x.v));
writeSpellbook('variant-with-used-face', 'A variant that names which face of a multi-faced card it uses (uses[].usedFace, 1-based), to map card uses to a specific CardFace.', `variants: some uses[].usedFace != null; ${SIZE_RULE}; first 1.`, best.usedFace.map((x) => x.v));
if (best.nonok.length) writeSpellbook('variant-non-ok-status', 'A variant whose status is not OK.', `variants: status != 'OK'; ${SIZE_RULE}; first 1.`, best.nonok.map((x) => x.v));
else log(`  no variant with status != OK in this export (statuses: ${JSON.stringify(statusCounts)}) — no non-OK fixture written`);
writeSpellbook('aliases', 'Alias records from the export: former variant ids that redirect to a current variant id, or to null.', 'aliases: variant == null → first 2 by id; variant != null → first 2 by id.', [...best.aliasNull, ...best.aliasRedirect].map((x) => x.v), 'alias');
log(`  wrote ${written.filter((w) => w.dir === 'spellbook').length} Spellbook fixtures`);

// 5b. Rulings: every ruling of every Oracle card in the Scryfall fixtures --------------------
log('pass 6: rulings');
const rulingOracles = new Set([...scryfallTargets.values()].flatMap((t) => [...t.oracle]));
const rulings = [];
for await (const r of records(RUL)) if (rulingOracles.has(r.oracle_id)) rulings.push(r);
rulings.sort((a, b) => byKey(a.oracle_id, b.oracle_id) || byKey(a.published_at, b.published_at) || byKey(a.comment, b.comment));
written.push(
  fixtureFile('rulings', 'fixture-card-rulings', {
    slug: 'fixture-card-rulings',
    purpose: 'All rulings (Wizards and Scryfall) for the Oracle cards in the Scryfall fixtures: input for the Ruling claims.',
    selector: `rulings: oracle_id in the ${rulingOracles.size} Oracle ids of fixtures/scryfall/*; sorted by (oracle_id, published_at, comment).`,
    source: sourceOf(RUL),
    recordIndex: rulings.map((r, i) => ({ id: `${r.oracle_id}#${i}`, sourceKey: RUL, role: 'ruling', source: r.source, published_at: r.published_at })),
    records: rulings,
  }),
);
log(`  wrote ${rulings.length} rulings for ${new Set(rulings.map((r) => r.oracle_id)).size} Oracle cards`);

// 6. README -------------------------------------------------------------------------------
const snap = (s) => `${s.key} \`${s.file}\` (sha256 \`${s.sha256.slice(0, 12)}…\`${s.sourceUpdatedAt ? `, updated ${s.sourceUpdatedAt}` : ''}${s.exportTimestamp ? `, export ${s.exportTimestamp} v${s.exportVersion}` : ''})`;
const section = (dir, title) => {
  const rows = written.filter((w) => w.dir === dir).map((w) => [
    `[\`${w.slug}\`](${dir}/${w.slug}.json)`,
    w.purpose,
    w.selector,
    [w.source, ...(w.extraSources ?? [])].map(snap).join('; '),
    (w.dir === 'tagger' ? 'tag slugs (ids in recordIndex): ' : '') + w.ids.map((i) => `\`${i}\``).join(', '),
    `${(w.bytes / 1024).toFixed(1)} KB`,
  ]);
  return [`## ${title}`, '', mdTable(['slug', 'why selected', 'selector', 'source snapshot', 'record ids', 'size'], rows), ''].join('\n');
};
const readme = [
  '# Source fixtures',
  '',
  'Small, versioned extracts of the raw source snapshots in `data/raw/` (see `data/raw/manifest.json` and `docs/source-audit/sources.json`).',
  'Generated by `tools/audit/extract-fixtures.mjs` (`npm run fixtures`); do not edit by hand — change the selectors in the script and re-run.',
  '',
  '**Rules.** Every record is selected by a deterministic query over the snapshot (recorded in `selector`). Records are the original source JSON objects, unmodified, with one documented exception: Tagger tag records have `taggings[]` filtered to the fixture targets and `child_ids[]` filtered to tags present in the same file, with fixture-added keys `taggingsTotal` / `childIdsTotal` holding the unfiltered counts (these two keys are not source fields; `parent_ids[]` is untouched and every ancestor is included). Nothing is synthetic.',
  '',
  'File shape: `{ slug, purpose, selector, source:{key,file,sha256,sourceUpdatedAt}, extraSources?:[…], recordIndex:[{id, sourceKey, role, …}], records:[…] }`. Scryfall records are embedded as the **exact source bytes** (one JSONL line per record, e.g. `"cmc":3.0` is preserved); Tagger and Spellbook records are re-serialised with `JSON.stringify` (values unchanged; number lexemes such as `2.0` may print as `2`). `recordIndex[i]` describes `records[i]`: which dump it came from and its role. Note that a Scryfall `oracle_cards` record is itself a full card object of one representative printing (role `oracle`), so the same `id` may appear twice in a file — once as role `oracle` (from oracle_cards) and once as role `printing` (from all_cards).',
  '',
  section('scryfall', 'Scryfall (`fixtures/scryfall/`)'),
  section('tagger', 'Scryfall Tagger (`fixtures/tagger/`)'),
  section('spellbook', 'Commander Spellbook (`fixtures/spellbook/`)'),
  section('rulings', 'Scryfall rulings (`fixtures/rulings/`)'),
  best.nonok.length ? '' : `No variant with a status other than \`OK\` exists in this Spellbook export (statuses: ${Object.entries(statusCounts).map(([a, b]) => `\`${a}\` ${fmt(b)}`).join(', ')}), so there is no non-OK variant fixture.`,
  '',
].join('\n');
writeText(p('fixtures', 'README.md'), readme);
log(`wrote fixtures/README.md (${written.length} fixture files)`);
for (const w of written) log(`  ${w.file}  ${(w.bytes / 1024).toFixed(1)} KB  [${w.ids.length} records]`);
