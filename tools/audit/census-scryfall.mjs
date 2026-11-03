#!/usr/bin/env node
// Phase 0 — Scryfall field census over the raw bulk snapshots (streamed, never fully loaded).
//   all_cards    -> docs/source-audit/scryfall-census.json (+ .md)
//   oracle_cards -> docs/source-audit/scryfall-oracle-census.json (+ .md)
//   manifest     -> docs/source-audit/sources.json
// Usage: node tools/audit/census-scryfall.mjs [--only oracle|all] [--limit N]
import path from 'node:path';
import {
  AUDIT_DIR, FieldCensus, readJSONL, manifestEntry, snapshotOf, sortCounts, langSkewed, trim,
  fmt, pct, mdTable, countsTable, fieldsTable, writeText, writeJSON, log, p,
} from './audit-lib.mjs';
import { writeSourcesJSON } from './sources-json.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

// Card-object fields as documented at https://scryfall.com/docs/api/cards (transcribed by hand,
// NOT fetched live — re-verify before citing). Used only to flag schema drift candidates.
const DOCUMENTED = {
  root: [
    'arena_id', 'id', 'lang', 'mtgo_id', 'mtgo_foil_id', 'multiverse_ids', 'tcgplayer_id', 'tcgplayer_etched_id',
    'cardmarket_id', 'object', 'layout', 'oracle_id', 'prints_search_uri', 'rulings_uri', 'scryfall_uri', 'uri',
    'all_parts', 'card_faces', 'cmc', 'color_identity', 'color_indicator', 'colors', 'defense', 'edhrec_rank',
    'game_changer', 'hand_modifier', 'keywords', 'legalities', 'life_modifier', 'loyalty', 'mana_cost', 'name',
    'oracle_text', 'penny_rank', 'power', 'produced_mana', 'reserved', 'toughness', 'type_line', 'artist',
    'artist_ids', 'attraction_lights', 'booster', 'border_color', 'card_back_id', 'collector_number',
    'content_warning', 'digital', 'finishes', 'flavor_name', 'flavor_text', 'frame_effects', 'frame', 'full_art',
    'games', 'highres_image', 'illustration_id', 'image_status', 'image_uris', 'oversized', 'prices',
    'printed_name', 'printed_text', 'printed_type_line', 'promo', 'promo_types', 'purchase_uris', 'rarity',
    'related_uris', 'released_at', 'reprint', 'scryfall_set_uri', 'set_name', 'set_search_uri', 'set_type',
    'set_uri', 'set', 'set_id', 'story_spotlight', 'textless', 'variation', 'variation_of', 'security_stamp',
    'watermark', 'preview',
  ],
  face: [
    'artist', 'artist_id', 'cmc', 'color_indicator', 'colors', 'defense', 'flavor_text', 'illustration_id',
    'image_uris', 'layout', 'loyalty', 'mana_cost', 'name', 'object', 'oracle_id', 'oracle_text', 'power',
    'printed_name', 'printed_text', 'printed_type_line', 'toughness', 'type_line', 'watermark',
  ],
  related: ['id', 'object', 'component', 'name', 'type_line', 'uri'],
  maps: {
    image_uris: ['small', 'normal', 'large', 'png', 'art_crop', 'border_crop'],
    prices: ['usd', 'usd_foil', 'usd_etched', 'eur', 'eur_foil', 'tix'],
    related_uris: ['gatherer', 'tcgplayer_infinite_articles', 'tcgplayer_infinite_decks', 'edhrec'],
    purchase_uris: ['tcgplayer', 'cardmarket', 'cardhoarder'],
    preview: ['previewed_at', 'source_uri', 'source'],
    legalities: [
      'standard', 'future', 'historic', 'timeless', 'gladiator', 'pioneer', 'explorer', 'modern', 'legacy', 'pauper',
      'vintage', 'penny', 'commander', 'oathbreaker', 'standardbrawl', 'brawl', 'historicbrawl', 'alchemy',
      'paupercommander', 'duel', 'oldschool', 'premodern', 'predh',
    ],
  },
};

// Fields that should be invariant across all printings of one oracle_id.
const ORACLE_FIELDS = [
  'layout', 'name', 'mana_cost', 'cmc', 'type_line', 'oracle_text', 'colors', 'color_identity', 'color_indicator',
  'power', 'toughness', 'loyalty', 'defense', 'hand_modifier', 'life_modifier', 'keywords', 'produced_mana',
  'reserved', 'game_changer', 'legalities', 'edhrec_rank', 'penny_rank',
];

const inc = (o, k, by = 1) => (o[k] = (o[k] ?? 0) + by);
const inc2 = (o, a, b) => inc((o[a] ??= {}), b);

/** Scryfall-specific structural analyses, shared by the all_cards and oracle_cards passes. */
class ScryfallExtras {
  constructor({ deep }) {
    this.deep = deep;
    this.objects = {};
    this.nestedObjects = {};
    this.layouts = {};
    this.langs = {};
    this.cardFaces = { records: 0, byLayout: {}, faceCountByLayout: {} };
    this.allParts = { records: 0, entries: 0, byLayout: {}, components: {}, componentsByLayout: {}, partsPerRecord: {} };
    this.oracleIdPlacement = {}; // layout -> {root, faces, both, neither}
    this.facesOnlyOracle = { records: 0, distinctFaceOracleIdsPerRecord: {}, samples: [], faceOracleIds: new Set(), byLayout: {} };
    this.illustrationPlacement = {}; // layout -> {root, faces, both, neither}
    this.faceRoot = {}; // layout -> { rootKeys:{}, faceKeys:{}, both:{} } (records with card_faces)
    this.faceKeysEver = new Set();
    this.rootKeysEver = new Set();
    if (deep) {
      this.ids = new Set();
      this.dupIds = 0;
      this.oracleRoot = new Set();
      this.illusRoot = new Set();
      this.illusFace = new Set();
      this.artistIds = new Set();
      this.setIds = new Set();
      this.setCodes = new Set();
      this.names = new Set();
      this.cardBack = {};
      this.printingsPerOracle = new Map();
      this.oracleName = new Map();
      this.illusPerOracle = new Map();
      this.oraclePerIllus = new Map();
      this.oracleSig = new Map(); // oracle -> Map(field -> json)
      this.oracleDiff = {}; // field -> {oracleIds:Set, examples:[]}
      this.legalFirst = new Map(); // oracle -> first legalities object
      this.legalDiff = {}; // format -> {oracleIds:Set, example}
      this.oracleLayout = new Map();
      this.multiArtist = { root: 0, byLayout: {} };
      this.printedName = {};
      this.flavorName = { records: 0, faces: 0, byLang: {} };
    }
  }

  observe(c) {
    const layout = c.layout ?? '(none)';
    inc(this.objects, c.object ?? '(none)');
    inc(this.layouts, layout);
    inc(this.langs, c.lang ?? '(none)');
    for (const k in c) this.rootKeysEver.add(k);
    const faces = Array.isArray(c.card_faces) ? c.card_faces : null;
    for (const f of faces ?? []) inc2(this.nestedObjects, 'card_faces[].object', f.object ?? '(none)');
    for (const r of c.all_parts ?? []) inc2(this.nestedObjects, 'all_parts[].object', r.object ?? '(none)');

    // card faces
    if (faces) {
      this.cardFaces.records++;
      inc(this.cardFaces.byLayout, layout);
      inc2(this.cardFaces.faceCountByLayout, layout, faces.length);
      const fr = (this.faceRoot[layout] ??= { records: 0, rootKeys: {}, faceKeys: {}, both: {} });
      fr.records++;
      const fk = new Set();
      for (const f of faces) for (const k in f) fk.add(k);
      for (const k of fk) {
        this.faceKeysEver.add(k);
        inc(fr.faceKeys, k);
        if (k in c) inc(fr.both, k);
      }
      for (const k in c) inc(fr.rootKeys, k);
    }

    // all_parts
    if (Array.isArray(c.all_parts)) {
      const ap = this.allParts;
      ap.records++;
      inc(ap.byLayout, layout);
      inc(ap.partsPerRecord, c.all_parts.length >= 10 ? '10+' : c.all_parts.length);
      for (const r of c.all_parts) {
        ap.entries++;
        inc(ap.components, r.component ?? '(none)');
        inc2(ap.componentsByLayout, layout, r.component ?? '(none)');
      }
    }

    // oracle_id placement (root vs faces) — reversible_card case
    const faceOracle = faces ? faces.map((f) => f.oracle_id).filter(Boolean) : [];
    const op = (this.oracleIdPlacement[layout] ??= { root: 0, faces: 0, both: 0, neither: 0 });
    if (c.oracle_id && faceOracle.length) op.both++;
    else if (c.oracle_id) op.root++;
    else if (faceOracle.length) {
      op.faces++;
      const fo = this.facesOnlyOracle;
      fo.records++;
      inc(fo.byLayout, layout);
      const distinct = new Set(faceOracle);
      inc(fo.distinctFaceOracleIdsPerRecord, distinct.size);
      for (const id of distinct) fo.faceOracleIds.add(id);
      if (fo.samples.length < 5)
        fo.samples.push({ id: c.id, name: c.name, set: c.set, collector_number: c.collector_number, lang: c.lang, faceOracleIds: faces.map((f) => f.oracle_id ?? null), faceNames: faces.map((f) => f.name) });
    } else op.neither++;

    // illustration placement
    const faceIll = faces ? faces.map((f) => f.illustration_id).filter(Boolean) : [];
    const ip = (this.illustrationPlacement[layout] ??= { root: 0, faces: 0, both: 0, neither: 0 });
    if (c.illustration_id && faceIll.length) ip.both++;
    else if (c.illustration_id) ip.root++;
    else if (faceIll.length) ip.faces++;
    else ip.neither++;

    if (!this.deep) return;
    // ---- identity (all_cards only) ----
    if (this.ids.has(c.id)) this.dupIds++;
    else this.ids.add(c.id);
    if (c.oracle_id) this.oracleRoot.add(c.oracle_id);
    if (c.illustration_id) this.illusRoot.add(c.illustration_id);
    for (const i of faceIll) this.illusFace.add(i);
    for (const a of c.artist_ids ?? []) this.artistIds.add(a);
    if (c.set_id) this.setIds.add(c.set_id);
    if (c.set) this.setCodes.add(c.set);
    if (c.name) this.names.add(c.name);
    inc(this.cardBack, c.card_back_id ?? '(absent)');
    if ((c.artist_ids?.length ?? 0) >= 2) {
      this.multiArtist.root++;
      inc(this.multiArtist.byLayout, layout);
    }
    if (c.flavor_name) {
      this.flavorName.records++;
      inc(this.flavorName.byLang, c.lang);
    }
    if (faces?.some((f) => f.flavor_name)) this.flavorName.faces++;

    const oracleIds = c.oracle_id ? [c.oracle_id] : [...new Set(faceOracle)];
    const ills = new Set(c.illustration_id ? [c.illustration_id, ...faceIll] : faceIll);
    for (const o of oracleIds) {
      this.printingsPerOracle.set(o, (this.printingsPerOracle.get(o) ?? 0) + 1);
      if (!this.oracleName.has(o)) this.oracleName.set(o, c.oracle_id ? c.name : faces.find((f) => f.oracle_id === o)?.name);
      let s = this.illusPerOracle.get(o);
      if (!s) this.illusPerOracle.set(o, (s = new Set()));
      for (const i of ills) s.add(i);
      for (const i of ills) {
        let t = this.oraclePerIllus.get(i);
        if (!t) this.oraclePerIllus.set(i, (t = new Set()));
        t.add(o);
      }
    }

    for (const o of oracleIds) if (!this.oracleLayout.has(o)) this.oracleLayout.set(o, layout);
    // legality per format: which formats vary between printings of one oracle id?
    if (c.oracle_id && c.legalities) {
      const first = this.legalFirst.get(c.oracle_id);
      if (!first) this.legalFirst.set(c.oracle_id, { l: c.legalities, id: c.id, set: c.set, lang: c.lang });
      else
        for (const k in c.legalities)
          if (c.legalities[k] !== first.l[k]) {
            const d = (this.legalDiff[k] ??= { oracleIds: new Set(), examples: [] });
            if (!d.oracleIds.has(c.oracle_id)) {
              d.oracleIds.add(c.oracle_id);
              if (d.examples.length < 3) d.examples.push({ oracle_id: c.oracle_id, name: c.name, a: { id: first.id, set: first.set, lang: first.lang, value: first.l[k] }, b: { id: c.id, set: c.set, set_type: c.set_type, lang: c.lang, value: c.legalities[k] } });
            }
          }
    }
    // oracle-level invariance across printings (root oracle_id only)
    if (c.oracle_id) {
      let sig = this.oracleSig.get(c.oracle_id);
      const first = !sig;
      if (first) this.oracleSig.set(c.oracle_id, (sig = new Map()));
      for (const f of ORACLE_FIELDS) {
        const v = f in c ? JSON.stringify(c[f]) : faces && faces.some((x) => f in x) ? 'faces:' + JSON.stringify(faces.map((x) => x[f] ?? null)) : '(absent)';
        if (first) sig.set(f, { v, id: c.id, set: c.set, lang: c.lang });
        else {
          const prev = sig.get(f);
          if (prev.v !== v) {
            const d = (this.oracleDiff[f] ??= { oracleIds: new Set(), examples: [] });
            if (!d.oracleIds.has(c.oracle_id)) {
              d.oracleIds.add(c.oracle_id);
              if (d.examples.length < 3)
                d.examples.push({ oracle_id: c.oracle_id, name: c.name, a: { id: prev.id, set: prev.set, lang: prev.lang, value: trim(prev.v, 160) }, b: { id: c.id, set: c.set, lang: c.lang, value: trim(v, 160) } });
            }
          }
        }
      }
    }
  }

  result(census, oracleCardIds = null) {
    const faceOnly = [...this.faceKeysEver].filter((k) => !this.rootKeysEver.has(k)).sort();
    const faceAndRoot = [...this.faceKeysEver].filter((k) => this.rootKeysEver.has(k)).sort();
    const faceVsRoot = {};
    for (const k of [...this.faceKeysEver].sort()) {
      faceVsRoot[k] = {};
      for (const [layout, fr] of Object.entries(this.faceRoot)) {
        if (!fr.faceKeys[k] && !fr.rootKeys[k]) continue;
        faceVsRoot[k][layout] = { records: fr.records, onFaces: fr.faceKeys[k] ?? 0, atRoot: fr.rootKeys[k] ?? 0, both: fr.both[k] ?? 0 };
      }
    }
    const fo = this.facesOnlyOracle;
    const out = {
      objects: { root: sortCounts(this.objects), nested: Object.fromEntries(Object.entries(this.nestedObjects).map(([k, v]) => [k, sortCounts(v)])) },
      layouts: sortCounts(this.layouts),
      langs: sortCounts(this.langs),
      cardFaces: {
        records: this.cardFaces.records,
        byLayout: sortCounts(this.cardFaces.byLayout),
        faceCountByLayout: this.cardFaces.faceCountByLayout,
      },
      allParts: {
        records: this.allParts.records,
        entries: this.allParts.entries,
        byLayout: sortCounts(this.allParts.byLayout),
        components: sortCounts(this.allParts.components),
        componentsByLayout: Object.fromEntries(Object.entries(this.allParts.componentsByLayout).map(([k, v]) => [k, sortCounts(v)])),
        partsPerRecord: this.allParts.partsPerRecord,
      },
      oracleIdPlacement: {
        note: 'root = oracle_id only at root; faces = only inside card_faces[] (no root oracle_id); both; neither',
        byLayout: this.oracleIdPlacement,
        facesOnly: {
          records: fo.records,
          byLayout: sortCounts(fo.byLayout),
          distinctFaceOracleIdsPerRecord: fo.distinctFaceOracleIdsPerRecord,
          distinctFaceOracleIds: fo.faceOracleIds.size,
          ...(oracleCardIds
            ? {
                faceOracleIdsFoundAsOracleCardsRoot: [...fo.faceOracleIds].filter((id) => oracleCardIds.has(id)).length,
                faceOracleIdsNotInOracleCards: [...fo.faceOracleIds].filter((id) => !oracleCardIds.has(id)).slice(0, 20),
              }
            : {}),
          samples: fo.samples,
        },
      },
      illustrationIdPlacement: { byLayout: this.illustrationPlacement },
      faceFields: { onlyInCardFaces: faceOnly, inBothFacesAndRoot: faceAndRoot, faceVsRootByLayout: faceVsRoot },
    };
    return out;
  }

  identity(oracleCardIds) {
    const hist = (values, buckets) => {
      const h = Object.fromEntries(buckets.map((b) => [b, 0]));
      for (const v of values) {
        const b = buckets.find((x, i) => (i === buckets.length - 1 ? true : v <= Number(x)));
        h[b]++;
      }
      return h;
    };
    const pp = [...this.printingsPerOracle.values()];
    const ipo = [...this.illusPerOracle.values()].map((s) => s.size);
    const shared = [...this.oraclePerIllus.entries()].filter(([, s]) => s.size > 1);
    const combos = {};
    for (const [i, s] of shared) {
      const key = [...s].map((o) => this.oracleLayout.get(o)).sort().join(' + ');
      const e = (combos[key] ??= { illustrations: 0, samples: [] });
      e.illustrations++;
      if (e.samples.length < 2) e.samples.push({ illustration_id: i, oracle: [...s].slice(0, 4).map((o) => ({ oracle_id: o, name: this.oracleName.get(o), layout: this.oracleLayout.get(o) })) });
    }
    const topOracle = [...this.printingsPerOracle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([o, n]) => ({ oracle_id: o, name: this.oracleName.get(o), printings: n }));
    const allOracle = new Set([...this.printingsPerOracle.keys()]);
    return {
      printingIds: { distinct: this.ids.size, duplicates: this.dupIds },
      oracleIds: {
        distinctAtRoot: this.oracleRoot.size,
        distinctRootOrFaces: allOracle.size,
        ...(oracleCardIds
          ? {
              notInOracleCards: [...allOracle].filter((o) => !oracleCardIds.has(o)).length,
              notInOracleCardsSamples: [...allOracle].filter((o) => !oracleCardIds.has(o)).slice(0, 10).map((o) => ({ oracle_id: o, name: this.oracleName.get(o) })),
              oracleCardsNotInAllCards: [...oracleCardIds].filter((o) => !allOracle.has(o)).length,
            }
          : {}),
        printingsPerOracleHistogram: hist(pp, ['1', '2', '3', '5', '10', '20', '50', '100', '101+']),
        topByPrintings: topOracle,
      },
      illustrationIds: {
        distinctAtRoot: this.illusRoot.size,
        distinctOnFaces: this.illusFace.size,
        distinctUnion: new Set([...this.illusRoot, ...this.illusFace]).size,
        distinctPerOracleHistogram: hist(ipo, ['0', '1', '2', '3', '5', '10', '11+']),
        sharedAcrossOracleIds: shared.length,
        sharedByLayoutCombination: Object.fromEntries(Object.entries(combos).sort((a, b) => b[1].illustrations - a[1].illustrations)),
      },
      artistIds: { distinct: this.artistIds.size, printingsWith2PlusArtistIds: this.multiArtist.root, byLayout: sortCounts(this.multiArtist.byLayout) },
      sets: { distinctSetIds: this.setIds.size, distinctSetCodes: this.setCodes.size },
      names: { distinct: this.names.size },
      cardBackIds: { distinct: Object.keys(this.cardBack).length, top: Object.entries(sortCounts(this.cardBack)).slice(0, 10) },
      flavorName: { recordsWithRootFlavorName: this.flavorName.records, recordsWithFaceFlavorName: this.flavorName.faces, byLang: sortCounts(this.flavorName.byLang) },
    };
  }

  oracleInvariance() {
    const out = Object.fromEntries(
      ORACLE_FIELDS.map((f) => [f, { oracleIdsWithVaryingValue: this.oracleDiff[f]?.oracleIds.size ?? 0, examples: this.oracleDiff[f]?.examples ?? [] }]),
    );
    out.legalities.byFormat = Object.fromEntries(Object.entries(this.legalDiff).map(([k, d]) => [k, { oracleIdsWithVaryingValue: d.oracleIds.size, examples: d.examples }]));
    return out;
  }
}

function drift(census) {
  const paths = new Set(census.nodes().map((n) => n.path));
  const rootKeys = new Set([...paths].filter((x) => !x.includes('.') && !x.includes('[')));
  const faceKeys = new Set([...paths].filter((x) => /^card_faces\[\]\.[^.[]+$/.test(x)).map((x) => x.split('.')[1]));
  const relKeys = new Set([...paths].filter((x) => /^all_parts\[\]\.[^.[]+$/.test(x)).map((x) => x.split('.')[1]));
  const out = {
    basis: 'Field lists transcribed by hand in tools/audit/census-scryfall.mjs from https://scryfall.com/docs/api/cards (not fetched live). Treat as drift candidates to verify, not as facts about the docs.',
    root: { undocumented: [...rootKeys].filter((k) => !DOCUMENTED.root.includes(k)).sort(), documentedButAbsent: DOCUMENTED.root.filter((k) => !rootKeys.has(k)) },
    cardFaces: { undocumented: [...faceKeys].filter((k) => !DOCUMENTED.face.includes(k)).sort(), documentedButAbsent: DOCUMENTED.face.filter((k) => !faceKeys.has(k)) },
    allParts: { undocumented: [...relKeys].filter((k) => !DOCUMENTED.related.includes(k)).sort(), documentedButAbsent: DOCUMENTED.related.filter((k) => !relKeys.has(k)) },
    maps: {},
  };
  for (const [m, keys] of Object.entries(DOCUMENTED.maps)) {
    const seen = new Set();
    for (const x of paths) {
      for (const prefix of [`${m}.`, `card_faces[].${m}.`]) {
        if (x.startsWith(prefix)) {
          const rest = x.slice(prefix.length);
          if (!rest.includes('.') && !rest.includes('[')) seen.add(rest);
        }
      }
    }
    out.maps[m] = { observed: [...seen].sort(), undocumented: [...seen].filter((k) => !keys.includes(k)).sort(), documentedButAbsent: keys.filter((k) => !seen.has(k)) };
  }
  return out;
}

async function runCensus(key, { deep, onRecord = null }) {
  const entry = manifestEntry(key);
  const file = p(entry.localPath);
  log(`census ${key}: ${path.basename(file)}`);
  const census = new FieldCensus({ groupName: 'byLayout', trackLang: deep });
  const extras = new ScryfallExtras({ deep });
  const state = {};
  const t0 = Date.now();
  let n = 0;
  for await (const c of readJSONL(file, { state })) {
    census.observe(c, c.layout ?? '(none)', c.lang ?? null);
    extras.observe(c);
    if (onRecord) onRecord(c);
    if (++n % 100000 === 0) log(`  ${fmt(n)} records…`);
    if (n >= limit) break;
  }
  const complete = n < limit;
  log(`  ${fmt(n)} records in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const snapshot = snapshotOf(key, complete ? { sha256Verified: state.sha256 === entry.sha256 } : { partial: true });
  if (complete && state.sha256 !== entry.sha256) log(`  WARNING sha256 mismatch: ${state.sha256} vs manifest ${entry.sha256}`);
  return { census, extras, snapshot, file };
}

function md(title, intro, res, census, { deep }) {
  const R = res.records;
  const L = [];
  L.push(`# ${title}`, '', intro, '');
  L.push(`Snapshot: \`${res.snapshot.file}\` · sha256 \`${res.snapshot.sha256.slice(0, 16)}…\`${res.snapshot.sha256Verified ? ' (verified)' : ''} · source updated ${res.snapshot.sourceUpdatedAt} · retrieved ${res.snapshot.retrievedAt}`, '');
  L.push(`Generated by \`tools/audit/census-scryfall.mjs\` at ${res.generatedAt}. Machine-readable: \`${res.jsonFile}\`.`, '');
  L.push('## Overview', '', mdTable(['measure', 'value'], [
    ['records', fmt(R)],
    ['distinct JSON paths', fmt(res.fields.length)],
    ['records with `card_faces`', `${fmt(res.cardFaces.records)} (${pct(res.cardFaces.records, R)})`],
    ['records with `all_parts`', `${fmt(res.allParts.records)} (${pct(res.allParts.records, R)})`],
    ['records with oracle_id only on faces', fmt(res.oracleIdPlacement.facesOnly.records)],
  ]), '');
  L.push('## Objects', '', countsTable(res.objects.root, R, '`object`'), '');
  for (const [k, v] of Object.entries(res.objects.nested)) L.push(`\`${k}\`: ${Object.entries(v).map(([a, b]) => `\`${a}\` ×${fmt(b)}`).join(', ')}`, '');
  L.push('## Layouts', '', countsTable(res.layouts, R, '`layout`'), '');
  if (deep) L.push('## Languages', '', countsTable(res.langs, R, '`lang`'), '');
  L.push('## Multi-face records (`card_faces`)', '', mdTable(['layout', 'records with card_faces', 'faces per record'],
    Object.entries(res.cardFaces.byLayout).map(([l, c]) => [`\`${l}\``, fmt(c), Object.entries(res.cardFaces.faceCountByLayout[l]).map(([n, m]) => `${n}:${fmt(m)}`).join(' ')])), '');
  L.push('### oracle_id placement by layout', '', res.oracleIdPlacement.note, '', mdTable(['layout', 'root', 'faces only', 'both', 'neither'],
    Object.entries(res.oracleIdPlacement.byLayout).sort((a, b) => b[1].root + b[1].faces - a[1].root - a[1].faces).map(([l, v]) => [`\`${l}\``, fmt(v.root), fmt(v.faces), fmt(v.both), fmt(v.neither)])), '');
  const fo = res.oracleIdPlacement.facesOnly;
  L.push(`Records with \`oracle_id\` only inside \`card_faces\`: **${fmt(fo.records)}** (${Object.entries(fo.byLayout).map(([a, b]) => `\`${a}\` ${fmt(b)}`).join(', ')}); distinct face oracle ids per record: ${Object.entries(fo.distinctFaceOracleIdsPerRecord).map(([a, b]) => `${a}→${fmt(b)}`).join(', ')}; distinct face oracle ids overall: ${fmt(fo.distinctFaceOracleIds)}${fo.faceOracleIdsFoundAsOracleCardsRoot != null ? `, of which ${fmt(fo.faceOracleIdsFoundAsOracleCardsRoot)} exist as a root \`oracle_id\` in oracle_cards` : ''}.`, '');
  if (fo.samples.length) L.push(mdTable(['id', 'name', 'set', 'lang', 'face oracle ids'], fo.samples.map((s) => [`\`${s.id}\``, s.name, s.set, s.lang, s.faceOracleIds.map((x) => (x ? `\`${x.slice(0, 8)}…\`` : 'null')).join(' / ')])), '');
  L.push('### illustration_id placement by layout', '', mdTable(['layout', 'root', 'faces only', 'both', 'neither'],
    Object.entries(res.illustrationIdPlacement.byLayout).sort((a, b) => b[1].root + b[1].faces - a[1].root - a[1].faces).map(([l, v]) => [`\`${l}\``, fmt(v.root), fmt(v.faces), fmt(v.both), fmt(v.neither)])), '');
  L.push('### Fields that occur only inside `card_faces[]`', '', res.faceFields.onlyInCardFaces.map((k) => `\`${k}\``).join(', ') || '(none)', '');
  L.push('Fields that occur both in faces and at root (in some records): ' + res.faceFields.inBothFacesAndRoot.map((k) => `\`${k}\``).join(', '), '');
  L.push('### Where does a face-level key live? (records with `card_faces`, per layout: on faces / at root / both)', '');
  const layoutsWithFaces = Object.keys(res.cardFaces.byLayout);
  L.push(mdTable(['key', ...layoutsWithFaces.map((l) => `\`${l}\``)], Object.entries(res.faceFields.faceVsRootByLayout).map(([k, v]) => [`\`${k}\``, ...layoutsWithFaces.map((l) => (v[l] ? `${fmt(v[l].onFaces)}/${fmt(v[l].atRoot)}/${fmt(v[l].both)}` : ''))])), '');
  L.push('## Related objects (`all_parts`)', '', countsTable(res.allParts.components, res.allParts.entries, '`component`'), '');
  L.push(`${fmt(res.allParts.entries)} related_card entries in ${fmt(res.allParts.records)} records. Records with all_parts by layout: ${Object.entries(res.allParts.byLayout).map(([a, b]) => `\`${a}\` ${fmt(b)}`).join(', ')}.`, '');
  if (res.identity) {
    const id = res.identity;
    L.push('## Identity', '', mdTable(['measure', 'value'], [
      ['distinct printing `id`', `${fmt(id.printingIds.distinct)} (duplicates: ${fmt(id.printingIds.duplicates)})`],
      ['distinct root `oracle_id`', fmt(id.oracleIds.distinctAtRoot)],
      ['distinct `oracle_id` (root or faces)', fmt(id.oracleIds.distinctRootOrFaces)],
      ['oracle ids not in oracle_cards', fmt(id.oracleIds.notInOracleCards ?? '–')],
      ['oracle_cards oracle ids not in all_cards', fmt(id.oracleIds.oracleCardsNotInAllCards ?? '–')],
      ['distinct `illustration_id` (root / faces / union)', `${fmt(id.illustrationIds.distinctAtRoot)} / ${fmt(id.illustrationIds.distinctOnFaces)} / ${fmt(id.illustrationIds.distinctUnion)}`],
      ['illustration ids used by >1 oracle id', fmt(id.illustrationIds.sharedAcrossOracleIds)],
      ['distinct `artist_ids` values', fmt(id.artistIds.distinct)],
      ['printings with ≥2 `artist_ids`', `${fmt(id.artistIds.printingsWith2PlusArtistIds)} (${Object.entries(id.artistIds.byLayout).slice(0, 6).map(([a, b]) => `${a} ${fmt(b)}`).join(', ')})`],
      ['distinct set ids / set codes', `${fmt(id.sets.distinctSetIds)} / ${fmt(id.sets.distinctSetCodes)}`],
      ['distinct `name`', fmt(id.names.distinct)],
      ['distinct `card_back_id`', fmt(id.cardBackIds.distinct)],
      ['records with root / face `flavor_name`', `${fmt(id.flavorName.recordsWithRootFlavorName)} / ${fmt(id.flavorName.recordsWithFaceFlavorName)}`],
    ]), '');
    L.push('Printings per oracle id: ' + Object.entries(id.oracleIds.printingsPerOracleHistogram).map(([a, b]) => `≤${a}: ${fmt(b)}`).join(' · '), '');
    L.push('Distinct illustrations per oracle id: ' + Object.entries(id.illustrationIds.distinctPerOracleHistogram).map(([a, b]) => `≤${a}: ${fmt(b)}`).join(' · '), '');
    L.push('### Illustrations shared by several oracle ids, by layout combination', '', mdTable(['layouts of the oracle ids', 'illustrations', 'example'],
      Object.entries(id.illustrationIds.sharedByLayoutCombination).slice(0, 15).map(([k, v]) => [k, fmt(v.illustrations), v.samples[0].oracle.map((o) => o.name).join(' | ')])), '');
    L.push('### Oracle-level fields that vary across printings of the same `oracle_id`', '', mdTable(['field', 'oracle ids with >1 value', 'example'],
      Object.entries(res.oracleInvariance).map(([f, v]) => [`\`${f}\``, fmt(v.oracleIdsWithVaryingValue), v.examples[0] ? `${v.examples[0].name}: ${v.examples[0].a.set}/${v.examples[0].a.lang} ${trim(v.examples[0].a.value, 50)} vs ${v.examples[0].b.set}/${v.examples[0].b.lang} ${trim(v.examples[0].b.value, 50)}` : ''])), '');
    const lb = res.oracleInvariance.legalities.byFormat;
    if (Object.keys(lb).length)
      L.push('Legality formats whose value varies between printings of one oracle id: ' + Object.entries(lb).map(([k, v]) => `\`${k}\` (${fmt(v.oracleIdsWithVaryingValue)} oracle ids; e.g. ${v.examples[0].name}: ${v.examples[0].a.set}=${v.examples[0].a.value} vs ${v.examples[0].b.set}=${v.examples[0].b.value})`).join('; '), '');
  }
  if (res.drift) {
    const d = res.drift;
    L.push('## Drift candidates vs documented Card object', '', d.basis, '');
    L.push(mdTable(['scope', 'observed but not in transcribed docs', 'in transcribed docs but never observed'], [
      ['root', d.root.undocumented.join(', '), d.root.documentedButAbsent.join(', ')],
      ['card_faces[]', d.cardFaces.undocumented.join(', '), d.cardFaces.documentedButAbsent.join(', ')],
      ['all_parts[]', d.allParts.undocumented.join(', '), d.allParts.documentedButAbsent.join(', ')],
      ...Object.entries(d.maps).map(([m, v]) => [`${m}.*`, v.undocumented.join(', '), v.documentedButAbsent.join(', ')]),
    ]), '');
  }
  L.push('## Field census', '', '`present` = records containing the path at least once (percentage of all records); `distinct` with `+` = tracking capped at 5,000 values; kind is a heuristic (uuid/url/date/datetime/hash/text/enum/string/integer/number/boolean/mixed).', '');
  L.push(fieldsTable(res.fields, R), '');
  return L.join('\n');
}

// ---------------------------------------------------------------------------------------

const generatedAt = new Date().toISOString();
writeSourcesJSON();
log('wrote docs/source-audit/sources.json');

let oracleCardIds = null;
if (only !== 'all') {
  oracleCardIds = new Set();
  const o = await runCensus('scryfall:oracle_cards', { deep: false, onRecord: (c) => c.oracle_id && oracleCardIds.add(c.oracle_id) });
  const res = {
    source: 'scryfall:oracle_cards',
    description: 'One Scryfall card object per Oracle id (Scryfall chooses a representative printing). Smaller census; see scryfall-census.json for all printings.',
    generatedAt,
    snapshot: o.snapshot,
    records: o.census.records,
    distinctRootOracleIds: oracleCardIds.size,
    ...o.extras.result(o.census),
    drift: drift(o.census),
    fields: o.census.result(),
  };
  res.jsonFile = 'docs/source-audit/scryfall-oracle-census.json';
  writeJSON(p(res.jsonFile), res);
  writeText(p('docs/source-audit/scryfall-oracle-census.md'), md('Scryfall census — oracle_cards', res.description, res, o.census, { deep: false }));
  log(`wrote ${res.jsonFile}`);
}

if (only !== 'oracle') {
  const a = await runCensus('scryfall:all_cards', { deep: true });
  const res = {
    source: 'scryfall:all_cards',
    description: 'Every Scryfall card object (printing) in every language — the canonical census source.',
    generatedAt,
    snapshot: a.snapshot,
    records: a.census.records,
    ...a.extras.result(a.census, oracleCardIds),
    identity: a.extras.identity(oracleCardIds),
    oracleInvariance: a.extras.oracleInvariance(),
    drift: drift(a.census),
    fields: a.census.result({ langFilter: langSkewed }),
  };
  res.jsonFile = 'docs/source-audit/scryfall-census.json';
  writeJSON(p(res.jsonFile), res);
  writeText(p('docs/source-audit/scryfall-census.md'), md('Scryfall census — all_cards', res.description, res, a.census, { deep: true }));
  log(`wrote ${res.jsonFile}`);
}
