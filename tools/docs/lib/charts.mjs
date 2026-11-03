// Hand-made inline SVG charts (no library). Thin marks, 4px rounded data ends, hairline axes,
// values at bar tips, a hover/focus tooltip via data-tip, and a table twin for every chart.
import { esc, attr, fmtInt, fmtPct } from './html.mjs';

// Categorical slots validated (dataviz validate_palette.js) against the beige surface #faf6ee.
export const SERIES = ['#2b5d9e', '#c4742a', '#1f8f74', '#8f4fa0'];
export const MUTED_FILL = '#b9ae9c';
export const CRITICAL = '#b8322c';
const INK2 = '#6e6559';
const GRID = 'rgba(39,34,28,.12)';

const charW = 6.6; // approx. px per character at 12px system-ui

/** Bar with 4px rounded data end and square baseline end (horizontal, growing right). */
function hbarPath(x, y, w, h, r = 4) {
  if (w <= 0) return '';
  const rr = Math.min(r, w, h / 2);
  return `M${x},${y}h${w - rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - 2 * rr}a${rr},${rr} 0 0 1 -${rr},${rr}h-${w - rr}z`;
}
/** Column with rounded top, square baseline. */
function colPath(x, y, w, h, r = 4) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}v-${h - rr}a${rr},${rr} 0 0 1 ${rr},-${rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - rr}z`;
}

function tableTwin(rows, headers, caption) {
  return `<details class="chart-table"><summary>Show as table</summary><div class="table-wrap"><table class="data compact"><caption class="sr-only">${esc(
    caption,
  )}</caption><thead><tr>${headers.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody></table></div></details>`;
}

/**
 * Ranked horizontal bars, one hue.
 * data: [{ label, value, note? }]; opts: { title, total, color, maxRows, valueLabel }
 */
export function hbarChart(data, opts = {}) {
  const rows = data.filter((d) => Number.isFinite(Number(d.value))).map((d) => ({ ...d, value: Number(d.value) }));
  if (!rows.length) return '<p class="muted">No data.</p>';
  if (opts.sort !== false) rows.sort((a, b) => b.value - a.value);
  const maxRows = opts.maxRows || 40;
  let shown = rows;
  if (rows.length > maxRows) {
    const rest = rows.slice(maxRows - 1);
    shown = [...rows.slice(0, maxRows - 1), { label: `Other (${rest.length})`, value: rest.reduce((s, r) => s + r.value, 0), other: true }];
  }
  const total = opts.total ?? rows.reduce((s, r) => s + r.value, 0);
  const max = Math.max(...shown.map((r) => r.value), 1);
  const W = 680;
  const labelW = Math.min(230, Math.max(...shown.map((r) => String(r.label).length)) * charW + 12);
  const valueW = 92;
  const plotW = W - labelW - valueW;
  const rowH = 24;
  const barH = 14;
  const top = 6;
  const H = top + shown.length * rowH + 4;
  const color = opts.color || SERIES[0];
  let g = '';
  shown.forEach((r, i) => {
    const y = top + i * rowH;
    const w = Math.max((r.value / max) * plotW, r.value > 0 ? 1.5 : 0);
    const pct = total ? r.value / total : null;
    const tip = `${r.label}: ${fmtInt(r.value)}${pct != null ? ` (${fmtPct(pct)})` : ''}`;
    g += `<g class="bar" tabindex="0" data-tip="${attr(tip)}" aria-label="${attr(tip)}">
<rect x="0" y="${y}" width="${W}" height="${rowH}" fill="transparent"/>
<text x="${labelW - 8}" y="${y + rowH / 2}" text-anchor="end" dominant-baseline="central" class="ax">${esc(r.label)}</text>
<path d="${hbarPath(labelW, y + (rowH - barH) / 2, w, barH)}" fill="${r.other ? MUTED_FILL : color}"/>
<text x="${labelW + w + 6}" y="${y + rowH / 2}" dominant-baseline="central" class="val">${fmtInt(r.value)}${
      pct != null && opts.showPct !== false ? `<tspan class="ax"> · ${fmtPct(pct)}</tspan>` : ''
    }</text></g>`;
  });
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${attr(opts.title || 'bar chart')}">
<line x1="${labelW}" x2="${labelW}" y1="${top - 2}" y2="${H - 2}" stroke="${GRID}"/>${g}</svg>`;
  return `<figure class="chart-fig">${opts.title ? `<figcaption class="chart-title">${esc(opts.title)}</figcaption>` : ''}<div class="chart-scroll">${svg}</div>${tableTwin(
    rows.map((r) => [esc(r.label), fmtInt(r.value), total ? fmtPct(r.value / total) : '']),
    [opts.labelHeader || 'Category', opts.valueLabel || 'Count', 'Share'],
    opts.title || 'chart',
  )}</figure>`;
}

/** Ordinal columns (e.g. depth histogram), one hue, value on the cap. */
export function columnChart(data, opts = {}) {
  const rows = data.filter((d) => Number.isFinite(Number(d.value))).map((d) => ({ ...d, value: Number(d.value) }));
  if (!rows.length) return '<p class="muted">No data.</p>';
  const max = Math.max(...rows.map((r) => r.value), 1);
  const colW = Math.max(14, Math.min(24, 520 / rows.length - 10));
  const gap = Math.max(10, Math.min(28, 520 / rows.length - colW));
  const left = 8;
  const plotH = 140;
  const top = 18;
  const W = Math.max(240, left * 2 + rows.length * (colW + gap));
  const H = top + plotH + 26;
  const color = opts.color || SERIES[0];
  let g = '';
  rows.forEach((r, i) => {
    const x = left + i * (colW + gap) + gap / 2;
    const h = Math.max((r.value / max) * plotH, r.value > 0 ? 1.5 : 0);
    const y = top + plotH - h;
    const tip = `${opts.xLabel ? opts.xLabel + ' ' : ''}${r.label}: ${fmtInt(r.value)}`;
    g += `<g class="bar" tabindex="0" data-tip="${attr(tip)}" aria-label="${attr(tip)}">
<rect x="${x - gap / 2}" y="${top}" width="${colW + gap}" height="${plotH + 22}" fill="transparent"/>
<path d="${colPath(x, y, colW, h)}" fill="${color}"/>
<text x="${x + colW / 2}" y="${y - 5}" text-anchor="middle" class="val sm">${fmtInt(r.value)}</text>
<text x="${x + colW / 2}" y="${top + plotH + 15}" text-anchor="middle" class="ax">${esc(r.label)}</text></g>`;
  });
  const svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${attr(opts.title || 'column chart')}">
<line x1="0" x2="${W}" y1="${top + plotH}" y2="${top + plotH}" stroke="${GRID}"/>${g}</svg>`;
  return `<figure class="chart-fig">${opts.title ? `<figcaption class="chart-title">${esc(opts.title)}</figcaption>` : ''}<div class="chart-scroll">${svg}</div>${tableTwin(
    rows.map((r) => [esc(r.label), fmtInt(r.value)]),
    [opts.xLabel || 'Bucket', opts.valueLabel || 'Count'],
    opts.title || 'chart',
  )}</figure>`;
}

/**
 * Tall segmented bar (one whole split into ≤ 6 parts) + legend (names only) + table twin.
 * parts: [{ label, value, color, icon? }]
 */
export function segmentedBar(parts, opts = {}) {
  const ps = parts.filter((p) => p.value > 0);
  const total = ps.reduce((s, p) => s + p.value, 0);
  if (!total) return '<p class="muted">No data.</p>';
  const W = 680;
  const H = 28;
  const gap = 2;
  let x = 0;
  let g = '';
  const usable = W - gap * (ps.length - 1);
  ps.forEach((p) => {
    const w = (p.value / total) * usable;
    const share = fmtPct(p.value / total);
    const tip = `${p.label}: ${fmtInt(p.value)} (${share})`;
    const fits = w > share.length * 7.2 + 12;
    const dark = p.textDark ?? false;
    g += `<g class="bar" tabindex="0" data-tip="${attr(tip)}" aria-label="${attr(tip)}"><rect x="${x.toFixed(2)}" y="0" width="${Math.max(w, 0.5).toFixed(
      2,
    )}" height="${H}" rx="4" fill="${p.color}"/>${
      fits ? `<text x="${(x + 7).toFixed(2)}" y="${H / 2}" dominant-baseline="central" class="seg-label${dark ? ' dark' : ''}">${share}</text>` : ''
    }</g>`;
    x += w + gap;
  });
  const legend = `<ul class="legend">${ps
    .map((p) => `<li><span class="swatch" style="background:${p.color}"></span>${p.icon ? `<span aria-hidden="true">${p.icon}</span> ` : ''}${esc(p.label)}</li>`)
    .join('')}</ul>`;
  return `<figure class="chart-fig">${opts.title ? `<figcaption class="chart-title">${esc(opts.title)}</figcaption>` : ''}<div class="chart-scroll"><svg class="chart seg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${attr(
    opts.title || 'segmented bar',
  )}">${g}</svg></div>${legend}${tableTwin(
    ps.map((p) => [esc(p.label), fmtInt(p.value), fmtPct(p.value / total)]),
    ['Part', 'Count', 'Share'],
    opts.title || 'segmented bar',
  )}</figure>`;
}

/** Thin inline meter for table cells (fraction 0..1), same-ramp track. */
export function meter(fraction, { color = SERIES[0] } = {}) {
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  return `<span class="meter" aria-hidden="true"><span style="width:${(f * 100).toFixed(1)}%;background:${color}"></span></span>`;
}

/** KPI tile row. items: [{ label, value, note? }] */
export function kpis(items) {
  return `<div class="kpis">${items
    .filter((i) => i && i.value !== undefined && i.value !== null)
    .map(
      (i) =>
        `<div class="kpi"><div class="kpi-label">${esc(i.label)}</div><div class="kpi-value">${typeof i.value === 'number' ? fmtInt(i.value) : i.value}</div>${
          i.note ? `<div class="kpi-note">${i.note}</div>` : ''
        }</div>`,
    )
    .join('')}</div>`;
}
