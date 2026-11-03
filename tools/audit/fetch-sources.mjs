#!/usr/bin/env node
// Phase 0 — fetch immutable raw source snapshots (manifest-driven, checksummed).
// Never hard-codes dated URLs: reads Scryfall's /bulk-data manifest at run time.
// Usage: node tools/audit/fetch-sources.mjs [--only key1,key2] [--skip-big]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CONFIG, p, ensureDir, writeJSON, readJSON, sleep, log } from '../lib/common.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const skipBig = args.includes('--skip-big');
const HEADERS = { 'User-Agent': CONFIG.userAgent, Accept: 'application/json;q=0.9,*/*;q=0.8' };
const RAW = ensureDir(p('data', 'raw'));
const manifestPath = path.join(RAW, 'manifest.json');
const manifest = readJSON(manifestPath, { files: [] });
const want = (key) => !only || only.includes(key);

async function getJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function rawGet(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: HEADERS }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          resolve(rawGet(new URL(res.headers.location, url).href, redirects - 1));
        } else if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`${res.statusCode} for ${url}`));
        } else resolve(res);
      })
      .on('error', reject);
  });
}

async function download(key, url, destRel, extra = {}) {
  const dest = p(destRel);
  const existing = manifest.files.find((f) => f.localPath === destRel && fs.existsSync(dest));
  if (existing) {
    log(`skip (already have) ${destRel}`);
    return existing;
  }
  ensureDir(path.dirname(dest));
  log(`GET ${url}`);
  // node:https instead of fetch(): fetch transparently decodes Content-Encoding: gzip,
  // which would silently turn an upstream .gz file into a different (decoded) artefact.
  const res = await rawGet(url);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      bytes += chunk.length;
      cb(null, chunk);
    },
  });
  const tmp = dest + '.part';
  await pipeline(res, tap, fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  const entry = {
    key,
    url,
    localPath: destRel,
    bytes,
    sha256: hash.digest('hex'),
    retrievedAt: new Date().toISOString(),
    etag: res.headers['etag'] ?? null,
    lastModified: res.headers['last-modified'] ?? null,
    contentType: res.headers['content-type'] ?? null,
    contentEncoding: res.headers['content-encoding'] ?? null,
    ...extra,
  };
  manifest.files.push(entry);
  writeJSON(manifestPath, manifest);
  log(`saved ${destRel} (${(bytes / 1e6).toFixed(1)} MB) sha256=${entry.sha256.slice(0, 12)}…`);
  return entry;
}

async function saveApiJSON(key, url, destRel) {
  const data = await getJSON(url);
  const body = JSON.stringify(data, null, 1);
  writeJSON(p(destRel), data);
  manifest.files = manifest.files.filter((f) => f.localPath !== destRel);
  manifest.files.push({
    key,
    url,
    localPath: destRel,
    bytes: Buffer.byteLength(body),
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    retrievedAt: new Date().toISOString(),
  });
  writeJSON(manifestPath, manifest);
  await sleep(150); // Scryfall asks for 50–100 ms between requests; be gentler.
  return data;
}

const today = new Date().toISOString().slice(0, 10);

// 1. Scryfall bulk manifest + selected bulk files
const bulk = await saveApiJSON('scryfall:bulk-manifest', CONFIG.sources.scryfallBulkManifest, `data/raw/scryfall/bulk-data-${today}.json`);
for (const item of bulk.data) {
  if (!CONFIG.sources.scryfallBulkTypes.includes(item.type) || !want(item.type)) continue;
  if (skipBig && item.type === 'all_cards') continue;
  const uri = item.jsonl_download_uri ?? item.download_uri; // format changed in 2026: JSONL only
  if (!uri) throw new Error(`No download URI for ${item.type}: ${JSON.stringify(item)}`);
  await download(`scryfall:${item.type}`, uri, `data/raw/scryfall/${item.type}/${path.basename(new URL(uri).pathname)}`, {
    sourceUpdatedAt: item.updated_at,
    bulkId: item.id,
    compressedSizeDeclared: item.compressed_size,
    format: uri.endsWith('.jsonl.gz') ? 'jsonl.gz' : 'json',
  });
}

// 2. Scryfall reference endpoints (catalogs, symbology, sets)
if (want('scryfall:api')) {
  const CATALOGS = [
    'supertypes', 'card-types', 'artifact-types', 'battle-types', 'creature-types', 'enchantment-types',
    'land-types', 'planeswalker-types', 'spell-types', 'keyword-abilities', 'keyword-actions',
    'ability-words', 'flavor-words', 'watermarks', 'powers', 'toughnesses', 'loyalties',
  ];
  for (const c of CATALOGS) {
    await saveApiJSON(`scryfall:catalog:${c}`, `${CONFIG.sources.scryfallApi}/catalog/${c}`, `data/raw/scryfall/catalogs/${c}-${today}.json`);
  }
  await saveApiJSON('scryfall:symbology', `${CONFIG.sources.scryfallApi}/symbology`, `data/raw/scryfall/symbology-${today}.json`);
  await saveApiJSON('scryfall:sets', `${CONFIG.sources.scryfallApi}/sets`, `data/raw/scryfall/sets-${today}.json`);
  log('Scryfall catalogs, symbology and sets saved');
}

// 3. Wizards of the Coast Comprehensive Rules (plain text) — authority for keyword / ability-word lists.
//    The download link is read from the rules page at run time (it changes with every release).
if (want('wotc')) {
  const page = await (await fetch('https://magic.wizards.com/en/rules', { headers: { ...HEADERS, Accept: 'text/html' } })).text();
  const txt = page.match(/https:\/\/media\.wizards\.com\/[^"']*?\.txt/)?.[0];
  if (!txt) throw new Error('Comprehensive Rules .txt link not found on https://magic.wizards.com/en/rules');
  const url = encodeURI(decodeURI(txt));
  await download('wotc:comprehensive-rules', url, `data/raw/wotc/${path.basename(decodeURI(txt)).replace(/\s+/g, '-')}`, { format: 'txt' });
}

// 4. Commander Spellbook bulk variants (snapshot, not a delta feed)
if (want('spellbook')) {
  await download('spellbook:variants', CONFIG.sources.spellbookVariants, `data/raw/spellbook/variants-${today}.json.gz`, { format: 'json.gz' });
}

manifest.updatedAt = new Date().toISOString();
writeJSON(manifestPath, manifest);
log('done');
