// Source audit (sources, Scryfall census, Tagger & Spellbook profiles) and mapping coverage.
import { esc, attr, fmtInt, fmtPct, fmtBytes } from '../lib/html.mjs';
import { hbarChart, columnChart, segmentedBar, meter, kpis } from '../lib/charts.mjs';
import { section, objectTable, cellHTML, dispositionChip, DISPOSITIONS, link, emptyState } from './common.mjs';

// ---------- mappings ----------

/** Normalise mapping files into entries with a source key. */
export function normaliseMappings(files, prefixes) {
  const entries = [];
  for (const f of files) {
    const src = (/^([a-z]+)/i.exec(f.name)?.[1] || 'unknown').toLowerCase();
    const list = Array.isArray(f.data) ? f.data : Array.isArray(f.data?.fields) ? f.data.fields : [];
    for (const e of list) {
      if (!e || typeof e.path !== 'string') continue;
      const m = /^(scryfall|tagger|spellbook):(.*)$/.exec(e.path);
      entries.push({
        file: f.rel,
        source: m ? m[1] : src,
        path: m ? m[2] : e.path,
        scope: e.scope ?? null,
        disposition: String(e.disposition || 'unspecified').toLowerCase(),
        terms: (Array.isArray(e.terms) ? e.terms : e.terms ? [e.terms] : []).map((t) => prefixes.expand(String(t))),
        note: e.note || '',
        present: e.present ?? null,
        check: e.fixtureCheck ?? null,
      });
    }
  }
  return entries;
}

function globToRe(p) {
  const s = p.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\[\]/g, '\\[\\]').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^.]+').replace(/\u0000/g, '.*');
  return new RegExp(`^${s}$`);
}

/** Resolve the disposition of an observed path against mapping entries (exact > glob > ancestor). */
export function matchPath(path, entries) {
  const exact = entries.find((e) => e.path === path);
  if (exact) return { entry: exact, how: 'exact' };
  const globs = entries.filter((e) => e.path.includes('*') && globToRe(e.path).test(path));
  if (globs.length) return { entry: globs.sort((a, b) => b.path.length - a.path.length)[0], how: 'pattern' };
  const anc = entries.filter((e) => !e.path.includes('*') && (path.startsWith(e.path + '.') || path.startsWith(e.path + '[]')));
  if (anc.length) return { entry: anc.sort((a, b) => b.path.length - a.path.length)[0], how: 'parent' };
  return null;
}

function observedFields(inputs, source) {
  if (source === 'scryfall') return inputs.census?.fields || [];
  if (source === 'spellbook') return inputs.spellbook?.fields || [];
  if (source === 'tagger') {
    const t = inputs.tagger || {};
    return [...(t.fields || []), ...(t.oracle?.fields || []), ...(t.art?.fields || [])];
  }
  return [];
}
function recordsOf(inputs, source) {
  if (source === 'scryfall') return Number(inputs.census?.records) || null;
  if (source === 'spellbook') return Number(inputs.spellbook?.variants ?? inputs.spellbook?.records) || null;
  return null;
}

export function coverageData(inputs, entries) {
  const sources = new Set(entries.map((e) => e.source));
  if (inputs.census) sources.add('scryfall');
  const out = [];
  for (const source of [...sources].sort((a, b) => (a === 'scryfall' ? -1 : b === 'scryfall' ? 1 : a.localeCompare(b)))) {
    const ents = entries.filter((e) => e.source === source);
    // sources without a census/profile field list: the mapping file itself lists every source field
    let fields = observedFields(inputs, source);
    const fromMapping = !fields.length && ents.length > 0;
    if (fromMapping) fields = ents.map((e) => ({ path: e.path, present: e.present }));
    const rows = fields.map((f) => {
      const hit = matchPath(f.path, ents);
      return { field: f, entry: hit?.entry || null, how: hit?.how || null, disposition: hit ? hit.entry.disposition : 'unmapped' };
    });
    const observed = new Set(fields.map((f) => f.path));
    const unobserved = ents.filter((e) => !e.path.includes('*') && !observed.has(e.path) && !fields.some((f) => f.path.startsWith(e.path + '.') || f.path.startsWith(e.path + '[]')));
    out.push({ source, fields, entries: ents, rows, unobserved, records: recordsOf(inputs, source), fromMapping });
  }
  return out;
}

// ---------- field tables ----------

function shortVal(v) {
  if (v === null) return 'null';
  if (typeof v === 'string') return v.length > 40 ? JSON.stringify(v.slice(0, 39) + '…') : JSON.stringify(v);
  const s = JSON.stringify(v);
  return s.length > 40 ? s.slice(0, 39) + '…' : s;
}

function presence(f, records) {
  const p = Number(f.present);
  if (!Number.isFinite(p)) return null;
  if (p <= 1 && !Number.isInteger(p)) return p;
  return records ? Math.min(1, p / records) : null;
}

export function fieldTable(fields, { records, coverage = null, id = 'fields', m = null } = {}) {
  if (!fields?.length) return '<p class="muted">No field statistics.</p>';
  const dispOf = new Map((coverage?.rows || []).map((r) => [r.field.path, r]));
  const rows = fields
    .map((f) => {
      const pr = presence(f, records);
      const types = Object.entries(f.types || {})
        .sort((a, b) => b[1] - a[1])
        .map(([t, n]) => `<span class="chip t">${esc(t)} <span class="muted">${fmtInt(n)}</span></span>`)
        .join(' ');
      const top = (f.topValues || [])
        .slice(0, 4)
        .map((tv) => (Array.isArray(tv) ? `<code>${esc(shortVal(tv[0]))}</code> <span class="muted">${fmtInt(tv[1])}</span>` : `<code>${esc(shortVal(tv))}</code>`))
        .join('<br>');
      const d = dispOf.get(f.path);
      return `<tr${d && d.disposition === 'unmapped' ? ' class="flag"' : ''}><td><code class="path">${esc(f.path)}</code></td><td class="num nowrap">${
        pr != null ? `${meter(pr)} ${fmtPct(pr)}` : fmtInt(f.present)
      }</td><td class="num">${f.nulls ? fmtInt(f.nulls) : '<span class="muted">0</span>'}</td><td>${types}</td><td class="num">${f.distinct != null ? fmtInt(f.distinct) : '–'}</td><td class="small">${top}</td>${
        coverage ? `<td>${d ? dispositionChip(d.disposition) + (d.how && d.how !== 'exact' ? ` <span class="muted small">via ${esc(d.how)}</span>` : '') : ''}</td>` : ''
      }</tr>`;
    })
    .join('');
  void m;
  return `<div class="filter-row"><label class="filter"><span class="sr-only">Filter fields</span><input type="search" placeholder="Filter ${fmtInt(fields.length)} field paths…" data-filter-table="${attr(
    id,
  )}"></label><span class="muted small" data-filter-count="${attr(id)}"></span></div>
<div class="table-wrap"><table class="data fields" id="${attr(id)}"><thead><tr><th>Path</th><th>Present</th><th>Nulls</th><th>Types</th><th>Distinct</th><th>Top values</th>${
    coverage ? '<th>Mapping</th>' : ''
  }</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---------- generic profile renderer (Tagger profile shape is not fixed) ----------

const human = (k) =>
  String(k)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

function isNumMap(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length >= 2 && Object.values(v).every((x) => typeof x === 'number');
}
function isSnapshot(v) {
  return v && typeof v === 'object' && !Array.isArray(v) && ('sha256' in v || 'retrievedAt' in v) && ('url' in v || 'file' in v || 'key' in v);
}
export function snapshotLine(snap, source) {
  if (!snap) return source ? `<code>${esc(source)}</code>` : '';
  if (typeof snap !== 'object') return `${source ? `<code>${esc(source)}</code> · ` : ''}snapshot ${esc(snap)}`;
  const bits = [
    snap.key ? `<code>${esc(snap.key)}</code>` : source ? `<code>${esc(source)}</code>` : '',
    snap.sourceUpdatedAt ? `source updated ${esc(String(snap.sourceUpdatedAt).replace('T', ' ').slice(0, 16))}` : '',
    snap.retrievedAt ? `retrieved ${esc(String(snap.retrievedAt).replace('T', ' ').slice(0, 16))}` : '',
    snap.bytes ? fmtBytes(snap.bytes) : '',
    snap.sha256 ? `sha256 <code title="${attr(snap.sha256)}">${esc(String(snap.sha256).slice(0, 10))}…</code>${snap.sha256Verified ? ' ✓' : ''}` : '',
  ].filter(Boolean);
  return bits.join(' · ');
}
function isPairs(v) {
  return Array.isArray(v) && v.length >= 2 && v.every((x) => Array.isArray(x) && x.length >= 2 && typeof x[1] === 'number');
}

export function profileBlock(obj, { m, depth = 0, idPrefix = 'p', records = null } = {}) {
  if (!obj || typeof obj !== 'object') return '<p class="muted">No data.</p>';
  const scal = [];
  const charts = [];
  const rest = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
      if (typeof v === 'boolean') scal.push({ label: human(k), value: v ? '<span class="yes">yes</span>' : '<span class="no">no</span>' });
      else if (typeof v === 'string' && v.length > 60) rest.push([k, v]);
      else scal.push({ label: human(k), value: v === null ? '–' : typeof v === 'number' ? v : esc(v) });
    } else if (isSnapshot(v)) {
      rest.push([k, `<p class="muted small">${snapshotLine(v)}</p>`, true]);
    } else if (isNumMap(v)) {
      const keys = Object.keys(v);
      const numericKeys = keys.every((x) => /^-?\d+(\.\d+)?$/.test(x));
      if (numericKeys) {
        charts.push(
          columnChart(
            keys.sort((a, b) => Number(a) - Number(b)).map((x) => ({ label: x, value: v[x] })),
            { title: human(k), xLabel: /depth/i.test(k) ? 'depth' : human(k).toLowerCase() },
          ),
        );
      } else charts.push(hbarChart(keys.map((x) => ({ label: x, value: v[x] })), { title: human(k) }));
    } else if (isPairs(v)) {
      charts.push(hbarChart(v.map((x) => ({ label: typeof x[0] === 'string' ? x[0] : JSON.stringify(x[0]), value: x[1] })), { title: human(k), maxRows: 25, showPct: false }));
    } else if (k === 'fields' && Array.isArray(v) && v.every((x) => x && typeof x.path === 'string')) {
      rest.push([k, fieldTable(v, { records, id: `${idPrefix}-fields`, m }), true]);
    } else rest.push([k, v]);
  }
  let h = scal.length ? kpis(scal) : '';
  if (charts.length) h += `<div class="chart-grid">${charts.join('')}</div>`;
  for (const [k, v, isHtml] of rest) {
    if (isHtml) {
      h += `<h4>${esc(human(k))}</h4>${v}`;
    } else if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) {
      h += `<h4>${esc(human(k))}</h4>${profileBlock(v, { m, depth: depth + 1, idPrefix: `${idPrefix}-${k}`, records })}`;
    } else {
      h += `<details class="more"><summary>${esc(human(k))}${Array.isArray(v) ? ` (${v.length})` : ''}</summary>${Array.isArray(v) ? objectTable(m, v) : cellHTML(m, v)}</details>`;
    }
  }
  return h;
}

// ---------- pages ----------

export function auditPage(ctx) {
  const { inputs, m } = ctx;
  let h = `<header class="page-head"><h1>Source audit</h1><p class="lede">What the raw sources actually contain — measured from the downloaded snapshots, not from documentation. Generated by <code>npm run audit:census</code>.</p></header>`;
  const any = inputs.sources || inputs.census || inputs.oracleCensus || inputs.tagger || inputs.spellbook;
  if (!any) return section('audit', 'Source audit', h + emptyState('No audit outputs yet (<code>docs/source-audit/*.json</code>). Run <code>npm run audit:fetch && npm run audit:census</code>.'));

  h += '<nav class="toc"><span class="lbl">On this page</span> ';
  h += [inputs.sources && ['sources', 'Snapshots'], inputs.census && ['census', 'All-cards census'], inputs.oracleCensus && ['oracle-census', 'Oracle-cards census'], inputs.tagger && ['tagger', 'Tagger profile'], inputs.spellbook && ['spellbook', 'Commander Spellbook']]
    .filter(Boolean)
    .map(([a, l]) => `<a href="#/audit/${a}">${esc(l)}</a>`)
    .join(' · ');
  h += '</nav>';

  if (inputs.sources) {
    const files = inputs.sources.files || [];
    h += `<section class="block"><h2 data-anchor="sources">Snapshots</h2><div class="table-wrap"><table class="data"><thead><tr><th>Key</th><th>URL</th><th>Size</th><th>SHA-256</th><th>Retrieved</th><th>Source updated</th></tr></thead><tbody>${files
      .map(
        (f) =>
          `<tr><td><code>${esc(f.key)}</code></td><td class="url">${f.url ? `<a href="${attr(f.url)}" class="ext" rel="noopener" target="_blank">${esc(f.url.replace(/^https?:\/\//, ''))}</a>` : ''}</td><td class="num nowrap">${fmtBytes(
            f.bytes,
          )}</td><td>${f.sha256 ? `<code title="${attr(f.sha256)}">${esc(String(f.sha256).slice(0, 12))}…</code> <button type="button" class="btn-icon" data-copy="${attr(f.sha256)}" aria-label="Copy SHA-256" title="Copy SHA-256">⧉</button>` : ''}</td><td class="nowrap">${esc(
            (f.retrievedAt || '').replace('T', ' ').slice(0, 16),
          )}</td><td class="nowrap">${esc((f.sourceUpdatedAt || '').replace('T', ' ').slice(0, 16)) || '<span class="muted">–</span>'}</td></tr>`,
      )
      .join('')}</tbody></table></div></section>`;
  }

  for (const [key, c, title] of [
    ['census', inputs.census, 'Scryfall census — all card objects'],
    ['oracle-census', inputs.oracleCensus, 'Scryfall census — Oracle cards'],
  ]) {
    if (!c) continue;
    const layouts = Object.entries(c.layouts || {}).map(([label, value]) => ({ label, value }));
    const langs = Object.entries(c.langs || {}).map(([label, value]) => ({ label, value }));
    const cov = key === 'census' ? ctx.coverage.find((x) => x.source === 'scryfall') : null;
    const records = Number(c.records) || null;
    h += `<section class="block"><h2 data-anchor="${key}">${esc(title)}</h2>
<p class="muted">${c.description ? esc(c.description) + ' ' : ''}${snapshotLine(c.snapshot, c.source)}</p>
${kpis([
  { label: 'Records', value: records || 0 },
  { label: 'Field paths', value: (c.fields || []).length },
  layouts.length ? { label: 'Layouts', value: layouts.length } : null,
  langs.length ? { label: 'Languages', value: langs.length } : null,
  cov ? { label: 'Unmapped paths', value: cov.rows.filter((r) => r.disposition === 'unmapped').length, note: '<a href="#/coverage">mapping coverage →</a>' } : null,
])}
<div class="chart-grid">${layouts.length ? hbarChart(layouts, { title: 'Records by layout', labelHeader: 'Layout', total: records || undefined }) : ''}${
      langs.length ? hbarChart(langs, { title: 'Records by language', labelHeader: 'Language', total: records || undefined, maxRows: 20 }) : ''
    }</div>
<h3>Fields</h3>
${fieldTable(c.fields || [], { records, coverage: cov, id: `${key}-fields`, m })}`;
    const skip = new Set(['source', 'description', 'generatedAt', 'snapshot', 'records', 'layouts', 'langs', 'fields', 'jsonFile']);
    const extra = Object.entries(c).filter(([k]) => !skip.has(k));
    if (extra.length) {
      h += `<h3>Structure checks</h3>`;
      for (const [k, v] of extra) {
        h += `<details class="more"><summary>${esc(human(k))}</summary>${
          v && typeof v === 'object' && !Array.isArray(v) ? profileBlock(v, { m, idPrefix: `${key}-${k}`, records, depth: 1 }) : cellHTML(m, v)
        }</details>`;
      }
    }
    h += '</section>';
  }

  if (inputs.tagger) {
    h += `<section class="block"><h2 data-anchor="tagger">Tagger profile</h2><p class="muted">Community tags via Scryfall Tagger. Oracle tags and art tags are profiled separately and are never merged.</p>`;
    const t = inputs.tagger;
    const parts = Object.entries(t).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v));
    const top = Object.fromEntries(Object.entries(t).filter(([, v]) => !(v && typeof v === 'object' && !Array.isArray(v))));
    if (Object.keys(top).length) h += profileBlock(top, { m, idPrefix: 'tg' });
    for (const [k, v] of parts) h += `<h3>${esc(human(k))} tags</h3>${profileBlock(v, { m, idPrefix: `tg-${k}` })}`;
    h += '</section>';
  }

  if (inputs.spellbook) {
    const s = inputs.spellbook;
    h += `<section class="block"><h2 data-anchor="spellbook">Commander Spellbook</h2>${profileBlock(s, { m, idPrefix: 'sb', records: Number(s.variants) || null })}</section>`;
  }
  return section('audit', 'Source audit', h);
}

export function coveragePage(ctx) {
  const { m } = ctx;
  let h = `<header class="page-head"><h1>Mapping coverage</h1><p class="lede">Every observed source field path must have a disposition — <em>mapped</em>, <em>derived</em>, <em>raw</em>, <em>deferred</em> or <em>excluded</em>. Anything else is flagged as <strong>unmapped</strong>: no silent loss.</p></header>`;
  if (!ctx.coverage.length) {
    return section('coverage', 'Mapping coverage', h + emptyState('No mapping files (<code>mappings/*.fields.json</code>) and no census yet.'));
  }
  for (const cov of ctx.coverage) {
    const counts = {};
    for (const r of cov.rows) counts[r.disposition] = (counts[r.disposition] || 0) + 1;
    const order = ['mapped', 'raw', 'derived', 'deferred', 'excluded', 'unmapped'];
    const otherKeys = Object.keys(counts).filter((k) => !order.includes(k));
    const parts = [...order, ...otherKeys].map((k) => ({
      label: k,
      value: counts[k] || 0,
      color: DISPOSITIONS[k]?.color || '#d8cfbf',
      icon: k === 'unmapped' ? '✕' : null,
      textDark: k === 'excluded' || !DISPOSITIONS[k],
    }));
    const total = cov.rows.length;
    const unmapped = cov.rows.filter((r) => r.disposition === 'unmapped');
    h += `<section class="block"><h2 data-anchor="${attr(cov.source)}">${esc(human(cov.source))}</h2>`;
    if (!cov.fields.length) {
      h += `<p class="muted">${cov.entries.length} mapping entries, but no observed field list for this source (census/profile missing), so coverage cannot be computed.</p>`;
    } else {
      h += kpis([
        { label: 'Observed paths', value: total },
        ...order.filter((k) => counts[k]).map((k) => ({ label: k, value: `${fmtInt(counts[k])}<span class="kpi-unit"> · ${fmtPct(counts[k] / total)}</span>` })),
      ]);
      h += segmentedBar(parts, { title: `${human(cov.source)} field paths by disposition` });
      if (cov.fromMapping) h += '<p class="muted small">Field list taken from the mapping file, which lists every field of this source.</p>';
      const notEmitted = cov.entries.filter((e) => e.check === 'NOT EMITTED');
      const checked = cov.entries.filter((e) => e.check);
      if (checked.length)
        h += `<p class="small">${notEmitted.length ? `<span class="badge bad"><span aria-hidden="true">✕</span> ${notEmitted.length} claimed but not emitted</span>` : '<span class="badge ok"><span aria-hidden="true">✓</span> fixture check</span>'} Of the ${checked.length} <em>mapped</em> paths, ${checked.filter((e) => e.check === 'emitted').length} are emitted by the prototype mapper for the fixtures, ${checked.filter((e) => e.check === 'not in fixtures').length} do not occur (non-empty) in the fixtures. The check is per term, not per field.</p>`;
      h += `<h3>${unmapped.length ? '<span class="badge bad"><span aria-hidden="true">✕</span> ' + unmapped.length + ' unmapped</span> ' : ''}Unmapped paths</h3>`;
      h += unmapped.length
        ? `<div class="table-wrap"><table class="data flag-table"><thead><tr><th>Path</th><th>Present</th><th>Types</th><th>Top values</th></tr></thead><tbody>${unmapped
            .map((r) => {
              const pr = presence(r.field, cov.records);
              return `<tr class="flag"><td><code class="path">${esc(r.field.path)}</code></td><td class="num nowrap">${pr != null ? `${meter(pr)} ${fmtPct(pr)}` : fmtInt(r.field.present)}</td><td>${Object.keys(r.field.types || {})
                .map(esc)
                .join(', ')}</td><td class="small">${(r.field.topValues || [])
                .slice(0, 3)
                .map((tv) => `<code>${esc(shortVal(Array.isArray(tv) ? tv[0] : tv))}</code>`)
                .join(' ')}</td></tr>`;
            })
            .join('')}</tbody></table></div>`
        : '<p><span class="badge ok"><span aria-hidden="true">✓</span> none</span> Every observed path has a disposition.</p>';
    }
    // mapping entries
    h += `<h3>Mapping entries <span class="h-note">${cov.entries.length}</span></h3>`;
    if (cov.entries.length) {
      const tid = `map-${cov.source}`;
      h += `<div class="filter-row"><label class="filter"><span class="sr-only">Filter mapping entries</span><input type="search" placeholder="Filter entries…" data-filter-table="${tid}"></label><span class="muted small" data-filter-count="${tid}"></span></div><div class="table-wrap"><table class="data" id="${tid}"><thead><tr><th>Path</th><th>Scope</th><th>Disposition</th><th>Fixture check</th><th>Terms</th><th>Note</th></tr></thead><tbody>${cov.entries
        .map(
          (e) =>
            `<tr${cov.unobserved.includes(e) ? ' class="dim"' : ''}><td><code class="path">${esc(e.path)}</code>${
              cov.unobserved.includes(e) && cov.fields.length ? ' <span class="chip" title="This path does not occur in the census snapshot">not observed</span>' : ''
            }</td><td>${esc(e.scope ?? '')}</td><td>${dispositionChip(e.disposition)}</td><td>${e.check ? `<span class="chip${e.check === 'emitted' ? ' chk-ok' : e.check === 'NOT EMITTED' ? ' chk-bad' : ''}">${esc(e.check)}</span>` : ''}</td><td>${e.terms.map((t) => link(m, t)).join(', ')}</td><td>${esc(e.note)}</td></tr>`,
        )
        .join('')}</tbody></table></div><p class="muted small">From ${[...new Set(cov.entries.map((e) => e.file))].map((f) => `<code>${esc(f)}</code>`).join(', ')}.</p>`;
    } else h += '<p class="muted">No mapping file for this source yet.</p>';
    h += '</section>';
  }
  return section('coverage', 'Mapping coverage', h);
}
