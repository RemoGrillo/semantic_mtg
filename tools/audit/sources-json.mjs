#!/usr/bin/env node
// Writes docs/source-audit/sources.json from data/raw/manifest.json (file names only, no local paths).
// Called by census-scryfall.mjs; can also be run on its own: node tools/audit/sources-json.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { p, rawManifest, writeJSON } from '../lib/common.mjs';

export function writeSourcesJSON() {
  const m = rawManifest();
  const files = m.files.map((f) => ({
    key: f.key,
    url: f.url,
    localPath: path.basename(f.localPath),
    bytes: f.bytes,
    sha256: f.sha256,
    retrievedAt: f.retrievedAt,
    sourceUpdatedAt: f.sourceUpdatedAt ?? null,
    etag: f.etag ?? null,
    lastModified: f.lastModified ?? null,
    contentEncoding: f.contentEncoding ?? null,
  }));
  const out = { generatedAt: new Date().toISOString(), manifestUpdatedAt: m.updatedAt ?? null, files };
  writeJSON(p('docs', 'source-audit', 'sources.json'), out);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeSourcesJSON();
