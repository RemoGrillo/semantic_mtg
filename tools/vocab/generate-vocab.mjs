#!/usr/bin/env node
// Generate SMTG controlled vocabularies (SKOS concepts typed with SMTG classes)
// from Scryfall catalogs, symbology, sets and the values actually observed in
// all_cards. Codes are never invented: a concept exists only if the code was
// observed; curated text (tools/vocab/curated.mjs) only adds labels/definitions.
//
// Output: ontology/vocab/smtg-vocab.ttl  +  data/derived/enum-values.json (cache)
//         docs/source-audit/type-line-residue.json (type-line words not in catalogs)
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import path from 'node:path';
import { p, rawFile, rawManifest, readJSON, writeJSON, ensureDir, log } from '../lib/common.mjs';
import { prefixBlock, iri, lit, en, slug, symbolSlug, block, V } from '../lib/rdf.mjs';
import * as C from './curated.mjs';

const FORCE = process.argv.includes('--rescan');
const CACHE = p('data', 'derived', 'enum-values.json');

const catalog = (name) => readJSON(rawFile(`scryfall:catalog:${name}`)).data;
const SUPERTYPES = catalog('supertypes');
const CARD_TYPES = catalog('card-types');
const SUBTYPE_CATALOGS = {
  'creature-type': ['creature-types', 'CreatureType', ['Creature', 'Kindred']],
  'artifact-type': ['artifact-types', 'ArtifactType', ['Artifact']],
  'enchantment-type': ['enchantment-types', 'EnchantmentType', ['Enchantment']],
  'land-type': ['land-types', 'LandType', ['Land']],
  'planeswalker-type': ['planeswalker-types', 'PlaneswalkerType', ['Planeswalker']],
  'spell-type': ['spell-types', 'SpellType', ['Instant', 'Sorcery']],
  'battle-type': ['battle-types', 'BattleType', ['Battle']],
};
const subtypeIndex = new Map(); // name -> [scheme,…]
for (const [scheme, [cat]] of Object.entries(SUBTYPE_CATALOGS)) {
  for (const n of catalog(cat)) subtypeIndex.set(n, [...(subtypeIndex.get(n) ?? []), scheme]);
}
const multiwordSubtypes = [...subtypeIndex.keys()].filter((n) => n.includes(' ')).sort((a, b) => b.length - a.length);

function parseTypeLine(tl) {
  // returns { left: [words], subtypes: [names] } for one face type line
  const [left, right] = tl.split(' — ');
  const leftWords = (left ?? '').trim().split(/\s+/).filter(Boolean);
  const subs = [];
  if (right) {
    let rest = ` ${right.trim()} `;
    for (const mw of multiwordSubtypes) {
      if (rest.includes(` ${mw} `)) {
        subs.push(mw);
        rest = rest.replace(` ${mw} `, ' ');
      }
    }
    subs.push(...rest.trim().split(/\s+/).filter(Boolean));
  }
  return { leftWords, subs };
}

async function scanAllCards() {
  if (!FORCE && fs.existsSync(CACHE)) return readJSON(CACHE);
  const file = rawFile('scryfall:all_cards');
  log(`scanning ${path.basename(file)} for enumerated values (cached afterwards)…`);
  const E = {};
  const bump = (k, v) => {
    if (v === undefined || v === null || v === '') return;
    E[k] ??= {};
    E[k][v] = (E[k][v] ?? 0) + 1;
  };
  const residueLeft = {}, residueSub = {};
  let n = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    n++;
    for (const k of ['layout', 'lang', 'rarity', 'border_color', 'frame', 'security_stamp', 'image_status', 'set_type', 'watermark'])
      bump(k, c[k]);
    for (const k of ['frame_effects', 'finishes', 'games', 'promo_types', 'keywords', 'produced_mana', 'color_identity'])
      for (const v of c[k] ?? []) bump(k, v);
    for (const [f, s] of Object.entries(c.legalities ?? {})) { bump('legalities.format', f); bump('legalities.status', s); }
    for (const k of Object.keys(c.prices ?? {})) bump('prices.key', k);
    for (const k of Object.keys(c.image_uris ?? {})) bump('image_uris.key', k);
    for (const part of c.all_parts ?? []) bump('all_parts.component', part.component);
    const faces = c.card_faces?.length ? c.card_faces : [c];
    for (const f of faces) {
      if (f.watermark && f !== c) bump('watermark', f.watermark);
      for (const k of Object.keys(f.image_uris ?? {})) bump('image_uris.key', k);
      if (f.layout && f !== c) bump('face.layout', f.layout);
      if (c.lang !== 'en' || !f.type_line) continue; // parse English Oracle type lines only
      const { leftWords, subs } = parseTypeLine(f.type_line);
      for (const w of leftWords) {
        if (SUPERTYPES.includes(w)) bump('supertype', w);
        else if (CARD_TYPES.includes(w)) bump('card_type', w);
        else residueLeft[w] = (residueLeft[w] ?? 0) + 1;
      }
      for (const s of subs) {
        if (subtypeIndex.has(s)) bump('subtype', s);
        else {
          const ctx = leftWords.filter((w) => CARD_TYPES.includes(w)).join(' ') || '(none)';
          residueSub[s] ??= {};
          residueSub[s][ctx] = (residueSub[s][ctx] ?? 0) + 1;
        }
      }
    }
  }
  const out = { records: n, file: path.basename(file), values: E, residue: { typeWords: residueLeft, subtypes: residueSub } };
  writeJSON(CACHE, out);
  log(`scanned ${n} records`);
  return out;
}

const scan = await scanAllCards();
const obs = (k) => scan.values[k] ?? {};
const snapshot = rawManifest().files.filter((f) => f.key === 'scryfall:all_cards').at(-1);

writeJSON(p('docs', 'source-audit', 'type-line-residue.json'), {
  note: 'Words in English type lines that are not in the Scryfall supertype/card-type/subtype catalogs. Not dropped: unknown subtypes become smtg:OtherSubtype concepts; non-type words (e.g. Token) are reported here for review (RQ-TY-2).',
  snapshot: snapshot?.localPath,
  ...scan.residue,
});

// ---------------------------------------------------------------------------
const out = [];
const header = prefixBlock({ dcat: 'http://www.w3.org/ns/dcat#' });
out.push(header, '');
out.push(`# GENERATED by tools/vocab/generate-vocab.mjs — do not edit by hand.
# Source snapshot: ${snapshot?.localPath} (sha256 ${snapshot?.sha256?.slice(0, 16)}…, updated ${snapshot?.sourceUpdatedAt})
# Curated labels/definitions: tools/vocab/curated.mjs
`);
out.push(block('smtgm:vocab', [
  ['a', 'owl:Ontology'],
  ['rdfs:label', en('SMTG generated vocabularies')],
  ['dcterms:title', en('Generated vocabularies: concepts observed in the sources, with curated definitions')],
  ['dcterms:description', en('Controlled-vocabulary concepts generated from Scryfall catalogs, symbology and the values observed in the all_cards snapshot, enriched with curated labels and definitions. Codes are never invented; counts of observations are recorded as smtg:observedCount.')],
  ['owl:versionInfo', lit('0.1.0-draft')],
  ['smtg:moduleOrder', '12'],
  ['vs:term_status', lit('unstable')],
  ['owl:imports', 'smtgm:taxonomies , smtgm:cards'],
]));
out.push(block('smtg:observedCount', [
  ['a', 'owl:AnnotationProperty'],
  ['rdfs:label', en('observed count')],
  ['skos:definition', en('How many times the code was observed in the source snapshot used to generate the vocabulary (documentation only).')],
  ['rdfs:isDefinedBy', 'smtgm:vocab'],
]));

const schemes = [];
function scheme(id, label, cls, def, extra = []) {
  schemes.push(id);
  out.push(`\n# ---- ${label} ----\n`);
  out.push(block(iri(V + id), [
    ['a', 'skos:ConceptScheme'],
    ['rdfs:label', en(label)],
    ['skos:definition', def ? en(def) : undefined],
    ['smtg:conceptClass', `smtg:${cls}`],
    ['rdfs:isDefinedBy', 'smtgm:vocab'],
    ...extra,
  ]));
}
const conceptIris = {};
function concept(schemeId, code, cls, { label, def, alt = [], notation = code, count, extra = [], status, sourceValueOf } = {}) {
  let u = `${V}${schemeId}/${typeof code === 'string' && /^[A-Za-z0-9_-]+$/.test(code) ? code : slug(code)}`;
  // Duplicate codes differing only in case/punctuation (catalog duplicates, Un-card spellings)
  // get a numbered suffix instead of being merged or dropped.
  for (let i = 2; conceptIris[u]; i++) u = u.replace(/(__\d+)?$/, `__${i}`);
  conceptIris[u] = true;
  out.push(block(iri(u), [
    ['a', `smtg:${cls}`],
    ['skos:inScheme', iri(V + schemeId)],
    ['skos:prefLabel', en(label ?? code)],
    ...alt.map((a) => ['skos:altLabel', en(a)]),
    ['skos:notation', lit(notation)],
    ['skos:definition', def ? en(def) : undefined],
    ['smtg:sourceValueOf', sourceValueOf ? lit(sourceValueOf) : undefined],
    ['smtg:observedCount', count !== undefined ? String(count) : undefined],
    ['vs:term_status', status ? lit(status) : undefined],
    ['rdfs:isDefinedBy', 'smtgm:vocab'],
    ...extra,
  ]));
  return u;
}
const allDifferent = (iris) => out.push(`[] a owl:AllDifferent ; owl:distinctMembers ( ${iris.map(iri).join(' ')} ) .\n`);
const title = (s) => s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// Face configurations & object kinds (curated, conceptual)
scheme('face-configuration', 'Face configurations', 'FaceConfiguration', 'Physical arrangements of card faces.');
for (const [k, v] of Object.entries(C.FACE_CONFIGS)) concept('face-configuration', k, 'FaceConfiguration', { label: v.label, def: v.def, status: 'unstable' });
scheme('object-kind', 'Game object kinds', 'GameObjectKind', 'Kinds of game object a card record can describe.');
for (const [k, v] of Object.entries(C.OBJECT_KINDS)) concept('object-kind', k, 'GameObjectKind', { label: v.label, def: v.def, status: 'unstable' });

// Layouts (observed codes only)
scheme('layout', 'Card layouts', 'Layout', 'Scryfall layout codes observed in the all_cards snapshot (root and face level).');
const layoutObs = { ...obs('layout') };
for (const [k, n] of Object.entries(obs("face.layout"))) if (!layoutObs[k]) layoutObs[k] = n;
const layoutIris = [];
for (const code of Object.keys(layoutObs).sort()) {
  const cur = C.LAYOUTS[code];
  if (!cur) log(`WARNING: layout "${code}" has no curated definition — emitted as unstable`);
  layoutIris.push(concept('layout', code, 'Layout', {
    label: cur?.label ?? title(code),
    def: cur?.def ?? `Scryfall layout code "${code}" observed in the source; no curated definition yet.`,
    count: layoutObs[code],
    sourceValueOf: 'scryfall:layout',
    status: cur && !cur.unstable ? undefined : 'unstable',
    extra: cur ? [
      ['smtg:impliesFaceConfiguration', iri(`${V}face-configuration/${cur.fc}`)],
      ['smtg:impliesObjectKind', iri(`${V}object-kind/${cur.ok ?? 'traditional-card'}`)],
      ['smtg:faceCount', lit(cur.faces)], ['smtg:physicalSides', lit(cur.sides)],
      ['smtg:faceArrangement', en(cur.arr)],
      ['smtg:separateOracleIdentity', lit(cur.sep ?? 'no')],
      ['smtg:definedClass', cur.cls ? `smtg:${cur.cls}` : undefined],
      ['skos:scopeNote', cur.printingOnly ? en('Printing convention: recorded with smtg:printingLayout on the printing; the Oracle card keeps its game layout.') : undefined],
    ] : [],
  }));
}
for (const k of Object.keys(C.LAYOUTS)) if (!layoutObs[k]) log(`note: curated layout "${k}" not observed — not emitted`);
allDifferent(layoutIris);

// Sides & orientations & image variants (curated, structural)
scheme('side', 'Physical sides', 'Side');
for (const [k, d] of Object.entries(C.SIDES)) concept('side', k, 'Side', { label: title(k), def: d });
scheme('orientation', 'Face orientations', 'Orientation');
for (const [k, d] of Object.entries(C.ORIENTATIONS)) concept('orientation', k, 'Orientation', { label: title(k), def: d, status: 'unstable' });
scheme('image-variant', 'Image variants', 'ImageVariant', 'Image renditions offered by Scryfall (keys of image_uris).');
for (const k of Object.keys(obs('image_uris.key')).sort()) concept('image-variant', k, 'ImageVariant', { label: title(k), def: C.IMAGE_VARIANTS[k], count: obs('image_uris.key')[k], sourceValueOf: 'scryfall:image_uris.*' });

// Colours and combinations
scheme('color', 'Colors', 'Color', 'The five colours of Magic.');
const colorIri = {};
for (const [k, l] of C.COLORS) colorIri[k] = concept('color', k, 'Color', { label: l, def: `The colour ${l.toLowerCase()}.`, extra: [['smtg:symbol', lit(`{${k}}`)]] });
allDifferent(Object.values(colorIri));
scheme('color-combination', 'Color combinations', 'ColorCombination', 'All 32 subsets of {W, U, B, R, G}, in WUBRG order; C = colourless.');
const WUBRG = ['W', 'U', 'B', 'R', 'G'];
const combos = [];
for (let mask = 0; mask < 32; mask++) combos.push(WUBRG.filter((_, i) => mask & (1 << i)));
const comboCode = (cs) => (cs.length ? cs.join('') : 'C');
const comboIri = (cs) => `${V}color-combination/${comboCode(cs)}`;
for (const cs of combos) {
  const code = comboCode(cs);
  const names = C.COMBO_NAMES[code] ?? [];
  const supersets = combos.filter((o) => cs.every((c) => o.includes(c)));
  concept('color-combination', code, 'ColorCombination', {
    label: cs.length ? `${code}${names[0] ? ` (${names[0]})` : ''}` : 'Colorless',
    alt: names,
    def: cs.length ? `Exactly the colours ${cs.map((c) => C.COLORS.find(([k]) => k === c)[1].toLowerCase()).join(', ')}.` : 'No colours (colourless).',
    extra: [
      ...cs.map((c) => ['smtg:includesColor', iri(colorIri[c])]),
      ['smtg:colorCount', String(cs.length)],
      ['smtg:symbol', lit(cs.length ? cs.map((c) => `{${c}}`).join('') : '{C}')],
      ...supersets.map((o) => ['smtg:subCombinationOf', iri(comboIri(o))]),
    ],
  });
}
allDifferent(combos.map(comboIri));

// Mana & card symbols (Scryfall symbology)
const symbology = readJSON(rawFile('scryfall:symbology')).data;
scheme('mana-symbol', 'Mana and card symbols', 'ManaSymbol', 'Symbols of the brace notation, from Scryfall /symbology.');
for (const s of symbology) {
  concept('mana-symbol', symbolSlug(s.symbol), 'ManaSymbol', {
    label: s.symbol, notation: s.symbol, def: s.english ? s.english.replace(/^./, (c) => c.toUpperCase()) : undefined,
    sourceValueOf: 'scryfall-symbology:symbol',
    extra: [
      ['smtg:symbol', lit(s.symbol)],
      ['smtg:representsMana', lit(String(!!s.represents_mana), 'xsd:boolean')],
      ['smtg:symbolManaValue', s.mana_value !== null && s.mana_value !== undefined ? lit(String(s.mana_value), 'xsd:decimal') : undefined],
      ...(s.colors ?? []).map((c) => ['smtg:symbolColor', iri(colorIri[c])]),
      ['skos:hiddenLabel', s.loose_variant ? lit(s.loose_variant) : undefined],
    ],
  });
}

// Type system
scheme('supertype', 'Supertypes', 'Supertype', 'Scryfall catalog "supertypes".');
for (const t of SUPERTYPES) concept('supertype', slug(t), 'Supertype', { label: t, notation: t, count: obs('supertype')[t] ?? 0, sourceValueOf: 'scryfall:type_line' });
scheme('card-type', 'Card types', 'CardType', 'Scryfall catalog "card-types".');
const cardTypeIri = {};
for (const t of CARD_TYPES) cardTypeIri[t] = concept('card-type', slug(t), 'CardType', { label: t, notation: t, count: obs('card_type')[t] ?? 0, sourceValueOf: 'scryfall:type_line' });
for (const [schemeId, [cat, cls, applies]] of Object.entries(SUBTYPE_CATALOGS)) {
  scheme(schemeId, title(schemeId.replace('-', ' ')) + 's', cls, `Scryfall catalog "${cat}".`,
    applies.filter((t) => cardTypeIri[t]).map((t) => ['smtg:applicableToCardType', iri(cardTypeIri[t])]));
  const seen = new Set();
  for (const t of catalog(cat)) {
    let s = slug(t);
    while (seen.has(s)) s += '_';
    seen.add(s);
    const others = (subtypeIndex.get(t) ?? []).filter((x) => x !== schemeId);
    concept(schemeId, s, cls, {
      label: t, notation: t, count: obs('subtype')[t] ?? 0, sourceValueOf: 'scryfall:type_line',
      extra: others.length ? [['skos:editorialNote', en(`The same word is also a ${others.join(', ')} — a different concept (RQ-TY-1).`)]] : [],
    });
  }
}
scheme('other-subtype', 'Other subtypes (uncatalogued)', 'OtherSubtype', 'Subtype words observed in English type lines but absent from the Scryfall subtype catalogs (planar types, dungeon/attraction subtypes, …). Kept pending curation (RQ-TY-2).');
const otherSeen = new Set();
for (const [w, ctx] of Object.entries(scan.residue.subtypes).sort()) {
  const total = Object.values(ctx).reduce((a, b) => a + b, 0);
  let s = slug(w);
  while (otherSeen.has(s)) s += '_';
  otherSeen.add(s);
  concept('other-subtype', s, 'OtherSubtype', {
    label: w, notation: w, count: total, status: 'unstable', sourceValueOf: 'scryfall:type_line',
    extra: [['skos:scopeNote', en(`Observed with card types: ${Object.entries(ctx).map(([k, v]) => `${k} (${v})`).join(', ')}.`)]],
  });
}

// Keywords
const kwSchemes = { 'keyword-ability': ['keyword-abilities', 'KeywordAbility'], 'keyword-action': ['keyword-actions', 'KeywordAction'], 'ability-word': ['ability-words', 'AbilityWord'], 'flavor-word': ['flavor-words', 'FlavorWord'] };
const kwKnown = new Set();
for (const [schemeId, [cat, cls]] of Object.entries(kwSchemes)) {
  scheme(schemeId, title(schemeId.replace('-', ' ')) + 's', cls, `Scryfall catalog "${cat}".`);
  for (const k of catalog(cat)) {
    kwKnown.add(k);
    concept(schemeId, slug(k), cls, { label: k, notation: k, count: obs('keywords')[k] ?? 0, sourceValueOf: 'scryfall:keywords' });
  }
}
const kwOther = Object.keys(obs('keywords')).filter((k) => !kwKnown.has(k));
if (kwOther.length) {
  scheme('keyword-other', 'Uncatalogued keywords', 'Keyword', 'Values of the Scryfall keywords field not present in any keyword catalog.');
  for (const k of kwOther.sort()) concept('keyword-other', slug(k), 'Keyword', { label: k, notation: k, count: obs('keywords')[k], status: 'unstable', sourceValueOf: 'scryfall:keywords' });
}

// Formats & legality
scheme('format', 'Formats', 'Format', 'Formats for which Scryfall reports legality (keys of legalities).');
for (const f of Object.keys(obs('legalities.format')).sort()) concept('format', f, 'Format', { label: title(f), sourceValueOf: 'scryfall:legalities.*' });
scheme('legality-status', 'Legality statuses', 'LegalityStatus');
for (const s of Object.keys(obs('legalities.status')).sort()) concept('legality-status', s, 'LegalityStatus', { label: title(s), def: C.LEGALITY[s], count: obs('legalities.status')[s], sourceValueOf: 'scryfall:legalities.*' });

// Printing attributes
scheme('rarity', 'Rarities', 'Rarity');
for (const r of Object.keys(obs('rarity')).sort()) concept('rarity', r, 'Rarity', { label: C.RARITIES[r]?.[1] ?? title(r), count: obs('rarity')[r], sourceValueOf: 'scryfall:rarity', extra: [['smtg:ordinalRank', C.RARITIES[r] ? String(C.RARITIES[r][0]) : undefined]] });
const simple = [
  ['border-color', 'Border colors', 'BorderColor', 'border_color'],
  ['frame', 'Frame versions', 'FrameVersion', 'frame'],
  ['frame-effect', 'Frame effects', 'FrameEffect', 'frame_effects'],
  ['finish', 'Finishes', 'Finish', 'finishes', C.FINISHES],
  ['game', 'Games', 'Game', 'games', C.GAMES],
  ['promo-type', 'Promo types', 'PromoType', 'promo_types'],
  ['security-stamp', 'Security stamps', 'SecurityStamp', 'security_stamp'],
  ['image-status', 'Image statuses', 'ImageStatus', 'image_status'],
  ['watermark', 'Watermarks', 'Watermark', 'watermark'],
  ['set-type', 'Set types', 'SetType', 'set_type'],
  ['part-component', 'Part components', 'PartComponent', 'all_parts.component', C.COMPONENTS],
];
for (const [id, label, cls, key, defs] of simple) {
  scheme(id, label, cls, `Values of Scryfall ${key} observed in the snapshot.`);
  for (const v of Object.keys(obs(key)).sort()) concept(id, slug(v) === v ? v : slug(v), cls, { label: title(v), notation: v, def: defs?.[v], count: obs(key)[v], sourceValueOf: `scryfall:${key}` });
}
scheme('language', 'Languages', 'Language', 'Scryfall print-language codes observed in the snapshot.');
for (const l of Object.keys(obs('lang')).sort()) {
  const [label, bcp] = C.LANGUAGES[l] ?? [l, null];
  concept('language', l, 'Language', { label, count: obs('lang')[l], sourceValueOf: 'scryfall:lang', extra: [['smtg:bcp47', bcp ? lit(bcp) : undefined]] });
}
scheme('currency', 'Currencies', 'Currency', 'Keys of Scryfall prices.');
for (const k of Object.keys(obs('prices.key')).sort()) concept('currency', k, 'Currency', { label: k.toUpperCase().replace('_', ' '), def: C.CURRENCIES[k], sourceValueOf: 'scryfall:prices.*' });
scheme('ranking-system', 'Ranking systems', 'RankingSystem');
for (const [k, [l, d]] of Object.entries(C.RANKINGS)) concept('ranking-system', k, 'RankingSystem', { label: l, def: d });
scheme('zone', 'Game zones', 'Zone', 'Zone codes as used by Commander Spellbook zoneLocations.');
for (const [k, l] of Object.entries(C.ZONES)) concept('zone', k, 'Zone', { label: l, notation: k, def: `The ${l.toLowerCase()}.`, sourceValueOf: 'spellbook:variants[].uses[].zoneLocations' });

ensureDir(p('ontology', 'vocab'));
fs.writeFileSync(p('ontology', 'vocab', 'smtg-vocab.ttl'), out.join('\n'));
log(`wrote ontology/vocab/smtg-vocab.ttl: ${schemes.length} schemes, ${Object.keys(conceptIris).length} concepts`);
