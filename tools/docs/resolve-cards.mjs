#!/usr/bin/env node
// Resolve card references written in the documentation sources to Scryfall cards and images.
//
// Syntax (the convention of the Scryfall / MTGCardFetcher bots on Reddit and Discord):
//   [[Card Name]]                     the card (Oracle): link + image preview on hover
//   [[Card Name|SET]]                 a printing in that set (lowest collector number)
//   [[Card Name|SET|123]]             a specific printing (set + collector number)
//   [[Card Name|SET|123|it]]          … in a given language (default en)
//   [[!…]]                            any of the above, shown as the card image itself
//
// Resolution is deterministic, from the local snapshots (oracle_cards for names, all_cards for
// printings), and written to docs/card-refs.json, which is committed so the docs build needs no
// data or network. Images are NOT downloaded: the docs load them from Scryfall's image servers.
// Usage: node tools/docs/resolve-cards.mjs     (npm run cards:resolve)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import { p, ROOT, rawFile, rawManifest, writeJSON, log } from '../lib/common.mjs';
import { CARD_REF_RE, parseCardRef } from './lib/cardrefs.mjs';

const OUT = p('docs', 'card-refs.json');

// 1. collect references from the documentation sources
const SOURCES = ['ontology', 'docs', 'queries', 'proposals', 'CONTRIBUTING.md', 'DISCLAIMER.md', 'tools/vocab/curated.mjs'];
const walk = (abs) => {
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [abs];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(abs, d.name)) : /\.(ttl|md|rq|mjs)$/.test(d.name) ? [path.join(abs, d.name)] : []));
};
const refs = new Map(); // key -> {ref, files:Set}
for (const file of SOURCES.flatMap((s) => walk(p(s)))) {
  if (file === OUT) continue;
  let text = fs.readFileSync(file, 'utf8');
  // in Markdown, references inside code stay literal (the renderer does the same)
  if (file.endsWith('.md')) text = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of text.matchAll(CARD_REF_RE)) {
    const ref = parseCardRef(m[1]);
    if (!ref) continue;
    const e = refs.get(ref.key) ?? { ref, files: new Set() };
    e.files.add(path.relative(ROOT, file));
    refs.set(ref.key, e);
  }
}
log(`found ${refs.size} distinct card references`);

let oracleFile, allFile;
try {
  oracleFile = rawFile('scryfall:oracle_cards');
  allFile = rawFile('scryfall:all_cards');
} catch {
  log('no local Scryfall snapshots (run npm run audit:fetch) — keeping the committed docs/card-refs.json');
  process.exit(0);
}

const lines = async function* (file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const l of rl) if (l.trim()) yield JSON.parse(l);
};
const norm = (s) => String(s).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const namesOf = (c) => [c.name, ...(c.card_faces ?? []).map((f) => f.name), c.flavor_name, ...(c.card_faces ?? []).map((f) => f.flavor_name)].filter(Boolean).map(norm);
const NON_GAME = new Set(['token', 'double_faced_token', 'emblem', 'art_series']);

// 2. names → Oracle card (oracle_cards); prefer an exact full-name match, game cards before tokens
const wantNames = new Set([...refs.values()].map((e) => norm(e.ref.name)));
const byName = new Map();
for await (const c of lines(oracleFile)) {
  const full = norm(c.name);
  for (const n of namesOf(c)) {
    if (!wantNames.has(n)) continue;
    const rank = (n === full ? 0 : 2) + (NON_GAME.has(c.layout) ? 1 : 0);
    (byName.get(n) ?? byName.set(n, []).get(n)).push({ c, rank });
  }
}
// 3. printings (all_cards) for references with a set
const printRefs = [...refs.values()].filter((e) => e.ref.set);
const byPrint = new Map();
if (printRefs.length) {
  const wantSets = new Set(printRefs.map((e) => e.ref.set));
  for await (const c of lines(allFile)) {
    if (!wantSets.has(c.set)) continue;
    for (const e of printRefs) {
      const r = e.ref;
      if (c.set !== r.set || c.lang !== (r.lang || 'en') || (r.cn && c.collector_number !== r.cn) || !namesOf(c).includes(norm(r.name))) continue;
      (byPrint.get(r.key) ?? byPrint.set(r.key, []).get(r.key)).push(c);
    }
  }
}

const images = (c) =>
  (c.image_uris ? [{ face: c.name, ...c.image_uris }] : (c.card_faces ?? []).filter((f) => f.image_uris).map((f) => ({ face: f.name, ...f.image_uris }))).map((i) => ({
    face: i.face,
    normal: i.normal,
    small: i.small,
    large: i.large,
  }));
const summary = (c, extra = {}) => ({
  name: c.name,
  oracle_id: c.oracle_id ?? c.card_faces?.[0]?.oracle_id ?? null,
  printing_id: c.id,
  set: c.set,
  set_name: c.set_name,
  collector_number: c.collector_number,
  lang: c.lang,
  layout: c.layout,
  type_line: c.type_line ?? c.card_faces?.map((f) => f.type_line).join(' // '),
  artist: c.artist ?? null,
  scryfall_uri: c.scryfall_uri?.replace(/\?.*$/, ''),
  images: images(c),
  ...extra,
});

const out = {};
const unresolved = [];
for (const [key, { ref, files }] of [...refs].sort(([a], [b]) => a.localeCompare(b))) {
  let hit = null;
  let note;
  if (ref.set) {
    const cands = (byPrint.get(key) ?? []).sort((a, b) => a.collector_number.localeCompare(b.collector_number, 'en', { numeric: true }) || a.id.localeCompare(b.id));
    if (cands.length) hit = summary(cands[0], { kind: 'printing' });
    if (cands.length > 1) note = `${cands.length} printings match; lowest collector number used`;
  } else {
    const cands = (byName.get(norm(ref.name)) ?? []).sort((a, b) => a.rank - b.rank || String(a.c.oracle_id).localeCompare(String(b.c.oracle_id)));
    if (cands.length) hit = summary(cands[0].c, { kind: 'card' });
    const best = cands.filter((x) => x.rank === cands[0]?.rank);
    if (best.length > 1) note = `${best.length} Oracle cards share this name; first by Oracle ID used`;
  }
  if (!hit) unresolved.push({ ref: ref.raw, files: [...files] });
  out[key] = hit ? { ...hit, ref: ref.raw, ...(note ? { note } : {}), files: [...files].sort() } : { ref: ref.raw, unresolved: true, files: [...files].sort() };
}
const snap = (k) => rawManifest().files.filter((f) => f.key === k).at(-1);
writeJSON(OUT, {
  note: 'GENERATED by tools/docs/resolve-cards.mjs (npm run cards:resolve) from the local Scryfall snapshots. Images are loaded from Scryfall at view time, never stored.',
  snapshots: ['scryfall:oracle_cards', 'scryfall:all_cards'].map((k) => ({ key: k, file: path.basename(snap(k)?.localPath ?? ''), sha256: snap(k)?.sha256, sourceUpdatedAt: snap(k)?.sourceUpdatedAt })),
  refs: out,
  unresolved,
});
log(`resolved ${refs.size - unresolved.length}/${refs.size} references → docs/card-refs.json`);
for (const u of unresolved) log(`  UNRESOLVED ${u.ref}  (${u.files.join(', ')})`);
process.exitCode = unresolved.length ? 1 : 0;
