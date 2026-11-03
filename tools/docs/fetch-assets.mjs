#!/usr/bin/env node
// Download the OFFICIAL Scryfall card-symbol SVGs and rasterize them, unmodified, to PNG.
//
//   npm run assets                 # download missing SVGs, (re)rasterize missing PNGs
//   npm run assets -- --force      # re-download and re-rasterize everything
//
// Input : newest data/raw/scryfall/symbology-*.json (written by `npm run audit:fetch`)
// Output: assets/vendor/symbols/svg/<name>.svg   (byte-for-byte as served by Scryfall)
//         assets/vendor/symbols/png/<name>.png   (rsvg-convert -w 96 -h 96, aspect ratio kept)
//         assets/vendor/symbols/index.json       ({ symbols: { "{W}": { svg, png, english, ... } } })
//
// assets/vendor/ is git-ignored: Wizards of the Coast assets are fetched, never committed.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CONFIG, p, ensureDir, writeJSON, sleep, log } from '../lib/common.mjs';

const args = process.argv.slice(2);
const force = args.includes('--force');
const DELAY_MS = 120;

const OUT = p('assets', 'vendor', 'symbols');
const SVG_DIR = ensureDir(path.join(OUT, 'svg'));
const PNG_DIR = ensureDir(path.join(OUT, 'png'));

function newestSymbology() {
  const dir = p('data', 'raw', 'scryfall');
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => /^symbology-.*\.json$/.test(f)).sort()
    : [];
  if (!files.length) {
    throw new Error('No data/raw/scryfall/symbology-*.json found — run: npm run audit:fetch');
  }
  return path.join(dir, files[files.length - 1]);
}

/** File stem from the official URL (e.g. .../card-symbols/2W.svg -> "2W"); safe for any FS. */
function stemFor(sym) {
  const base = decodeURIComponent(new URL(sym.svg_uri).pathname.split('/').pop() || '');
  const stem = base.replace(/\.svg$/i, '').replace(/[^A-Za-z0-9_-]/g, '_');
  if (!stem) throw new Error(`Cannot derive a file name for ${sym.symbol} (${sym.svg_uri})`);
  return stem;
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': CONFIG.userAgent, Accept: 'image/svg+xml,*/*;q=0.8' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!/<svg[\s>]/i.test(buf.subarray(0, 4096).toString('utf8'))) {
    throw new Error(`Response for ${url} does not look like an SVG`);
  }
  fs.writeFileSync(dest + '.part', buf);
  fs.renameSync(dest + '.part', dest);
  return buf.length;
}

function rasterize(svg, png) {
  // -a keeps the aspect ratio for the few non-square symbols (e.g. {1000000}); square
  // symbols come out at exactly 96x96. The SVG itself is never edited.
  const r = spawnSync('rsvg-convert', ['-w', '96', '-h', '96', '-a', '-f', 'png', '-o', png, svg], {
    encoding: 'utf8',
  });
  if (r.error) throw new Error(`rsvg-convert not available: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`rsvg-convert failed for ${svg}: ${r.stderr}`);
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  // PNG IHDR: width/height are big-endian uint32 at offsets 16 and 20.
  return b.length > 24 ? { width: b.readUInt32BE(16), height: b.readUInt32BE(20) } : {};
}

async function main() {
  const src = newestSymbology();
  const data = JSON.parse(fs.readFileSync(src, 'utf8'));
  const symbols = (data.data || []).filter((s) => s && s.symbol && s.svg_uri);
  log(`${symbols.length} symbols in ${path.relative(p(), src)}`);

  const index = {};
  let downloaded = 0;
  let rasterized = 0;
  const failures = [];
  for (const sym of symbols) {
    try {
      const stem = stemFor(sym);
      const svg = path.join(SVG_DIR, `${stem}.svg`);
      const png = path.join(PNG_DIR, `${stem}.png`);
      if (force || !fs.existsSync(svg)) {
        const bytes = await download(sym.svg_uri, svg);
        downloaded++;
        log(`GET ${sym.symbol.padEnd(9)} ${sym.svg_uri} (${bytes} B)`);
        await sleep(DELAY_MS);
      }
      if (force || !fs.existsSync(png) || fs.statSync(png).mtimeMs < fs.statSync(svg).mtimeMs) {
        rasterize(svg, png);
        rasterized++;
      }
      index[sym.symbol] = {
        svg: `${stem}.svg`,
        png: `${stem}.png`,
        ...pngSize(png),
        english: sym.english ?? null,
        represents_mana: !!sym.represents_mana,
        colors: sym.colors || [],
        svg_uri: sym.svg_uri,
      };
    } catch (e) {
      failures.push(`${sym.symbol}: ${e.message}`);
      console.warn(`WARN ${sym.symbol}: ${e.message}`);
    }
  }

  writeJSON(path.join(OUT, 'index.json'), {
    generatedAt: new Date().toISOString(),
    source: path.relative(p(), src),
    attribution:
      'Official card symbols served by Scryfall (https://scryfall.com); symbols are property of Wizards of the Coast LLC. Rasterized unmodified with rsvg-convert.',
    count: Object.keys(index).length,
    symbols: index,
  });
  log(`index.json: ${Object.keys(index).length} symbols (downloaded ${downloaded}, rasterized ${rasterized})`);
  if (failures.length) {
    console.error(`${failures.length} symbol(s) failed:\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
