#!/usr/bin/env node
// Phase 0 — profile the Scryfall Tagger exports (oracle_tags, art_tags).
//   -> docs/source-audit/tagger-profile.json (+ .md)
// Cross-checks tagging targets against all_cards (oracle_id / illustration_id, root + faces)
// and oracle_cards (root oracle ids).
// Usage: node tools/audit/profile-tagger.mjs [--no-cross-check]
import {
  AUDIT_DIR, FieldCensus, readJSONL, manifestEntry, snapshotOf, sortCounts, trim, loadOracleIndex, scanAllCardsIds,
  fmt, pct, mdTable, countsTable, fieldsTable, writeText, writeJSON, log, p,
} from './audit-lib.mjs';

const noCross = process.argv.includes('--no-cross-check');
const inc = (o, k, by = 1) => (o[k] = (o[k] ?? 0) + by);

async function loadTags(key) {
  const entry = manifestEntry(key);
  const state = {};
  const tags = [];
  const census = new FieldCensus({ groupName: 'byType', distinctCap: 5000 });
  for await (const t of readJSONL(p(entry.localPath), { state })) {
    tags.push(t);
    census.observe(t, t.type ?? '(none)');
  }
  const snapshot = snapshotOf(key, { sha256Verified: state.sha256 === entry.sha256 });
  return { key, tags, census, snapshot };
}

function hierarchy(tags, otherIndex) {
  const byId = new Map(tags.map((t) => [t.id, t]));
  const parentHist = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, '5+': 0 };
  const childHist = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, '5+': 0 };
  let multiParent = 0;
  let maxParents = 0;
  const danglingParents = [];
  const crossFileParents = [];
  const danglingChildren = [];
  const pEdges = new Set();
  const cEdges = new Set();
  const selfParent = [];
  const dupParentRefs = [];
  for (const t of tags) {
    const np = t.parent_ids.length;
    parentHist[np >= 5 ? '5+' : np]++;
    const nc = t.child_ids.length;
    childHist[nc >= 5 ? '5+' : nc]++;
    if (np > 1) multiParent++;
    if (np > maxParents) maxParents = np;
    if (new Set(t.parent_ids).size !== np) dupParentRefs.push(t.slug);
    for (const pid of t.parent_ids) {
      if (pid === t.id) selfParent.push(t.slug);
      pEdges.add(`${pid}>${t.id}`);
      if (!byId.has(pid)) (otherIndex?.has(pid) ? crossFileParents : danglingParents).push({ tag: t.slug, parent: pid });
    }
    for (const cid of t.child_ids) {
      cEdges.add(`${t.id}>${cid}`);
      if (!byId.has(cid)) danglingChildren.push({ tag: t.slug, child: cid });
    }
  }
  const inParentNotChild = [...pEdges].filter((e) => !cEdges.has(e));
  const inChildNotParent = [...cEdges].filter((e) => !pEdges.has(e));
  const edgeLabel = (e) => {
    const [a, b] = e.split('>');
    return { parent: byId.get(a)?.slug ?? a, child: byId.get(b)?.slug ?? b };
  };
  // roots / leaves
  const hasChildViaParents = new Set();
  for (const t of tags) for (const pid of t.parent_ids) hasChildViaParents.add(pid);
  const roots = tags.filter((t) => t.parent_ids.length === 0);
  const leavesByChildIds = tags.filter((t) => t.child_ids.length === 0).length;
  const leavesByInverse = tags.filter((t) => !hasChildViaParents.has(t.id)).length;

  // longest path to a root (root = depth 0), with cycle detection (iterative DFS colouring)
  const depth = new Map();
  const onCycle = new Set();
  const cycles = [];
  const state = new Map(); // 1 = visiting, 2 = done
  const visit = (start) => {
    const stack = [[start, 0]];
    const pathStack = [];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [id, i] = top;
      const t = byId.get(id);
      if (i === 0) {
        if (state.get(id) === 2) {
          stack.pop();
          continue;
        }
        state.set(id, 1);
        pathStack.push(id);
      }
      const parents = (t?.parent_ids ?? []).filter((x) => byId.has(x));
      if (i < parents.length) {
        top[1]++;
        const pid = parents[i];
        const s = state.get(pid);
        if (s === 1) {
          const idx = pathStack.indexOf(pid);
          const cyc = pathStack.slice(idx);
          cyc.forEach((x) => onCycle.add(x));
          if (cycles.length < 5) cycles.push(cyc.map((x) => byId.get(x)?.slug ?? x));
        } else if (s !== 2) stack.push([pid, 0]);
      } else {
        let d = 0;
        for (const pid of parents) if (depth.has(pid)) d = Math.max(d, depth.get(pid) + 1);
        depth.set(id, d);
        state.set(id, 2);
        stack.pop();
        pathStack.pop();
      }
    }
  };
  for (const t of tags) visit(t.id);
  const depthHist = {};
  for (const d of depth.values()) inc(depthHist, d);
  return {
    parentCountHistogram: parentHist,
    childCountHistogram: childHist,
    multiParentTags: multiParent,
    maxParents,
    roots: roots.length,
    rootsSample: roots
      .sort((a, b) => b.child_ids.length - a.child_ids.length || a.slug.localeCompare(b.slug))
      .slice(0, 15)
      .map((t) => ({ slug: t.slug, label: t.label, children: t.child_ids.length, taggings: t.taggings.length })),
    leaves: { byChildIds: leavesByChildIds, byInverseOfParentIds: leavesByInverse },
    depthHistogram: depthHist,
    maxDepth: Math.max(0, ...depth.values()),
    dag: { acyclic: onCycle.size === 0, tagsOnCycles: onCycle.size, sampleCycles: cycles, selfParent },
    danglingParentIds: { count: danglingParents.length, samples: danglingParents.slice(0, 10) },
    parentIdsInOtherTagFile: { count: crossFileParents.length, samples: crossFileParents.slice(0, 10) },
    danglingChildIds: { count: danglingChildren.length, samples: danglingChildren.slice(0, 10) },
    duplicateParentRefs: dupParentRefs.length,
    childParentConsistency: {
      parentEdges: pEdges.size,
      childEdges: cEdges.size,
      inParentIdsNotInChildIds: inParentNotChild.length,
      inChildIdsNotInParentIds: inChildNotParent.length,
      exactInverse: inParentNotChild.length === 0 && inChildNotParent.length === 0,
      samplesParentOnly: inParentNotChild.slice(0, 8).map(edgeLabel),
      samplesChildOnly: inChildNotParent.slice(0, 8).map(edgeLabel),
    },
    byId,
  };
}

function profile({ tags, census, snapshot }, targetKey, otherIndex) {
  const h = hierarchy(tags, otherIndex);
  const byId = h.byId;
  delete h.byId;
  const weights = {};
  const annotationSamples = [];
  let taggings = 0;
  let withAnnotation = 0;
  const annotationDistinct = new Set();
  const targets = new Set();
  const tagsPerTarget = new Map();
  const assigned = new Set();
  let dupTaggings = 0;
  const targetKeysSeen = {};
  let zeroTaggings = 0;
  for (const t of tags) {
    if (!t.taggings.length) zeroTaggings++;
    const seen = new Set();
    for (const g of t.taggings) {
      taggings++;
      for (const k in g) inc(targetKeysSeen, k);
      inc(weights, g.weight ?? '(none)');
      const target = g[targetKey];
      if (seen.has(target)) dupTaggings++;
      seen.add(target);
      targets.add(target);
      tagsPerTarget.set(target, (tagsPerTarget.get(target) ?? 0) + 1);
      assigned.add(`${t.id}|${target}`);
      if (g.annotation != null) {
        withAnnotation++;
        annotationDistinct.add(g.annotation);
        if (annotationSamples.length < 3) annotationSamples.push({ tag: t.slug, [targetKey]: target, weight: g.weight, annotation: trim(g.annotation, 200) });
      }
    }
  }
  // Are ancestor assignments materialised? For each (tag, target) check the direct parents.
  let parentChecks = 0;
  let parentAlsoAssigned = 0;
  for (const t of tags)
    for (const g of t.taggings)
      for (const pid of t.parent_ids) {
        if (!byId.has(pid)) continue;
        parentChecks++;
        if (assigned.has(`${pid}|${g[targetKey]}`)) parentAlsoAssigned++;
      }
  const tptHist = { 1: 0, 2: 0, 3: 0, 5: 0, 10: 0, 20: 0, 50: 0, '51+': 0 };
  for (const n of tagsPerTarget.values()) {
    const b = Object.keys(tptHist).find((x, i, arr) => i === arr.length - 1 || n <= Number(x));
    tptHist[b]++;
  }
  const label = (id) => byId.get(id)?.label ?? `(missing ${id})`;
  const multi = tags.filter((t) => t.parent_ids.length > 1).sort((a, b) => b.taggings.length - a.taggings.length || a.slug.localeCompare(b.slug));
  return {
    snapshot,
    tags: tags.length,
    objects: sortCounts(tags.reduce((o, t) => (inc(o, t.object), o), {})),
    types: sortCounts(tags.reduce((o, t) => (inc(o, t.type), o), {})),
    taggings,
    taggingKeys: sortCounts(targetKeysSeen),
    tagsWithZeroTaggings: zeroTaggings,
    duplicateTaggingsWithinTag: dupTaggings,
    weights: sortCounts(weights),
    taggingsWithAnnotation: withAnnotation,
    distinctAnnotations: annotationDistinct.size,
    annotationSamples,
    tagsWithDescription: tags.filter((t) => t.description != null && t.description !== '').length,
    tagsWithAliases: tags.filter((t) => t.aliases?.length).length,
    aliasesTotal: tags.reduce((s, t) => s + (t.aliases?.length ?? 0), 0),
    aliasSamples: tags.filter((t) => t.aliases?.length).slice(0, 5).map((t) => ({ slug: t.slug, aliases: t.aliases })),
    labelDiffersFromSlug: tags.filter((t) => t.label !== t.slug).length,
    labelDiffersFromSlugSamples: tags.filter((t) => t.label !== t.slug).slice(0, 5).map((t) => ({ label: t.label, slug: t.slug })),
    ...h,
    ancestorAssignmentsMaterialised: {
      note: 'For every tagging (tag, target) and every direct parent P of tag: is (P, target) also an explicit tagging?',
      checks: parentChecks,
      parentAlsoAssigned,
      share: parentChecks ? +(parentAlsoAssigned / parentChecks).toFixed(4) : null,
    },
    topByTaggings: [...tags].sort((a, b) => b.taggings.length - a.taggings.length || a.slug.localeCompare(b.slug)).slice(0, 15).map((t) => ({ slug: t.slug, label: t.label, taggings: t.taggings.length, parents: t.parent_ids.map(label) })),
    multiParentExamples: multi.slice(0, 10).map((t) => ({ slug: t.slug, label: t.label, taggings: t.taggings.length, parents: t.parent_ids.map(label) })),
    distinctTargets: targets.size,
    tagsPerTargetHistogram: tptHist,
    fields: census.result(),
    _targets: targets,
  };
}

// ---------------------------------------------------------------------------------------
const generatedAt = new Date().toISOString();
log('loading oracle_tags and art_tags');
const O = await loadTags('scryfall:oracle_tags');
const A = await loadTags('scryfall:art_tags');
const oIndex = new Set(O.tags.map((t) => t.id));
const aIndex = new Set(A.tags.map((t) => t.id));
const oracle = profile(O, 'oracle_id', aIndex);
const art = profile(A, 'illustration_id', oIndex);
const sharedTagIds = [...oIndex].filter((id) => aIndex.has(id)).length;

let crossCheck = { skipped: true };
if (!noCross) {
  log('cross-check: loading oracle_cards ids');
  const oc = await loadOracleIndex();
  log('cross-check: scanning all_cards ids');
  const ac = await scanAllCardsIds();
  const ot = oracle._targets;
  const at = art._targets;
  const missO = [...ot].filter((id) => !ac.oracle.has(id));
  const missA = [...at].filter((id) => !ac.illustration.has(id));
  crossCheck = {
    method: 'Tagging targets compared to every oracle_id / illustration_id string (root or card_faces[]) in all_cards, and to root oracle ids in oracle_cards.',
    allCardsRecords: ac.records,
    oracle: {
      distinctTargets: ot.size,
      foundInAllCards: ot.size - missO.length,
      notFoundInAllCards: missO.length,
      notFoundSamples: missO.slice(0, 10),
      foundAsOracleCardsRoot: [...ot].filter((id) => oc.names.has(id)).length,
      foundOnlyAsFaceOracleIdInOracleCards: [...ot].filter((id) => !oc.names.has(id) && oc.faceIds.has(id)).length,
      allCardsOracleIdsWithAnyOracleTag: [...ac.oracle].filter((id) => ot.has(id)).length,
      allCardsOracleIds: ac.oracle.size,
    },
    art: {
      distinctTargets: at.size,
      foundInAllCards: at.size - missA.length,
      notFoundInAllCards: missA.length,
      notFoundSamples: missA.slice(0, 10),
      allCardsIllustrationIdsWithAnyArtTag: [...ac.illustration].filter((id) => at.has(id)).length,
      allCardsIllustrationIds: ac.illustration.size,
    },
  };
}
delete oracle._targets;
delete art._targets;

const out = {
  generatedAt,
  sources: { oracle: oracle.snapshot, art: art.snapshot },
  tagIdsSharedBetweenFiles: sharedTagIds,
  oracle,
  art,
  crossCheck,
};
writeJSON(p('docs/source-audit/tagger-profile.json'), out);
log('wrote docs/source-audit/tagger-profile.json');

// ---------------------------------------------------------------------------------------
function mdSection(name, r, targetKey) {
  const L = [];
  const h = r.childParentConsistency;
  L.push(`## ${name} tags`, '');
  L.push(`Snapshot \`${r.snapshot.file}\` · sha256 \`${r.snapshot.sha256.slice(0, 16)}…\`${r.snapshot.sha256Verified ? ' (verified)' : ''} · source updated ${r.snapshot.sourceUpdatedAt}`, '');
  L.push(mdTable(['measure', 'value'], [
    ['tags', fmt(r.tags)],
    ['`type` values', Object.entries(r.types).map(([a, b]) => `${a} ×${fmt(b)}`).join(', ')],
    ['taggings', fmt(r.taggings)],
    ['tagging keys', Object.entries(r.taggingKeys).map(([a, b]) => `\`${a}\` ×${fmt(b)}`).join(', ')],
    [`distinct targets (\`${targetKey}\`)`, fmt(r.distinctTargets)],
    ['tags with zero taggings', fmt(r.tagsWithZeroTaggings)],
    ['duplicate taggings within a tag', fmt(r.duplicateTaggingsWithinTag)],
    ['taggings with `annotation`', `${fmt(r.taggingsWithAnnotation)} (${fmt(r.distinctAnnotations)} distinct)`],
    ['tags with description', `${fmt(r.tagsWithDescription)} (${pct(r.tagsWithDescription, r.tags)})`],
    ['tags with aliases', `${fmt(r.tagsWithAliases)} (${fmt(r.aliasesTotal)} aliases)`],
    ['label ≠ slug', fmt(r.labelDiffersFromSlug)],
    ['roots (no parent_ids)', fmt(r.roots)],
    ['leaves (empty child_ids / never a parent)', `${fmt(r.leaves.byChildIds)} / ${fmt(r.leaves.byInverseOfParentIds)}`],
    ['multi-parent tags', `${fmt(r.multiParentTags)} (max ${r.maxParents} parents)`],
    ['max depth (longest path to a root)', r.maxDepth],
    ['acyclic (DAG)', `${r.dag.acyclic}${r.dag.tagsOnCycles ? ` — ${r.dag.tagsOnCycles} tags on cycles` : ''}`],
    ['dangling parent ids / parent ids in the other file', `${fmt(r.danglingParentIds.count)} / ${fmt(r.parentIdsInOtherTagFile.count)}`],
    ['dangling child ids', fmt(r.danglingChildIds.count)],
    ['child_ids exact inverse of parent_ids', `${h.exactInverse} (parent edges ${fmt(h.parentEdges)}, child edges ${fmt(h.childEdges)}, only in parent_ids ${fmt(h.inParentIdsNotInChildIds)}, only in child_ids ${fmt(h.inChildIdsNotInParentIds)})`],
    ['ancestor taggings materialised (direct parent also tagged)', `${fmt(r.ancestorAssignmentsMaterialised.parentAlsoAssigned)} of ${fmt(r.ancestorAssignmentsMaterialised.checks)} (${pct(r.ancestorAssignmentsMaterialised.parentAlsoAssigned, r.ancestorAssignmentsMaterialised.checks)})`],
  ]), '');
  L.push('Weights: ' + Object.entries(r.weights).map(([a, b]) => `\`${a}\` ${fmt(b)}`).join(' · '), '');
  L.push('Parent-count histogram: ' + Object.entries(r.parentCountHistogram).map(([a, b]) => `${a}: ${fmt(b)}`).join(' · '), '');
  L.push('Depth histogram: ' + Object.entries(r.depthHistogram).map(([a, b]) => `${a}: ${fmt(b)}`).join(' · '), '');
  L.push('Tags per target: ' + Object.entries(r.tagsPerTargetHistogram).map(([a, b]) => `≤${a}: ${fmt(b)}`).join(' · '), '');
  if (h.samplesParentOnly.length) L.push('Edges only in parent_ids (samples): ' + h.samplesParentOnly.map((e) => `${e.parent} → ${e.child}`).join('; '), '');
  if (h.samplesChildOnly.length) L.push('Edges only in child_ids (samples): ' + h.samplesChildOnly.map((e) => `${e.parent} → ${e.child}`).join('; '), '');
  if (r.annotationSamples.length) L.push('Annotation samples: ' + r.annotationSamples.map((a) => `\`${a.tag}\` (${a.weight}): “${a.annotation}”`).join('; '), '');
  L.push('### Top tags by taggings', '', mdTable(['slug', 'label', 'taggings', 'parents'], r.topByTaggings.map((t) => [`\`${t.slug}\``, t.label, fmt(t.taggings), t.parents.join(', ')])), '');
  L.push('### Multi-parent examples', '', mdTable(['slug', 'taggings', 'parents'], r.multiParentExamples.map((t) => [`\`${t.slug}\``, fmt(t.taggings), t.parents.join(', ')])), '');
  L.push('### Largest roots', '', mdTable(['slug', 'children', 'taggings'], r.rootsSample.map((t) => [`\`${t.slug}\``, fmt(t.children), fmt(t.taggings)])), '');
  L.push('### Field census', '', fieldsTable(r.fields, r.tags), '');
  return L.join('\n');
}
const cc = out.crossCheck;
const md = [
  '# Scryfall Tagger profile',
  '',
  `Generated by \`tools/audit/profile-tagger.mjs\` at ${generatedAt}. Machine-readable: \`docs/source-audit/tagger-profile.json\`.`,
  '',
  `Tag ids shared between the oracle and art files: ${fmt(sharedTagIds)}.`,
  '',
  cc.skipped
    ? 'Cross-check skipped.'
    : [
        '## Cross-check against Scryfall card data',
        '',
        cc.method,
        '',
        mdTable(['', 'oracle tags (oracle_id)', 'art tags (illustration_id)'], [
          ['distinct targets', fmt(cc.oracle.distinctTargets), fmt(cc.art.distinctTargets)],
          ['found in all_cards', fmt(cc.oracle.foundInAllCards), fmt(cc.art.foundInAllCards)],
          ['not found in all_cards', fmt(cc.oracle.notFoundInAllCards), fmt(cc.art.notFoundInAllCards)],
          ['found as root oracle id in oracle_cards', fmt(cc.oracle.foundAsOracleCardsRoot), '–'],
          ['all_cards ids having ≥1 tag', `${fmt(cc.oracle.allCardsOracleIdsWithAnyOracleTag)} of ${fmt(cc.oracle.allCardsOracleIds)} (${pct(cc.oracle.allCardsOracleIdsWithAnyOracleTag, cc.oracle.allCardsOracleIds)})`, `${fmt(cc.art.allCardsIllustrationIdsWithAnyArtTag)} of ${fmt(cc.art.allCardsIllustrationIds)} (${pct(cc.art.allCardsIllustrationIdsWithAnyArtTag, cc.art.allCardsIllustrationIds)})`],
        ]),
        '',
      ].join('\n'),
  mdSection('Oracle', oracle, 'oracle_id'),
  mdSection('Art (illustration)', art, 'illustration_id'),
].join('\n');
writeText(p('docs/source-audit/tagger-profile.md'), md);
log('wrote docs/source-audit/tagger-profile.md');
