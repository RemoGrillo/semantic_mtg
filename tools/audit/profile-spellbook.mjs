#!/usr/bin/env node
// Phase 0 — profile the Commander Spellbook bulk export (variants.json.gz).
//   -> docs/source-audit/spellbook-profile.json (+ .md)
// The export is ONE JSON object {timestamp, version, variants:[…], aliases:[…]} (~700 MB
// decompressed), so it is streamed with stream-json (parser + pick + streamValues).
import {
  FieldCensus, streamJSONGz, manifestEntry, snapshotOf, sortCounts, trim, loadOracleIndex,
  fmt, pct, mdTable, countsTable, fieldsTable, writeText, writeJSON, log, p,
} from './audit-lib.mjs';

const KEY = 'spellbook:variants';
const inc = (o, k, by = 1) => (o[k] = (o[k] ?? 0) + by);
const bucket = (n, edges) => edges.find((x, i) => i === edges.length - 1 || n <= Number(x));

const entry = manifestEntry(KEY);
const file = p(entry.localPath);
const generatedAt = new Date().toISOString();

log('loading Scryfall oracle ids (oracle_cards)');
const oracle = await loadOracleIndex();

const census = new FieldCensus({ groupName: 'byStatus' });
const topLevelKeys = {};
const meta = {};
const statuses = {};
const identity = {};
const bracketTags = {};
const usesHist = {};
const qtyHist = {};
const requiresHist = {};
const producesHist = {};
const zoneUses = {};
const zoneReq = {};
const zoneCombos = {};
const usedFace = {};
const cardStates = { battlefieldCardState: 0, exileCardState: 0, libraryCardState: 0, graveyardCardState: 0 };
let mustBeCommander = 0;
let withRequires = 0;
let spoilerVariants = 0;
const cards = new Map(); // spellbook card id -> {name, oracleId, variants}
const oracleToCardIds = new Map();
const templates = new Map(); // id -> {template, variants}
const features = new Map(); // id -> {feature, variants}
const featureStatusInProduces = {};
const combosOf = new Set();
const combosIncludes = new Set();
const ofCountHist = {};
let ofNotSubsetOfIncludes = 0;
let variants = 0;
const variantIds = new Set();
const aliases = [];
let usesEntries = 0;
let oracleNull = 0;
const oracleNotFound = new Map();
const nameMismatch = new Map();
const nonOkSamples = [];
const variantCountField = {};
const idComposition = { matchesRule: 0, other: 0, otherSamples: [] };

const queue = [];
const filter = (stack) => {
  if (stack.length === 1) {
    inc(topLevelKeys, stack[0]);
    if (stack[0] !== 'variants' && stack[0] !== 'aliases') {
      queue.push(stack[0]);
      return true;
    }
    return false;
  }
  if (stack.length === 2 && (stack[0] === 'variants' || stack[0] === 'aliases') && typeof stack[1] === 'number') {
    queue.push(stack[0]);
    return true;
  }
  return false;
};

function onVariant(v) {
  variants++;
  variantIds.add(v.id);
  census.observe(v, v.status ?? '(none)');
  inc(statuses, v.status ?? '(none)');
  if (v.status !== 'OK' && nonOkSamples.length < 5) nonOkSamples.push({ id: v.id, status: v.status });
  inc(identity, v.identity ?? '(none)');
  inc(bracketTags, v.bracketTag ?? '(none)');
  if (v.spoiler) spoilerVariants++;
  inc(variantCountField, bucket(v.variantCount ?? 0, ['1', '2', '5', '10', '20', '50', '100', '101+']));
  const uses = v.uses ?? [];
  const tids = (v.requires ?? []).map((r) => r.template?.id).sort((a, b) => a - b);
  const composed = uses.map((u) => u.card?.id).sort((a, b) => a - b).join('-') + tids.map((t) => `--${t}`).join('');
  if (composed === v.id) idComposition.matchesRule++;
  else {
    idComposition.other++;
    if (idComposition.otherSamples.length < 8) idComposition.otherSamples.push({ id: v.id, composed });
  }
  inc(usesHist, uses.length >= 10 ? '10+' : uses.length);
  inc(qtyHist, Math.min(10, uses.reduce((s, u) => s + (u.quantity ?? 1), 0)) + (uses.reduce((s, u) => s + (u.quantity ?? 1), 0) >= 10 ? '+' : ''));
  for (const u of uses) {
    usesEntries++;
    const c = u.card ?? {};
    for (const z of u.zoneLocations ?? []) inc(zoneUses, z);
    inc(zoneCombos, (u.zoneLocations ?? []).join(''));
    inc(usedFace, u.usedFace ?? 'null');
    if (u.mustBeCommander) mustBeCommander++;
    for (const k of Object.keys(cardStates)) if (u[k]) cardStates[k]++;
    let e = cards.get(c.id);
    if (!e) cards.set(c.id, (e = { id: c.id, name: c.name, oracleId: c.oracleId ?? null, variants: 0, oracleIds: new Set() }));
    e.variants++;
    e.oracleIds.add(c.oracleId ?? null);
    if (c.oracleId) {
      let s = oracleToCardIds.get(c.oracleId);
      if (!s) oracleToCardIds.set(c.oracleId, (s = new Set()));
      s.add(c.id);
    }
    if (!c.oracleId) oracleNull++;
    else if (!oracle.has(c.oracleId)) oracleNotFound.set(c.oracleId, c.name);
    else {
      const sfName = oracle.names.get(c.oracleId) ?? oracle.faceIds.get(c.oracleId);
      if (sfName !== c.name) nameMismatch.set(c.oracleId, { spellbook: c.name, scryfall: sfName });
    }
  }
  const req = v.requires ?? [];
  if (req.length) withRequires++;
  inc(requiresHist, req.length >= 5 ? '5+' : req.length);
  for (const r of req) {
    for (const z of r.zoneLocations ?? []) inc(zoneReq, z);
    const t = r.template ?? {};
    let e = templates.get(t.id);
    if (!e) templates.set(t.id, (e = { template: t, variants: 0 }));
    e.variants++;
  }
  const prod = v.produces ?? [];
  inc(producesHist, prod.length >= 10 ? '10+' : prod.length);
  for (const pr of prod) {
    const f = pr.feature ?? {};
    inc(featureStatusInProduces, f.status ?? '(none)');
    let e = features.get(f.id);
    if (!e) features.set(f.id, (e = { feature: f, variants: 0, variants1: [] }));
    e.variants++;
  }
  const of = (v.of ?? []).map((x) => x.id);
  const incl = new Set((v.includes ?? []).map((x) => x.id));
  inc(ofCountHist, of.length >= 5 ? '5+' : of.length);
  for (const id of of) combosOf.add(id);
  for (const id of incl) combosIncludes.add(id);
  if (of.some((id) => !incl.has(id))) ofNotSubsetOfIncludes++;
}

log(`streaming ${entry.localPath}`);
const t0 = Date.now();
const { sha256 } = await streamJSONGz(file, filter, (value) => {
  const k = queue.shift();
  if (k === 'variants') {
    onVariant(value);
    if (variants % 20000 === 0) log(`  ${fmt(variants)} variants…`);
  } else if (k === 'aliases') aliases.push(value);
  else meta[k] = value;
});
log(`  ${fmt(variants)} variants, ${fmt(aliases.length)} aliases in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// aliases
const aliasKeys = {};
let aliasVariantNull = 0;
let aliasIdIsVariant = 0;
let aliasTargetExists = 0;
for (const a of aliases) {
  for (const k in a) inc(aliasKeys, k);
  if (a.variant == null) aliasVariantNull++;
  else if (variantIds.has(typeof a.variant === 'object' ? a.variant.id : a.variant)) aliasTargetExists++;
  if (variantIds.has(a.id)) aliasIdIsVariant++;
}

// cards
const cardList = [...cards.values()];
const cardsMultiOracle = cardList.filter((c) => c.oracleIds.size > 1);
const oracleMultiCard = [...oracleToCardIds.entries()].filter(([, s]) => s.size > 1);
const featStatus = {};
const featUncountable = {};
for (const { feature } of features.values()) {
  inc(featStatus, feature.status ?? '(none)');
  inc(featUncountable, String(feature.uncountable));
}
const templateKeys = {};
for (const { template } of templates.values()) for (const k in template) inc(templateKeys, k);

const out = {
  generatedAt,
  source: KEY,
  snapshot: snapshotOf(KEY, { sha256Verified: sha256 === entry.sha256 }),
  topLevelKeys: Object.keys(topLevelKeys),
  timestamp: meta.timestamp ?? null,
  version: meta.version ?? null,
  otherTopLevel: Object.fromEntries(Object.entries(meta).filter(([k]) => k !== 'timestamp' && k !== 'version')),
  variants,
  statuses: sortCounts(statuses),
  nonOkSamples,
  aliases: {
    count: aliases.length,
    keys: sortCounts(aliasKeys),
    withVariantNull: aliasVariantNull,
    withVariantPointingToExportedVariant: aliasTargetExists,
    aliasIdAlsoAVariantId: aliasIdIsVariant,
    samples: aliases.slice(0, 3),
    redirectSamples: aliases.filter((a) => a.variant != null).slice(0, 5),
    note: 'Alias = a former variant id; `variant` is the current variant id it redirects to, or null (no current variant).',
  },
  variantIdComposition: {
    rule: 'variant id == uses[].card.id sorted numerically joined with "-", followed by "--<template id>" for each requires[].template.id in numeric order',
    ...idComposition,
  },
  uses: {
    entries: usesEntries,
    cardsPerVariantHistogram: usesHist,
    totalQuantityPerVariantHistogram: qtyHist,
    zoneLocations: sortCounts(zoneUses),
    zoneLocationCombinations: sortCounts(zoneCombos),
    usedFace: sortCounts(usedFace),
    mustBeCommander,
    nonEmptyCardState: cardStates,
  },
  requires: {
    variantsWithRequires: withRequires,
    requiresPerVariantHistogram: requiresHist,
    zoneLocations: sortCounts(zoneReq),
    distinctTemplates: templates.size,
    templateKeys: sortCounts(templateKeys),
    topTemplates: [...templates.values()].sort((a, b) => b.variants - a.variants).slice(0, 10).map((t) => ({ ...t.template, variants: t.variants })),
  },
  produces: {
    producesPerVariantHistogram: producesHist,
    distinctFeatures: features.size,
    featureStatusDistinctFeatures: sortCounts(featStatus),
    featureStatusInProducesEntries: sortCounts(featureStatusInProduces),
    featureUncountable: featUncountable,
    statusNote: 'Feature status codes are not explained in the export; their meaning must be verified against the Commander Spellbook backend/API docs.',
    topFeatures: [...features.values()].sort((a, b) => b.variants - a.variants).slice(0, 15).map((f) => ({ ...f.feature, variants: f.variants })),
  },
  combos: {
    distinctOfIds: combosOf.size,
    distinctIncludesIds: combosIncludes.size,
    ofPerVariantHistogram: ofCountHist,
    variantsWhereOfNotSubsetOfIncludes: ofNotSubsetOfIncludes,
    note: '`of` / `includes` carry only combo ids; editor-authored combo records are NOT in the bulk export.',
  },
  identity: sortCounts(identity),
  bracketTag: sortCounts(bracketTags),
  variantCountField: variantCountField,
  spoilerVariants,
  cards: {
    distinctSpellbookCardIds: cards.size,
    distinctOracleIds: oracleToCardIds.size,
    cardIdsWithMultipleOracleIds: cardsMultiOracle.length,
    oracleIdsWithMultipleCardIds: oracleMultiCard.length,
    oracleMultiCardSamples: oracleMultiCard.slice(0, 5).map(([o, s]) => ({ oracleId: o, cardIds: [...s] })),
    topCards: cardList.sort((a, b) => b.variants - a.variants).slice(0, 15).map((c) => ({ id: c.id, name: c.name, oracleId: c.oracleId, variants: c.variants })),
  },
  scryfallCrossCheck: {
    method: 'uses[].card.oracleId compared to root and card_faces[] oracle ids in Scryfall oracle_cards (same snapshot day).',
    usesEntries,
    oracleIdNullOrMissing: oracleNull,
    distinctOracleIdsNotFound: oracleNotFound.size,
    notFoundSamples: [...oracleNotFound.entries()].slice(0, 15).map(([oracleId, name]) => ({ oracleId, name })),
    distinctOracleIdsWithNameMismatch: nameMismatch.size,
    nameMismatchSamples: [...nameMismatch.entries()].slice(0, 10).map(([oracleId, v]) => ({ oracleId, ...v })),
  },
  fields: census.result(),
};
writeJSON(p('docs/source-audit/spellbook-profile.json'), out);
log('wrote docs/source-audit/spellbook-profile.json');

// ---------------------------------------------------------------------------------------
const h = (o) => Object.entries(o).map(([a, b]) => `${a}: ${fmt(b)}`).join(' · ');
const md = [
  '# Commander Spellbook profile',
  '',
  `Generated by \`tools/audit/profile-spellbook.mjs\` at ${generatedAt}. Machine-readable: \`docs/source-audit/spellbook-profile.json\`.`,
  '',
  `Snapshot \`${out.snapshot.file}\` · sha256 \`${out.snapshot.sha256.slice(0, 16)}…\`${out.snapshot.sha256Verified ? ' (verified)' : ''} · retrieved ${out.snapshot.retrievedAt} · export timestamp **${out.timestamp}** · export version **${out.version}**`,
  '',
  `Top-level keys: ${out.topLevelKeys.map((k) => `\`${k}\``).join(', ')}.`,
  '',
  '## Overview',
  '',
  mdTable(['measure', 'value'], [
    ['variants', fmt(variants)],
    ['statuses', Object.entries(out.statuses).map(([a, b]) => `\`${a}\` ${fmt(b)}`).join(', ')],
    ['variant ids = sorted card ids joined "-" + "--<template id>" per template', `${fmt(idComposition.matchesRule)} of ${fmt(variants)} (other: ${fmt(idComposition.other)}${idComposition.otherSamples[0] ? `, e.g. \`${idComposition.otherSamples[0].id}\` vs \`${idComposition.otherSamples[0].composed}\`` : ''})`],
    ['aliases', `${fmt(out.aliases.count)} (variant null: ${fmt(out.aliases.withVariantNull)}; pointing to an exported variant: ${fmt(out.aliases.withVariantPointingToExportedVariant)}; alias id also a variant id: ${fmt(out.aliases.aliasIdAlsoAVariantId)})`],
    ['`uses[]` entries', fmt(usesEntries)],
    ['distinct Spellbook card ids / oracle ids', `${fmt(out.cards.distinctSpellbookCardIds)} / ${fmt(out.cards.distinctOracleIds)}`],
    ['card ids with >1 oracleId / oracle ids with >1 card id', `${fmt(out.cards.cardIdsWithMultipleOracleIds)} / ${fmt(out.cards.oracleIdsWithMultipleCardIds)}`],
    ['variants with non-empty `requires` (templates)', `${fmt(withRequires)} (${pct(withRequires, variants)})`],
    ['distinct templates', fmt(templates.size)],
    ['distinct features', fmt(features.size)],
    ['distinct combo ids in `of` / `includes`', `${fmt(combosOf.size)} / ${fmt(combosIncludes.size)}`],
    ['variants where `of` ⊄ `includes`', fmt(ofNotSubsetOfIncludes)],
    ['spoiler variants', fmt(spoilerVariants)],
    ['`uses[].card.oracleId` null/missing', fmt(oracleNull)],
    ['distinct oracleIds not found in Scryfall oracle_cards', fmt(oracleNotFound.size)],
    ['distinct oracleIds whose Spellbook name ≠ Scryfall name', fmt(nameMismatch.size)],
  ]),
  '',
  `Cards per variant (uses.length): ${h(usesHist)}`,
  '',
  `Total card quantity per variant: ${h(qtyHist)}`,
  '',
  `Templates per variant (requires.length): ${h(requiresHist)}`,
  '',
  `Features per variant (produces.length): ${h(producesHist)}`,
  '',
  `\`uses[].zoneLocations\` values: ${h(out.uses.zoneLocations)} — combinations: ${h(out.uses.zoneLocationCombinations)}`,
  '',
  `\`requires[].zoneLocations\` values: ${h(out.requires.zoneLocations)}`,
  '',
  `\`usedFace\`: ${h(out.uses.usedFace)} · \`mustBeCommander\` true: ${fmt(mustBeCommander)} · non-empty card states: ${h(cardStates)}`,
  '',
  `Feature \`status\` (distinct features): ${h(out.produces.featureStatusDistinctFeatures)} · in produces entries: ${h(out.produces.featureStatusInProducesEntries)} · \`uncountable\`: ${h(featUncountable)}. ${out.produces.statusNote}`,
  '',
  `\`bracketTag\`: ${h(out.bracketTag)}`,
  '',
  '## Identity (colour identity) distribution',
  '',
  countsTable(out.identity, variants, '`identity`'),
  '',
  '## Top features',
  '',
  mdTable(['id', 'name', 'status', 'uncountable', 'variants'], out.produces.topFeatures.map((f) => [f.id, f.name, f.status, String(f.uncountable), fmt(f.variants)])),
  '',
  '## Top templates',
  '',
  mdTable(['id', 'name', 'variants', 'other keys'], out.requires.topTemplates.map((t) => [t.id, t.name, fmt(t.variants), trim(JSON.stringify(Object.fromEntries(Object.entries(t).filter(([k]) => !['id', 'name', 'variants'].includes(k)))), 100)])),
  '',
  '## Most used cards',
  '',
  mdTable(['card id', 'name', 'oracleId', 'variants'], out.cards.topCards.map((c) => [c.id, c.name, `\`${c.oracleId}\``, fmt(c.variants)])),
  '',
  out.scryfallCrossCheck.notFoundSamples.length ? `oracleIds not found in Scryfall: ${out.scryfallCrossCheck.notFoundSamples.map((s) => `${s.name} (\`${s.oracleId}\`)`).join('; ')}\n` : '',
  out.scryfallCrossCheck.nameMismatchSamples.length ? `Name mismatches (samples): ${out.scryfallCrossCheck.nameMismatchSamples.map((s) => `“${s.spellbook}” vs Scryfall “${s.scryfall}”`).join('; ')}\n` : '',
  '## Field census (variant records)',
  '',
  fieldsTable(out.fields, variants),
].join('\n');
writeText(p('docs/source-audit/spellbook-profile.md'), md);
log('wrote docs/source-audit/spellbook-profile.md');
