#!/usr/bin/env node
// PROTOTYPE mapper — fixtures only. Converts the small, real source excerpts in
// fixtures/ into example RDF (examples/*.ttl) following the draft ontology, so
// that SHACL, competency questions and the docs can be exercised on real data.
// This is NOT the production ETL (PLAN §0: no mass ETL before ontology approval):
// it refuses to process more than MAX_RECORDS records per fixture file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import readline from 'node:readline';
import N3 from 'n3';
import { p, rawManifest, rawFile, ensureDir, log, CONFIG } from '../lib/common.mjs';
import { PREFIXES, V, ID, slug } from '../lib/rdf.mjs';
import { loadTypeSystem, resolveTypeLine } from '../lib/typeline.mjs';
import * as CUR from '../vocab/curated.mjs';
import { readJSON } from '../lib/common.mjs';

const MAX_RECORDS = 500;
const { namedNode: nn, literal: lit, quad } = N3.DataFactory;
const S = PREFIXES.smtg, RDF = PREFIXES.rdf, RDFS = PREFIXES.rdfs, SKOS = PREFIXES.skos, XSD = PREFIXES.xsd, PROV = PREFIXES.prov;
const a = nn(RDF + 'type');
const sm = (l) => nn(S + l);
const vc = (scheme, code) => nn(`${V}${scheme}/${code}`);
const id = (...parts) => nn(ID + parts.join('/'));
const typed = (v, t) => lit(String(v), nn(XSD + t));
const bool = (v) => typed(!!v, 'boolean');
const AGENT = (k) => nn(`${ID}agent/${k}`);
const DATASET = (k) => nn(`${ID}dataset/${k}`);
const EPI = (k) => nn(`${V}epistemic-status/${k}`);
const ATT = (k) => nn(`${V}attitude/${k}`);
const LIFE = (k) => nn(`${V}claim-lifecycle/${k}`);
const ts = loadTypeSystem();
// Only real mana symbols may be values of producesManaSymbol (Scryfall's produced_mana once contains "T").
const MANA_SYMBOLS = new Set(readJSON(rawFile('scryfall:symbology')).data.filter((x) => x.represents_mana).map((x) => x.symbol));
const quirks = { producedManaSkipped: [] };
// Set metadata from the Scryfall /sets catalog (by id and by code).
const SETS = readJSON(rawFile('scryfall:sets')).data;
const setById = new Map(SETS.map((x) => [x.id, x]));
const setByCode = new Map(SETS.map((x) => [x.code, x]));

// ---------------------------------------------------------------------------
// Snapshot nodes (one per raw source file)
const manifest = rawManifest();
const DATASET_OF = { 'scryfall:all_cards': 'scryfall-all-cards', 'scryfall:oracle_cards': 'scryfall-oracle-cards', 'scryfall:oracle_tags': 'scryfall-oracle-tags', 'scryfall:art_tags': 'scryfall-art-tags', 'scryfall:rulings': 'scryfall-rulings', 'spellbook:variants': 'spellbook-variants' };
const snapIri = (key) => {
  const f = manifest.files.filter((x) => x.key === key).at(-1);
  return f ? id('snapshot', `${key.replace(':', '-').replace('_', '-')}-${f.sha256.slice(0, 12)}`) : null;
};
function snapshotQuads() {
  const q = [];
  for (const [key, ds] of Object.entries(DATASET_OF)) {
    const f = manifest.files.filter((x) => x.key === key).at(-1);
    if (!f) continue;
    const s = snapIri(key);
    q.push(quad(s, a, sm('SourceSnapshot')), quad(s, sm('snapshotOf'), DATASET(ds)),
      quad(s, nn(RDFS + 'label'), lit(`${key} snapshot ${f.sourceUpdatedAt ?? f.lastModified ?? f.retrievedAt}`)),
      quad(s, sm('sha256'), lit(f.sha256)), quad(s, sm('retrievedAt'), typed(f.retrievedAt, 'dateTime')),
      quad(s, sm('downloadURL'), typed(f.url, 'anyURI')));
    if (f.sourceUpdatedAt) q.push(quad(s, sm('sourceUpdatedAt'), typed(new Date(f.sourceUpdatedAt).toISOString(), 'dateTime')));
  }
  return q;
}

// ---------------------------------------------------------------------------
const comboCode = (colors) => {
  if (!colors) return null;
  const arr = Array.isArray(colors) ? colors : String(colors).split('');
  const order = ['W', 'U', 'B', 'R', 'G'];
  const cs = order.filter((c) => arr.includes(c));
  return cs.length ? cs.join('') : 'C';
};
const numeric = (s) => (/^-?\d+(\.\d+)?$/.test(String(s)) ? String(s) : null);
const symSlug = (sym) => sym.replace(/[{}]/g, '').replace('½', 'half').replace('∞', 'infinity').replace(/\//g, '-');
const DOUBLE_SIDED = new Set(['transform', 'modal_dfc', 'double_faced_token', 'reversible_card', 'art_series']);

class Graph {
  constructor() { this.q = []; this.seen = new Set(); }
  add(s, p, o) { if (o === undefined || o === null) return; const k = `${s.value}|${p.value}|${o.value}|${o.datatype?.value ?? ''}|${o.language ?? ''}`; if (!this.seen.has(k)) { this.seen.add(k); this.q.push(quad(s, p, o)); } }
  type(s, c) { this.add(s, a, sm(c)); }
  label(s, l) { if (l) this.add(s, nn(RDFS + 'label'), lit(l)); }
}

function identifier(g, subject, scheme, value) {
  if (value === undefined || value === null || value === '') return;
  const node = id('identifier', scheme, slug(String(value)));
  g.type(node, 'Identifier');
  g.add(node, sm('identifierValue'), lit(String(value)));
  g.add(node, sm('identifierScheme'), vc('identifier-scheme', scheme));
  g.add(subject, sm('hasIdentifier'), node);
}

function manaCost(g, face, costStr) {
  if (costStr === undefined || costStr === null) return; // unknown → say nothing (open world)
  if (costStr === '') { g.add(face, sm('hasNoManaCost'), bool(true)); return; }
  const mc = nn(face.value + '/mana-cost');
  g.type(mc, 'ManaCost');
  g.add(face, sm('hasManaCost'), mc);
  g.add(mc, sm('manaCostNotation'), lit(costStr));
  const counts = {};
  for (const m of costStr.matchAll(/\{[^}]+\}/g)) counts[m[0]] = (counts[m[0]] ?? 0) + 1;
  for (const [sym, n] of Object.entries(counts)) {
    const occ = nn(`${mc.value}/${symSlug(sym)}`);
    g.type(occ, 'ManaSymbolOccurrence');
    g.add(mc, sm('hasSymbolOccurrence'), occ);
    g.add(occ, sm('occurrenceOf'), vc('mana-symbol', symSlug(sym)));
    g.add(occ, sm('occurrenceCount'), typed(n, 'positiveInteger'));
  }
}

function typeLine(g, face, tl) {
  if (!tl) return;
  g.add(face, sm('typeLine'), lit(tl));
  const r = resolveTypeLine(tl, ts, V);
  for (const u of r.supertypes) g.add(face, sm('hasSupertype'), nn(u));
  for (const u of r.cardTypes) g.add(face, sm('hasCardType'), nn(u));
  for (const u of r.subtypes) g.add(face, sm('hasSubtype'), nn(u));
}

function characteristics(g, face, src) {
  for (const [k, t] of [['power', 'power'], ['toughness', 'toughness'], ['loyalty', 'loyalty'], ['defense', 'defense']]) {
    if (src[k] === undefined || src[k] === null) continue;
    g.add(face, sm(`${t}Text`), lit(String(src[k])));
    if (numeric(src[k]) !== null) g.add(face, sm(`${t}Value`), typed(src[k], 'decimal'));
  }
  if (src.hand_modifier) g.add(face, sm('handModifierText'), lit(src.hand_modifier));
  if (src.life_modifier) g.add(face, sm('lifeModifierText'), lit(src.life_modifier));
}

function textExpr(g, owner, prop, cls, key, value, lang, snapKey) {
  if (value === undefined || value === null || value === '') return;
  const node = nn(`${owner.value}/${key}${snapKey ? '/' + snapKey : ''}`);
  g.type(node, cls);
  g.add(owner, sm(prop), node);
  g.add(node, sm('textValue'), lang ? lit(value, lang) : lit(value));
  g.add(node, sm('textLanguage'), vc('language', lang === 'en' || !lang ? 'en' : lang));
  return node;
}

// ---------------------------------------------------------------------------
// Scryfall card object → Oracle card(s) + printing
const oracleDone = new Set();
const printingToOracle = new Map();
const legalityDone = new Set();

function mapOracle(g, c, faceSources, oid, layoutCode, snapKey, snap) {
  const oc = id('oracle-card', oid);
  if (oracleDone.has(oid)) return oc;
  oracleDone.add(oid);
  g.type(oc, 'OracleCard');
  g.label(oc, faceSources.length > 1 ? c.name : faceSources[0].name);
  g.add(oc, sm('name'), lit(faceSources.length > 1 ? c.name : faceSources[0].name));
  identifier(g, oc, 'scryfall-oracle-id', oid);
  g.add(oc, sm('hasLayout'), vc('layout', layoutCode));
  if (c.color_identity && faceSources.length === (c.card_faces?.length ?? 1)) g.add(oc, sm('hasColorIdentity'), vc('color-combination', comboCode(c.color_identity)));
  if (c.cmc !== undefined && layoutCode === c.layout) g.add(oc, sm('manaValue'), typed(c.cmc, 'decimal'));
  if (c.reserved !== undefined) g.add(oc, sm('onReservedList'), bool(c.reserved));
  if (c.game_changer !== undefined) g.add(oc, sm('isGameChanger'), bool(c.game_changer));
  for (const k of c.keywords ?? []) g.add(oc, sm('hasKeyword'), nn(keywordIri(k)));
  for (const m of c.produced_mana ?? []) {
    if (MANA_SYMBOLS.has(`{${m}}`)) g.add(oc, sm('producesManaSymbol'), vc('mana-symbol', symSlug(`{${m}}`)));
    else quirks.producedManaSkipped.push(`${c.name}: produced_mana "${m}" is not a mana symbol`);
  }
  const kind = { token: 'token', double_faced_token: 'token', emblem: 'emblem', planar: 'plane', scheme: 'scheme', vanguard: 'vanguard', art_series: 'art-card', front_card: 'front-card' }[layoutCode] ?? 'traditional-card';
  g.add(oc, sm('hasObjectKind'), vc('object-kind', kind));
  faceSources.forEach((f, i) => {
    const face = id('oracle-card', oid, 'face', i);
    g.type(face, 'CardFace');
    g.add(oc, sm('hasFace'), face);
    g.add(face, sm('faceOf'), oc);
    g.label(face, f.name);
    g.add(face, sm('faceIndex'), typed(i, 'nonNegativeInteger'));
    // primary face: per layout policy (curated, with CR reference); single-faced cards: face 0
    const policy = CUR.PRIMARY_FACE[layoutCode];
    const primaryIdx = faceSources.length === 1 ? 0 : policy ? policy[0] : 0;
    if (primaryIdx === i) g.add(oc, sm('primaryFace'), face);
    // keywords per face: all of them on single-faced cards; by name in the face text otherwise
    for (const k of c.keywords ?? []) {
      const inText = new RegExp(`(^|[^a-z])${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test((f.oracle_text ?? '').toLowerCase());
      if (faceSources.length === 1 || inText) g.add(face, sm('faceKeyword'), nn(keywordIri(k)));
    }
    g.add(face, sm('name'), lit(f.name));
    manaCost(g, face, f.mana_cost);
    typeLine(g, face, f.type_line);
    const colors = f.colors ?? (faceSources.length === 1 ? c.colors : undefined);
    if (colors) g.add(face, sm('hasColors'), vc('color-combination', comboCode(colors)));
    if (f.color_indicator) g.add(face, sm('hasColorIndicator'), vc('color-combination', comboCode(f.color_indicator)));
    characteristics(g, face, f);
    textExpr(g, face, 'hasOracleText', 'OracleText', 'oracle-text', f.oracle_text, 'en', snapKey);
  });
  // legalities as time-scoped observations (claims), once per Oracle card per snapshot
  if (c.legalities && !legalityDone.has(oid)) {
    legalityDone.add(oid);
    for (const [fmt, status] of Object.entries(c.legalities)) {
      const la = id('claim', 'legality', oid, fmt, snapKey);
      g.type(la, 'LegalityAssertion');
      g.add(la, sm('legalityOf'), oc);
      g.add(la, sm('inFormat'), vc('format', fmt));
      g.add(la, sm('hasLegalityStatus'), vc('legality-status', status));
      claimMeta(g, la, 'scryfall', snap, 'authoritative-report', 'knowledge-claim');
    }
  }
  if (c.edhrec_rank) {
    const ro = id('claim', 'rank', oid, 'edhrec', snapKey);
    g.type(ro, 'RankObservation');
    g.add(ro, sm('rankOf'), oc);
    g.add(ro, sm('rankingSystem'), vc('ranking-system', 'edhrec'));
    g.add(ro, sm('rankValue'), typed(c.edhrec_rank, 'positiveInteger'));
    claimMeta(g, ro, 'scryfall', snap, 'statistical-observation', 'belief');
  }
  return oc;
}

function claimMeta(g, claim, agent, snap, epi, att) {
  g.add(claim, sm('claimedBy'), AGENT(agent));
  if (snap) g.add(claim, sm('observedIn'), snap);
  g.add(claim, sm('hasEpistemicStatus'), EPI(epi));
  if (att) g.add(claim, sm('hasAttitude'), ATT(att));
  g.add(claim, sm('hasLifecycleStatus'), LIFE('current'));
}

const kwIndex = new Map();
for (const [scheme, cat] of [['keyword-ability', 'keyword-abilities'], ['keyword-action', 'keyword-actions'], ['ability-word', 'ability-words'], ['flavor-word', 'flavor-words']])
  for (const k of ts.catalog(cat)) if (!kwIndex.has(k)) kwIndex.set(k, `${V}${scheme}/${slug(k)}`);
const keywordIri = (k) => kwIndex.get(k) ?? `${V}keyword-other/${slug(k)}`;

function mapCardObject(g, c, sourceKey) {
  const snap = snapIri(sourceKey);
  const snapKey = snap ? snap.value.split('-').at(-1) : 'nosnap';
  const faces = c.card_faces?.length ? c.card_faces : [c];
  // Oracle identities: root oracle_id, or per face (reversible_card)
  const oracleOfFace = [];
  if (c.oracle_id) {
    const oc = mapOracle(g, c, faces, c.oracle_id, c.layout, snapKey, snap);
    faces.forEach((_, i) => oracleOfFace.push([c.oracle_id, i]));
  } else {
    faces.forEach((f) => {
      if (!f.oracle_id) return;
      mapOracle(g, { ...c, ...f, card_faces: undefined, name: f.name, keywords: [], legalities: undefined }, [f], f.oracle_id, f.layout ?? 'normal', snapKey, snap);
      oracleOfFace.push([f.oracle_id, 0]);
    });
  }
  if (sourceKey !== 'scryfall:all_cards' && sourceKey !== 'scryfall:oracle_cards') return;
  // Printing
  const pr = id('printing', c.id);
  printingToOracle.set(c.id, [...new Set(oracleOfFace.map(([o]) => o))]);
  g.type(pr, 'CardPrinting');
  g.label(pr, `${c.name} (${c.set?.toUpperCase()} #${c.collector_number}, ${c.lang})`);
  for (const o of new Set(oracleOfFace.map(([o]) => o))) g.add(pr, sm('isPrintingOf'), id('oracle-card', o));
  identifier(g, pr, 'scryfall-card-id', c.id);
  for (const m of c.multiverse_ids ?? []) identifier(g, pr, 'multiverse-id', m);
  identifier(g, pr, 'mtgo-id', c.mtgo_id); identifier(g, pr, 'mtgo-foil-id', c.mtgo_foil_id);
  identifier(g, pr, 'arena-id', c.arena_id); identifier(g, pr, 'tcgplayer-id', c.tcgplayer_id);
  identifier(g, pr, 'tcgplayer-etched-id', c.tcgplayer_etched_id); identifier(g, pr, 'cardmarket-id', c.cardmarket_id);
  if (c.scryfall_uri) g.add(pr, sm('sourceURL'), typed(c.scryfall_uri, 'anyURI'));
  // Set
  const set = id('set', c.set_id);
  g.type(set, 'MtgSet'); g.label(set, c.set_name);
  g.add(set, sm('setCode'), lit(c.set));
  g.add(set, sm('hasSetType'), vc('set-type', c.set_type));
  identifier(g, set, 'scryfall-set-id', c.set_id); identifier(g, set, 'set-code', c.set);
  mapSetMetadata(g, set, setById.get(c.set_id));
  g.add(pr, sm('inSet'), set);
  identifier(g, pr, 'scryfall-card-back-id', c.card_back_id);
  g.add(pr, sm('collectorNumber'), lit(c.collector_number));
  g.add(pr, sm('inLanguage'), vc('language', c.lang));
  if (c.released_at) g.add(pr, sm('releasedOn'), typed(c.released_at, 'date'));
  g.add(pr, sm('hasRarity'), vc('rarity', c.rarity));
  g.add(pr, sm('hasBorderColor'), vc('border-color', c.border_color));
  g.add(pr, sm('hasFrameVersion'), vc('frame', slug(c.frame) === c.frame ? c.frame : slug(c.frame)));
  for (const e of c.frame_effects ?? []) g.add(pr, sm('hasFrameEffect'), vc('frame-effect', e));
  for (const f of c.finishes ?? []) g.add(pr, sm('availableInFinish'), vc('finish', f));
  for (const x of c.games ?? []) g.add(pr, sm('availableInGame'), vc('game', x));
  for (const x of c.promo_types ?? []) g.add(pr, sm('hasPromoType'), vc('promo-type', x));
  if (c.security_stamp) g.add(pr, sm('hasSecurityStamp'), vc('security-stamp', c.security_stamp));
  if (c.image_status) g.add(pr, sm('hasImageStatus'), vc('image-status', c.image_status));
  g.add(pr, sm('printingLayout'), vc('layout', c.layout));
  for (const [prop, key] of [['isPromo', 'promo'], ['isReprint', 'reprint'], ['isVariation', 'variation'], ['isOversized', 'oversized'], ['isFullArt', 'full_art'], ['isTextless', 'textless'], ['inBooster', 'booster'], ['isStorySpotlight', 'story_spotlight'], ['isDigitalOnly', 'digital'], ['hasContentWarning', 'content_warning']])
    if (c[key] !== undefined) g.add(pr, sm(prop), bool(c[key]));
  if (c.variation_of) g.add(pr, sm('variationOf'), id('printing', c.variation_of));
  // Printed sides and areas. The source's images are per side: double-sided layouts give one
  // image set per face (= per side), single-sided layouts one image set for the whole front, on
  // which all faces sit. Per-face data (printed text, artist, illustration, watermark) goes on the
  // printed area of that face.
  const twoSided = DOUBLE_SIDED.has(c.layout) && faces.length === 2;
  const sides = twoSided
    ? faces.map((f, i) => ({ position: i === 0 ? 'front' : 'back', faces: [[f, i]], images: f.image_uris }))
    : [{ position: 'front', faces: faces.map((f, i) => [f, i]), images: c.image_uris }];
  const artistNode = (aid, name) => {
    const ar = id('artist', aid);
    g.add(ar, a, sm('Artist'));
    identifier(g, ar, 'scryfall-artist-id', aid);
    if (name) g.label(ar, name);
    return ar;
  };
  sides.forEach((side, n) => {
    const ps = id('printing', c.id, 'side', n);
    g.type(ps, 'PrintedSide');
    g.label(ps, `${side.position} of ${c.name} (${c.set?.toUpperCase()} #${c.collector_number}, ${c.lang})`);
    g.add(pr, sm('hasSide'), ps);
    g.add(ps, sm('sideOf'), pr);
    g.add(ps, sm('sidePosition'), vc('side', side.position));
    const illustrationsOnSide = new Set();
    for (const [f, i] of side.faces) {
      const pa = id('printing', c.id, 'side', n, 'area', i);
      g.type(pa, 'PrintedArea');
      g.label(pa, `${f.printed_name ?? f.name} — printed area ${i} of ${c.set?.toUpperCase()} #${c.collector_number} (${c.lang})`);
      g.add(ps, sm('hasPrintedArea'), pa);
      g.add(pa, sm('areaOf'), ps);
      const [o, fi] = oracleOfFace[i] ?? oracleOfFace[0] ?? [];
      if (o) g.add(pa, sm('printsFace'), id('oracle-card', o, 'face', fi));
      const lang = c.lang;
      textExpr(g, pa, 'hasPrintedText', 'PrintedName', 'printed-name', f.printed_name, lang);
      textExpr(g, pa, 'hasPrintedText', 'PrintedTypeLine', 'printed-type-line', f.printed_type_line, lang);
      textExpr(g, pa, 'hasPrintedText', 'PrintedRulesText', 'printed-text', f.printed_text, lang);
      textExpr(g, pa, 'hasPrintedText', 'FlavorText', 'flavor-text', f.flavor_text ?? (faces.length === 1 ? c.flavor_text : undefined), lang);
      textExpr(g, pa, 'hasPrintedText', 'FlavorName', 'flavor-name', f.flavor_name ?? (faces.length === 1 ? c.flavor_name : undefined), lang);
      // artist credit of this area (per face in the source, even when the side has one illustration)
      const artist = f.artist ?? c.artist;
      if (artist) g.add(pa, sm('creditedAs'), lit(artist));
      const areaArtists = f.artist_id ? [f.artist_id] : faces.length === 1 ? (c.artist_ids ?? []) : [];
      for (const aid of areaArtists) g.add(pa, sm('creditedArtist'), artistNode(aid, areaArtists.length === 1 ? artist : null));
      const wm = f.watermark ?? (faces.length === 1 ? c.watermark : undefined);
      if (wm) g.add(pa, sm('hasWatermark'), vc('watermark', slug(wm) === wm ? wm : slug(wm)));
      // illustration: per face when the source gives it there; single-faced cards take the root one
      const ill = f.illustration_id ?? (faces.length === 1 ? c.illustration_id : undefined);
      if (ill) {
        const il = id('illustration', ill);
        g.type(il, 'Illustration');
        g.label(il, `Illustration of ${faces.length > 1 && !twoSided ? c.name : f.name}`);
        identifier(g, il, 'scryfall-illustration-id', ill);
        g.add(pa, sm('showsIllustration'), il);
        illustrationsOnSide.add(ill);
        // contributions to the illustration: its artists as the source credits them for the printing
        // (root artist_ids for a single-sided card, the face's artist for a double-sided one)
        const contributors = twoSided && f.artist_id ? [f.artist_id] : (c.artist_ids ?? (f.artist_id ? [f.artist_id] : []));
        const credit = twoSided ? artist : (c.artist ?? artist);
        for (const aid of contributors) {
          const contrib = id('illustration', ill, 'contribution', aid);
          g.type(contrib, 'ArtisticContribution');
          g.add(il, sm('hasContribution'), contrib);
          g.add(contrib, sm('contributor'), artistNode(aid, contributors.length === 1 ? credit : null));
          if (credit) g.add(contrib, sm('creditedAs'), lit(credit));
        }
      }
    }
    for (const [variant, url] of Object.entries(side.images ?? {})) {
      const img = id('printing', c.id, 'side', n, 'image', variant);
      g.type(img, 'DigitalImage');
      g.add(ps, sm('hasImage'), img);
      g.add(img, sm('imageVariant'), vc('image-variant', variant));
      g.add(img, sm('contentURL'), typed(url, 'anyURI'));
      // the art crop is a crop of the side's illustration, when there is exactly one
      if (variant === 'art_crop' && illustrationsOnSide.size === 1) g.add(img, sm('depictsArtworkOf'), id('illustration', [...illustrationsOnSide][0]));
    }
  });
  // Price observations (volatile, optional)
  for (const [cur, val] of Object.entries(c.prices ?? {})) {
    if (val === null) continue;
    const po = id('claim', 'price', c.id, cur, snapKey);
    g.type(po, 'PriceObservation');
    g.add(po, sm('priceOf'), pr);
    g.add(po, sm('priceCurrency'), vc('currency', cur));
    g.add(po, sm('priceAmount'), typed(val, 'decimal'));
    g.add(po, sm('priceFinish'), vc('finish', cur.endsWith('_foil') ? 'foil' : cur.endsWith('_etched') ? 'etched' : 'nonfoil'));
    claimMeta(g, po, 'scryfall', snap, 'statistical-observation', null);
  }
  // all_parts (resolved later, once all printings are known)
  for (const part of c.all_parts ?? []) pendingParts.push({ from: oracleOfFace.map(([o]) => o), part, snap });
}
const pendingParts = [];

function mapSetMetadata(g, set, x) {
  if (!x) return;
  if (x.released_at) g.add(set, sm('releasedOn'), typed(x.released_at, 'date'));
  if (x.card_count !== undefined) g.add(set, sm('declaredCardCount'), typed(x.card_count, 'nonNegativeInteger'));
  if (x.printed_size !== undefined) g.add(set, sm('printedSize'), typed(x.printed_size, 'nonNegativeInteger'));
  for (const [prop, key] of [['digitalSet', 'digital'], ['foilOnlySet', 'foil_only'], ['nonfoilOnlySet', 'nonfoil_only']]) if (x[key] !== undefined) g.add(set, sm(prop), bool(x[key]));
  if (x.block_code) g.add(set, sm('blockCode'), lit(x.block_code));
  if (x.scryfall_uri) g.add(set, sm('sourceURL'), typed(x.scryfall_uri, 'anyURI'));
  identifier(g, set, 'mtgo-set-code', x.mtgo_code); identifier(g, set, 'arena-set-code', x.arena_code); identifier(g, set, 'tcgplayer-set-id', x.tcgplayer_id);
  if (x.icon_svg_uri) {
    const icon = nn(`${set.value}/icon`);
    g.type(icon, 'DigitalImage');
    g.add(icon, sm('contentURL'), typed(x.icon_svg_uri, 'anyURI'));
    g.add(set, sm('hasSetIcon'), icon);
  }
  const parent = x.parent_set_code && setByCode.get(x.parent_set_code);
  if (parent) {
    const ps = id('set', parent.id);
    g.type(ps, 'MtgSet'); g.label(ps, parent.name);
    g.add(ps, sm('setCode'), lit(parent.code));
    g.add(ps, sm('hasSetType'), vc('set-type', parent.set_type));
    identifier(g, ps, 'scryfall-set-id', parent.id); identifier(g, ps, 'set-code', parent.code);
    g.add(set, sm('parentSet'), ps);
  }
}

function resolveParts(g) {
  for (const { from, part } of pendingParts) {
    const targets = printingToOracle.get(part.id);
    for (const o of from) {
      if (!targets) { unresolved.push(part); continue; }
      for (const t of targets) {
        if (t === o) continue;
        const rel = id('oracle-card', o, 'part', part.component, t);
        g.type(rel, 'PartRelationship');
        g.add(id('oracle-card', o), sm('hasPartRelationship'), rel);
        g.add(rel, sm('relatedObject'), id('oracle-card', t));
        g.add(rel, sm('partRole'), vc('part-component', part.component));
        if (part.component === 'meld_result') g.add(id('oracle-card', o), sm('meldsInto'), id('oracle-card', t));
      }
    }
  }
}
const unresolved = [];

// ---------------------------------------------------------------------------
// Tagger
function mapTag(g, t, sourceKey) {
  const kind = t.type === 'oracle' ? 'oracle' : 'art';
  const tag = id('tag', kind, t.id);
  g.type(tag, kind === 'oracle' ? 'OracleTag' : 'ArtTag');
  g.add(tag, nn(SKOS + 'prefLabel'), lit(t.label, 'en'));
  g.add(tag, nn(SKOS + 'inScheme'), nn(`${V}${kind === 'oracle' ? 'tagger-oracle-tags' : 'tagger-art-tags'}`));
  if (t.description) g.add(tag, nn(SKOS + 'definition'), lit(t.description, 'en'));
  for (const al of t.aliases ?? []) g.add(tag, nn(SKOS + 'altLabel'), lit(al, 'en'));
  g.add(tag, sm('taggerSlug'), lit(t.slug));
  identifier(g, tag, 'tagger-tag-id', t.id);
  if (t.uri) g.add(tag, sm('sourceURL'), typed(t.uri, 'anyURI'));
  for (const par of t.parent_ids ?? []) g.add(tag, sm('taggerParent'), id('tag', kind, par));
  const snap = snapIri(sourceKey);
  for (const tg of t.taggings ?? []) {
    const target = tg.oracle_id ? id('oracle-card', tg.oracle_id) : id('illustration', tg.illustration_id);
    const ta = id('claim', 'tagging', t.id, tg.oracle_id ?? tg.illustration_id);
    g.type(ta, kind === 'oracle' ? 'OracleTagAssignment' : 'ArtTagAssignment');
    g.add(ta, sm('assignedTag'), tag);
    g.add(ta, sm('assignmentTarget'), target);
    if (tg.weight) g.add(ta, sm('taggingWeight'), vc('tagging-weight', tg.weight));
    if (tg.annotation) g.add(ta, sm('taggingAnnotation'), lit(tg.annotation));
    claimMeta(g, ta, 'tagger-community', snap, 'community-curated', 'belief');
    referencedTargets.push(tg.oracle_id ? ['oracle', tg.oracle_id] : ['illustration', tg.illustration_id]);
  }
}
const referencedTargets = [];

// ---------------------------------------------------------------------------
// Commander Spellbook
function mapVariant(g, v) {
  const snap = snapIri('spellbook:variants');
  const cv = id('combo-variant', v.id);
  g.type(cv, 'ComboVariant');
  g.label(cv, `Combo ${v.id}: ${(v.uses ?? []).map((u) => u.card?.name).join(' + ')}`);
  identifier(g, cv, 'spellbook-variant-id', v.id);
  g.add(cv, sm('spellbookStatus'), lit(v.status));
  claimMeta(g, cv, 'commander-spellbook', snap, 'community-curated', null);
  (v.uses ?? []).forEach((u, i) => {
    const use = nn(`${cv.value}/use/${i}`);
    g.type(use, 'ComboCardUse');
    g.add(cv, sm('hasCardUse'), use);
    if (u.card?.oracleId) { g.add(use, sm('usesCard'), id('oracle-card', u.card.oracleId)); referencedTargets.push(['oracle', u.card.oracleId]); }
    g.add(use, sm('quantity'), typed(u.quantity ?? 1, 'positiveInteger'));
    for (const z of u.zoneLocations ?? []) g.add(use, sm('startsInZone'), vc('zone', z));
    if (u.mustBeCommander !== undefined) g.add(use, sm('mustBeCommander'), bool(u.mustBeCommander));
    // Spellbook usedFace is 1-based (values 1 and 2 on two-faced cards); faceIndex is 0-based
    if (u.usedFace != null && u.card?.oracleId) g.add(use, sm('usesFace'), id('oracle-card', u.card.oracleId, 'face', Number(u.usedFace) - 1));
    for (const k of ['battlefieldCardState', 'exileCardState', 'libraryCardState', 'graveyardCardState']) if (u[k]) g.add(use, sm('requiredCardState'), lit(`${k.replace('CardState', '')}: ${u[k]}`));
  });
  (v.requires ?? []).forEach((r, i) => {
    const req = nn(`${cv.value}/requires/${i}`);
    g.type(req, 'TemplateRequirement');
    g.add(cv, sm('hasTemplateRequirement'), req);
    const t = r.template ?? {};
    const tpl = id('combo-template', t.id ?? slug(t.name ?? `t${i}`));
    g.type(tpl, 'ComboTemplate'); g.label(tpl, t.name);
    if (t.scryfallQuery) g.add(tpl, sm('templateQuery'), lit(t.scryfallQuery));
    if (t.id !== undefined) identifier(g, tpl, 'spellbook-template-id', t.id);
    g.add(req, sm('requiresTemplate'), tpl);
    g.add(req, sm('quantity'), typed(r.quantity ?? 1, 'positiveInteger'));
    for (const z of r.zoneLocations ?? []) g.add(req, sm('startsInZone'), vc('zone', z));
  });
  (v.produces ?? []).forEach((pdt, i) => {
    const fp = nn(`${cv.value}/produces/${i}`);
    g.type(fp, 'FeatureProduction');
    g.add(cv, sm('hasFeatureProduction'), fp);
    const f = pdt.feature ?? {};
    const feat = id('combo-feature', f.id);
    g.type(feat, 'ComboFeature'); g.label(feat, f.name);
    identifier(g, feat, 'spellbook-feature-id', f.id);
    if (f.uncountable !== undefined) g.add(feat, sm('featureUncountable'), bool(f.uncountable));
    if (f.status) g.add(feat, sm('featureStatusCode'), lit(f.status));
    g.add(fp, sm('producesFeature'), feat);
    g.add(fp, sm('quantity'), typed(pdt.quantity ?? 1, 'positiveInteger'));
  });
  for (const r of v.of ?? []) { const rc = id('combo-recipe', r.id); g.type(rc, 'ComboRecipe'); identifier(g, rc, 'spellbook-combo-id', r.id); g.add(cv, sm('generatedFromRecipe'), rc); }
  for (const r of v.includes ?? []) { const rc = id('combo-recipe', r.id); g.type(rc, 'ComboRecipe'); identifier(g, rc, 'spellbook-combo-id', r.id); g.add(cv, sm('includesRecipe'), rc); }
  if (v.description) g.add(cv, sm('stepsDescription'), lit(v.description));
  if (v.easyPrerequisites) g.add(cv, sm('easyPrerequisites'), lit(v.easyPrerequisites));
  if (v.notablePrerequisites) g.add(cv, sm('notablePrerequisites'), lit(v.notablePrerequisites));
  if (v.manaNeeded) g.add(cv, sm('manaNeeded'), lit(v.manaNeeded));
  if (v.identity) g.add(cv, sm('comboColorIdentity'), vc('color-combination', comboCode(v.identity)));
}

function mapAlias(g, al) {
  const idNode = id('identifier', 'spellbook-variant-id', slug(al.id));
  g.type(idNode, 'Identifier');
  g.add(idNode, sm('identifierValue'), lit(al.id));
  g.add(idNode, sm('identifierScheme'), vc('identifier-scheme', 'spellbook-variant-id'));
  if (al.variant) g.add(id('combo-variant', al.variant), sm('formerIdentifier'), idNode);
  else g.add(idNode, sm('identifierWithdrawn'), bool(true));
}

// ---------------------------------------------------------------------------
async function write(file, quads, header) {
  const writer = new N3.Writer({ prefixes: { ...PREFIXES, smtgid: ID, smtgv: V } });
  writer.addQuads(quads);
  const body = await new Promise((res, rej) => writer.end((e, r) => (e ? rej(e) : res(r))));
  fs.writeFileSync(file, `# ${header}\n# GENERATED by tools/map/map-fixtures.mjs (prototype, fixture-only) — do not edit.\n\n${body}`);
}

const readFixtures = (dir) => (fs.existsSync(p('fixtures', dir)) ? fs.readdirSync(p('fixtures', dir)).filter((f) => f.endsWith('.json')).sort().map((f) => [f, JSON.parse(fs.readFileSync(p('fixtures', dir, f), 'utf8'))]) : []);
const guard = (f, recs) => { if (recs.length > MAX_RECORDS) throw new Error(`${f}: ${recs.length} records > ${MAX_RECORDS} (prototype mapper is fixture-only)`); };
const sourceKeyOf = (fx, fallback) => fx.source?.key ?? fallback;

ensureDir(p('examples'));
for (const f of fs.readdirSync(p('examples'))) if (f.endsWith('.ttl')) fs.unlinkSync(p('examples', f));
const written = [];

await write(p('examples', '_snapshots.ttl'), snapshotQuads(), 'Source snapshots used by the examples (from data/raw/manifest.json)');
written.push('_snapshots.ttl');

const scryfallFx = readFixtures('scryfall');
const graphs = [];
for (const [f, fx] of scryfallFx) {
  const recs = fx.records ?? [];
  guard(f, recs);
  const g = new Graph();
  for (const [i, r] of recs.entries()) {
    // per-record provenance: fixtures mix oracle_cards and all_cards records (recordIndex)
    const key = fx.recordIndex?.[i]?.sourceKey ?? sourceKeyOf(fx, 'scryfall:all_cards');
    mapCardObject(g, r, key.startsWith('scryfall:') ? key : 'scryfall:all_cards');
  }
  graphs.push([f, fx, g]);
}
// parts need all printings known
const partsGraph = new Graph();
resolveParts(partsGraph);
for (const [f, fx, g] of graphs) {
  await write(p('examples', f.replace(/\.json$/, '.ttl')), g.q, `Fixture ${fx.slug ?? f}: ${fx.purpose ?? ''}`.replace(/\n/g, ' '));
  written.push(f.replace(/\.json$/, '.ttl'));
}
if (partsGraph.q.length) { await write(p('examples', '_part-relationships.ttl'), partsGraph.q, 'Part relationships (all_parts) resolved across fixtures'); written.push('_part-relationships.ttl'); }

for (const [f, fx] of readFixtures('tagger')) {
  const recs = fx.records ?? [];
  guard(f, recs);
  const g = new Graph();
  for (const t of recs) mapTag(g, t, t.type === 'oracle' ? 'scryfall:oracle_tags' : 'scryfall:art_tags');
  await write(p('examples', `tagger-${f.replace(/\.json$/, '.ttl')}`), g.q, `Tagger fixture ${fx.slug ?? f}: ${fx.purpose ?? ''}`.replace(/\n/g, ' '));
  written.push(`tagger-${f.replace(/\.json$/, '.ttl')}`);
}
for (const [f, fx] of readFixtures('spellbook')) {
  const recs = fx.records ?? [];
  guard(f, recs);
  const g = new Graph();
  for (const v of recs) {
    if ('variant' in v && !('uses' in v)) mapAlias(g, v); // alias record: former id → current id | null
    else mapVariant(g, v);
  }
  await write(p('examples', `spellbook-${f.replace(/\.json$/, '.ttl')}`), g.q, `Spellbook fixture ${fx.slug ?? f}: ${fx.purpose ?? ''}`.replace(/\n/g, ' '));
  written.push(`spellbook-${f.replace(/\.json$/, '.ttl')}`);
}

// Rulings (fixtures/rulings): dated, attributed text claims about Oracle cards
for (const [f, fx] of readFixtures('rulings')) {
  const recs = fx.records ?? [];
  guard(f, recs);
  const g = new Graph();
  const snap = snapIri('scryfall:rulings');
  for (const r of recs) {
    const key = crypto.createHash('sha256').update(`${r.source}|${r.published_at}|${r.comment}`).digest('hex').slice(0, 12);
    const ru = id('claim', 'ruling', r.oracle_id, key);
    g.type(ru, 'Ruling');
    g.add(ru, sm('rulingFor'), id('oracle-card', r.oracle_id));
    g.add(ru, sm('rulingText'), lit(r.comment));
    if (r.published_at) g.add(ru, sm('publishedOn'), typed(r.published_at, 'date'));
    claimMeta(g, ru, r.source === 'wotc' ? 'wizards' : 'scryfall', snap, r.source === 'wotc' ? 'authoritative-report' : 'source-editorial', 'knowledge-claim');
    referencedTargets.push(['oracle', r.oracle_id]);
  }
  await write(p('examples', `rulings-${f.replace(/\.json$/, '.ttl')}`), g.q, `Rulings fixture ${fx.slug ?? f}: ${fx.purpose ?? ''}`.replace(/\n/g, ' '));
  written.push(`rulings-${f.replace(/\.json$/, '.ttl')}`);
}

// Referenced Oracle cards / illustrations not covered by Scryfall fixtures:
// resolve Oracle cards from the oracle_cards snapshot (real data), so that the
// example graph is closed under references. Illustrations get a minimal node.
const missingOracle = new Set(referencedTargets.filter(([k, v]) => k === 'oracle' && !oracleDone.has(v)).map(([, v]) => v));
const knownIll = new Set(graphs.flatMap(([, , g]) => g.q.filter((q) => q.object.value === S + 'Illustration').map((q) => q.subject.value)));
const refGraph = new Graph();
if (missingOracle.size) {
  if (missingOracle.size > MAX_RECORDS) throw new Error(`too many referenced Oracle cards (${missingOracle.size})`);
  const file = rawFile('scryfall:oracle_cards');
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    const oid = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
    if (missingOracle.has(oid)) { mapCardObject(refGraph, c, 'scryfall:oracle_cards'); missingOracle.delete(oid); }
    if (!missingOracle.size) break;
  }
  rl.close();
}
for (const [k, v] of referencedTargets) {
  if (k === 'illustration' && !knownIll.has(`${ID}illustration/${v}`)) {
    const il = id('illustration', v);
    refGraph.type(il, 'Illustration');
    identifier(refGraph, il, 'scryfall-illustration-id', v);
  }
}
if (refGraph.q.length) { await write(p('examples', '_referenced.ttl'), refGraph.q, 'Oracle cards and illustrations referenced by tag/combo fixtures, resolved from the oracle_cards snapshot'); written.push('_referenced.ttl'); }

log(`wrote ${written.length} example files; unresolved all_parts references: ${unresolved.length}; Oracle ids not found: ${missingOracle.size}`);
if (missingOracle.size) log('missing:', [...missingOracle].join(', '));
if (quirks.producedManaSkipped.length) log('produced_mana values skipped (not mana symbols):', [...new Set(quirks.producedManaSkipped)].join('; '));
