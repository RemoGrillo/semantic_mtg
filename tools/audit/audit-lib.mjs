// Shared helpers for the Phase 0 source audit (census, profiles, fixtures).
// Streaming only: JSONL via node:zlib + node:readline, big JSON via stream-json.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { Transform } from 'node:stream';
import { p, rawManifest, writeJSON, ensureDir, log } from '../lib/common.mjs';

export const AUDIT_DIR = p('docs', 'source-audit');

/** Latest manifest entry for a logical source key (same rule as rawFile()). */
export function manifestEntry(key) {
  const hits = rawManifest().files.filter((f) => f.key === key);
  if (!hits.length) throw new Error(`No raw file for "${key}" — run: npm run audit:fetch`);
  return hits[hits.length - 1];
}

/** Snapshot metadata block used in every generated audit file / fixture. */
export function snapshotOf(key, extra = {}) {
  const e = manifestEntry(key);
  return {
    key,
    file: path.basename(e.localPath),
    url: e.url,
    bytes: e.bytes,
    sha256: e.sha256,
    sourceUpdatedAt: e.sourceUpdatedAt ?? null,
    retrievedAt: e.retrievedAt,
    ...extra,
  };
}

/** Short source block for fixtures. */
export function sourceOf(key) {
  const e = manifestEntry(key);
  return { key, file: path.basename(e.localPath), sha256: e.sha256, sourceUpdatedAt: e.sourceUpdatedAt ?? null };
}

/** A pass-through stream that hashes the (compressed) bytes it sees. */
function hashTap(hash) {
  return new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });
}

/**
 * Iterate the records of a gzipped JSONL file. Yields parsed objects (or raw lines with
 * {raw:true}). After the loop, `state.sha256` holds the digest of the compressed file.
 */
export async function* readJSONL(file, { raw = false, state = {} } = {}) {
  const hash = crypto.createHash('sha256');
  const input = fs.createReadStream(file, { highWaterMark: 1 << 20 }).pipe(hashTap(hash));
  const text = file.endsWith('.gz') ? input.pipe(zlib.createGunzip({ chunkSize: 1 << 20 })) : input;
  const rl = readline.createInterface({ input: text, crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    n++;
    yield raw ? line : JSON.parse(line);
  }
  state.lines = n;
  state.sha256 = hash.digest('hex');
}

/**
 * Stream a gzipped JSON document with stream-json v3, emitting picked values.
 * `filter` is a stream-json path RegExp (paths joined with '.'), `onValue(value)` is
 * called for every picked value in document order. Resolves with {sha256}.
 */
export async function streamJSONGz(file, filter, onValue) {
  const { default: chain } = await import('stream-chain');
  const { parser } = await import('stream-json');
  const { pick } = await import('stream-json/filters/pick.js');
  const { streamValues } = await import('stream-json/streamers/stream-values.js');
  const hash = crypto.createHash('sha256');
  const pipeline = chain([
    fs.createReadStream(file, { highWaterMark: 1 << 20 }),
    hashTap(hash),
    zlib.createGunzip({ chunkSize: 1 << 20 }),
    parser(),
    pick({ filter }),
    streamValues(),
  ]);
  await new Promise((resolve, reject) => {
    pipeline.on('data', ({ value }) => {
      try {
        onValue(value);
      } catch (e) {
        pipeline.destroy(e);
        reject(e);
      }
    });
    pipeline.on('end', resolve);
    pipeline.on('error', reject);
  });
  return { sha256: hash.digest('hex') };
}

// ---------------------------------------------------------------------------------------
// Field census
// ---------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_RE = /^https?:\/\//;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const HEX = /^[0-9a-f]{32,}$/i;

export function jsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v; // string | number | boolean | object
}

export const trim = (s, n = 120) => (typeof s === 'string' && s.length > n ? s.slice(0, n - 1) + '…' : s);

function lenBucket(n) {
  return n >= 10 ? '10+' : String(n);
}

function inc(obj, k, by = 1) {
  obj[k] = (obj[k] ?? 0) + by;
}

export const sortCounts = (obj) => Object.fromEntries(Object.entries(obj).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));

class Node {
  constructor(path) {
    this.path = path;
    this.children = null; // Map key -> Node (object members)
    this.elem = null; // Node for array elements
    this.occ = 0;
    this.present = 0;
    this.lastRec = -1;
    this.nulls = 0;
    this.types = {};
    this.byGroup = {};
    this.byLang = {};
    this.distinct = new Map();
    this.capped = false;
    this.samples = [];
    this.k = { str: 0, uuid: 0, url: 0, date: 0, datetime: 0, hex: 0, nl: 0, len: 0, maxLen: 0, empty: 0, num: 0, int: 0, bool: 0, min: Infinity, max: -Infinity, sum: 0 };
    this.lengths = null;
  }
}

/**
 * Generic JSON field census. Paths: object members joined with '.', array elements as '[]'
 * (e.g. card_faces[].image_uris.normal). Object-valued maps keep their keys as paths
 * (legalities.commander). `present` counts top-level records containing the path at least
 * once; `occurrences` counts every value seen at the path (differs below arrays).
 */
export class FieldCensus {
  constructor({ groupName = 'byGroup', distinctCap = 5000, topN = 25, sampleN = 3, trackLang = false } = {}) {
    Object.assign(this, { groupName, distinctCap, topN, sampleN, trackLang });
    this.root = new Node('');
    this.records = 0;
    this.groups = {};
    this.langs = {};
    this.rec = -1;
    this.g = null;
    this.l = null;
  }

  observe(record, group = null, lang = null) {
    this.rec++;
    this.records++;
    this.g = group;
    this.l = lang;
    if (group != null) inc(this.groups, group);
    if (lang != null) inc(this.langs, lang);
    this.walkObject(record, this.root);
  }

  child(node, key) {
    if (!node.children) node.children = new Map();
    let c = node.children.get(key);
    if (!c) {
      c = new Node(node.path ? `${node.path}.${key}` : key);
      node.children.set(key, c);
    }
    return c;
  }

  walkObject(obj, node) {
    for (const key in obj) this.walk(obj[key], this.child(node, key));
  }

  walk(v, node) {
    node.occ++;
    if (node.lastRec !== this.rec) {
      node.lastRec = this.rec;
      node.present++;
      if (this.g != null) node.byGroup[this.g] = (node.byGroup[this.g] ?? 0) + 1;
      if (this.trackLang && this.l != null) node.byLang[this.l] = (node.byLang[this.l] ?? 0) + 1;
    }
    const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    node.types[t] = (node.types[t] ?? 0) + 1;
    if (t === 'null') {
      node.nulls++;
      return;
    }
    if (t === 'array') {
      if (!node.lengths) node.lengths = {};
      const b = lenBucket(v.length);
      node.lengths[b] = (node.lengths[b] ?? 0) + 1;
      if (v.length) {
        if (!node.elem) node.elem = new Node(`${node.path}[]`);
        for (const el of v) this.walk(el, node.elem);
      }
      return;
    }
    if (t === 'object') {
      this.walkObject(v, node);
      return;
    }
    // scalar
    const k = node.k;
    if (t === 'string') {
      k.str++;
      const L = v.length;
      k.len += L;
      if (L > k.maxLen) k.maxLen = L;
      if (L === 0) k.empty++;
      else if (L === 36 && UUID.test(v)) k.uuid++;
      else if (v.charCodeAt(0) === 104 && URL_RE.test(v)) k.url++;
      else if (L === 10 && DATE.test(v)) k.date++;
      else if (L >= 16 && L <= 40 && DATETIME.test(v)) k.datetime++;
      else if (L >= 32 && HEX.test(v)) k.hex++;
      if (v.indexOf('\n') !== -1) k.nl++;
    } else if (t === 'number') {
      k.num++;
      if (Number.isInteger(v)) k.int++;
      if (v < k.min) k.min = v;
      if (v > k.max) k.max = v;
      k.sum += v;
    } else if (t === 'boolean') k.bool++;
    const d = node.distinct;
    const c = d.get(v);
    if (c !== undefined) d.set(v, c + 1);
    else if (d.size < this.distinctCap) {
      d.set(v, 1);
      if (node.samples.length < this.sampleN) node.samples.push(trim(v));
    } else node.capped = true;
  }

  /** All nodes in path order. */
  nodes() {
    const out = [];
    const visit = (n) => {
      if (n.path) out.push(n);
      if (n.children) for (const c of n.children.values()) visit(c);
      if (n.elem) visit(n.elem);
    };
    visit(this.root);
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  node(path) {
    return this.nodes().find((n) => n.path === path) ?? null;
  }

  static kindOf(n) {
    const k = n.k;
    const scalarTypes = Object.keys(n.types).filter((t) => t !== 'null' && t !== 'array' && t !== 'object');
    if (!scalarTypes.length) {
      if (n.types.object) return 'object';
      if (n.types.array) return 'array';
      return 'null';
    }
    if (scalarTypes.length > 1 || n.types.object || n.types.array) return 'mixed';
    const t = scalarTypes[0];
    if (t === 'boolean') return 'boolean';
    if (t === 'number') return k.int === k.num ? 'integer' : 'number';
    const nonEmpty = k.str - k.empty;
    if (!nonEmpty) return 'string';
    if (k.uuid === nonEmpty) return 'uuid';
    if (k.url === nonEmpty) return 'url';
    if (k.date === nonEmpty) return 'date';
    if (k.datetime === nonEmpty) return 'datetime';
    if (k.hex === nonEmpty) return 'hash';
    if (k.nl > 0 || k.len / k.str > 60) return 'text';
    if (!n.capped && n.distinct.size <= 100 && k.str >= 2 * n.distinct.size) return 'enum';
    return 'string';
  }

  /** Serialise. `langFilter(node)` decides whether byLang is emitted for a path. */
  result({ langFilter = null } = {}) {
    const fields = [];
    for (const n of this.nodes()) {
      const kind = FieldCensus.kindOf(n);
      const f = {
        path: n.path,
        present: n.present,
        occurrences: n.occ,
        nulls: n.nulls,
        types: sortCounts(n.types),
        kind,
      };
      const scalar = n.k.str + n.k.num + n.k.bool;
      if (scalar) {
        f.distinct = n.distinct.size;
        if (n.capped) f.distinctCapped = true;
        const showTop = !['uuid', 'url', 'text', 'datetime', 'hash'].includes(kind) || (!n.capped && n.distinct.size <= 25);
        if (showTop) {
          f.topValues = [...n.distinct.entries()]
            .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
            .slice(0, this.topN)
            .map(([v, c]) => [trim(v, 80), c]);
          if (n.capped) f.topValuesApproximate = true;
        }
        f.samples = n.samples;
        if (n.k.num) f.numberStats = { min: n.k.min, max: n.k.max, mean: +(n.k.sum / n.k.num).toFixed(3) };
        if (n.k.str) {
          f.stringLength = { avg: +(n.k.len / n.k.str).toFixed(1), max: n.k.maxLen };
          if (n.k.empty) f.emptyStrings = n.k.empty;
          if (n.k.nl) f.withNewlines = n.k.nl;
        }
      }
      if (n.lengths) f.arrayLengths = Object.fromEntries(Object.entries(n.lengths).sort((a, b) => (a[0] === '10+' ? 1 : b[0] === '10+' ? -1 : a[0] - b[0])));
      f[this.groupName] = sortCounts(n.byGroup);
      if (this.trackLang && (!langFilter || langFilter(n, this))) f.byLang = sortCounts(n.byLang);
      fields.push(f);
    }
    return fields;
  }
}

/** Language-skew test: emit byLang only where presence differs between en and non-en. */
export function langSkewed(n, census) {
  const en = census.langs.en ?? 0;
  const other = census.records - en;
  if (!en || !other) return false;
  const pe = (n.byLang.en ?? 0) / en;
  const po = (n.present - (n.byLang.en ?? 0)) / other;
  return Math.abs(pe - po) > 0.05;
}

// ---------------------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------------------

export const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n));
export const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(a / b < 0.001 && a ? 3 : 1)}%` : '–');
export const mdEsc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, '⏎');

export function mdTable(headers, rows) {
  const out = [`| ${headers.join(' | ')} |`, `|${headers.map(() => '---').join('|')}|`];
  for (const r of rows) out.push(`| ${r.map((c) => mdEsc(c ?? '')).join(' | ')} |`);
  return out.join('\n');
}

export function countsTable(obj, total, label = 'value', limit = Infinity) {
  const rows = Object.entries(obj)
    .slice(0, limit)
    .map(([k, v]) => [`\`${k}\``, fmt(v), total ? pct(v, total) : '']);
  return mdTable([label, 'count', total ? 'share' : ''], rows);
}

export function fieldsTable(fields, records, { groupName = 'byLayout', topK = 6 } = {}) {
  const rows = fields.map((f) => [
    `\`${f.path}\``,
    fmt(f.present),
    pct(f.present, records),
    f.nulls ? fmt(f.nulls) : '',
    Object.entries(f.types)
      .map(([t, c]) => (Object.keys(f.types).length > 1 ? `${t}:${fmt(c)}` : t))
      .join(' '),
    f.kind,
    f.distinct != null ? `${fmt(f.distinct)}${f.distinctCapped ? '+' : ''}` : '',
    f.topValues
      ? f.topValues
          .slice(0, topK)
          .map(([v, c]) => `${JSON.stringify(trim(v, 30))}×${fmt(c)}`)
          .join(', ') + (f.topValues.length > topK ? ', …' : '')
      : f.samples?.length
        ? 'e.g. ' + f.samples.slice(0, 1).map((s) => JSON.stringify(trim(s, 50))).join(', ')
        : '',
  ]);
  return mdTable(['path', 'present', '%', 'nulls', 'types', 'kind', 'distinct', 'top values / sample'], rows);
}

export function writeText(file, text) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text.endsWith('\n') ? text : text + '\n');
}

export { writeJSON, log, p };

/** Collect Scryfall oracle ids (root + faces) and names from oracle_cards, quickly. */
export async function loadOracleIndex() {
  const file = p(manifestEntry('scryfall:oracle_cards').localPath);
  const names = new Map(); // oracle_id -> name (root oracle id)
  const faceIds = new Map(); // face oracle_id -> card name (reversible_card etc.)
  for await (const c of readJSONL(file)) {
    if (c.oracle_id) names.set(c.oracle_id, c.name);
    for (const f of c.card_faces ?? []) if (f.oracle_id && !names.has(f.oracle_id)) faceIds.set(f.oracle_id, f.name);
  }
  return { names, faceIds, has: (id) => names.has(id) || faceIds.has(id) };
}

/** Collect all oracle_id / illustration_id values (root + faces) from all_cards via regex. */
export async function scanAllCardsIds() {
  const file = p(manifestEntry('scryfall:all_cards').localPath);
  const oracle = new Set();
  const illustration = new Set();
  const re = /"(oracle_id|illustration_id)":"([0-9a-f-]{36})"/g;
  let records = 0;
  for await (const line of readJSONL(file, { raw: true })) {
    records++;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line))) (m[1] === 'oracle_id' ? oracle : illustration).add(m[2]);
  }
  return { records, oracle, illustration };
}
