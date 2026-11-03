// Shared helpers for SMTG tooling (no dependencies beyond node: builtins).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'smtg.config.json'), 'utf8'));

export const p = (...parts) => path.join(ROOT, ...parts);

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJSON(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}

export function writeJSON(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function log(...args) {
  console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...args);
}

/** Latest raw snapshot manifest written by tools/audit/fetch-sources.mjs */
export function rawManifest() {
  return readJSON(p('data', 'raw', 'manifest.json'), { files: [] });
}

/** Find the local path of the most recent raw file for a logical source key. */
export function rawFile(key) {
  const m = rawManifest();
  const hits = m.files.filter((f) => f.key === key);
  if (!hits.length) throw new Error(`No raw file for "${key}" — run: npm run audit:fetch`);
  return p(hits[hits.length - 1].localPath);
}
