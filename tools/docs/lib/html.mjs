// Small HTML toolkit: escaping, badges, official symbol pips, code highlighting.
import fs from 'node:fs';
import path from 'node:path';

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
export const attr = esc;

export function slugify(s, max = 80) {
  return (
    String(s ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max) || 'section'
  );
}

export function fmtInt(n) {
  return Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US') : esc(n);
}
export function fmtPct(x, digits = 1) {
  if (!Number.isFinite(x)) return '–';
  const v = x * 100;
  if (v > 0 && v < 0.1) return '<0.1%';
  return `${v.toFixed(v >= 99.95 || v === 0 ? 0 : digits)}%`;
}
export function fmtBytes(n) {
  if (!Number.isFinite(Number(n))) return '–';
  const u = ['B', 'KB', 'MB', 'GB'];
  let v = Number(n);
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

const STATUS_LABEL = {
  'stable-draft': 'stable draft',
  unstable: 'unstable',
  proposal: 'proposal',
  deprecated: 'deprecated',
};
export function statusBadge(status) {
  if (!status) return '<span class="badge st-none" title="no vs:term_status">no status</span>';
  const cls = STATUS_LABEL[status] ? `st-${status}` : 'st-other';
  return `<span class="badge ${cls}" title="vs:term_status">${esc(STATUS_LABEL[status] || status)}</span>`;
}
export function passBadge(pass) {
  if (pass === true) return '<span class="badge ok" title="passed"><span aria-hidden="true">✓</span> pass</span>';
  if (pass === false) return '<span class="badge bad" title="failed"><span aria-hidden="true">✕</span> fail</span>';
  return '<span class="badge st-none" title="not run">not run</span>';
}
export function kindBadge(kind) {
  const L = { class: 'class', object: 'object property', datatype: 'datatype property', annotation: 'annotation property', property: 'property', individual: 'individual', concept: 'concept', scheme: 'concept scheme' };
  return `<span class="kind k-${esc(kind)}">${esc(L[kind] || kind)}</span>`;
}

// ---------- official symbols (Scryfall SVG rasterised to PNG) ----------

export class Symbols {
  constructor(dir, warn = () => {}) {
    this.dir = dir;
    this.map = {};
    this.used = new Map(); // code -> css class
    this.missing = new Set();
    this.warn = warn;
    try {
      const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
      this.map = idx.symbols || {};
    } catch {
      warn('Mana symbols missing (assets/vendor/symbols/index.json) — run `npm run assets`; falling back to text codes', 'assets');
    }
  }
  has(code) {
    return !!this.map[code];
  }
  cssClass(code) {
    if (!this.used.has(code)) this.used.set(code, `ms${this.used.size}`);
    return this.used.get(code);
  }
  /** One symbol code like "{W}" → pip span (or text fallback). */
  pip(code) {
    const s = this.map[code];
    if (!s || !fs.existsSync(path.join(this.dir, 'png', s.png))) {
      if (!this.missing.has(code)) {
        this.missing.add(code);
        if (Object.keys(this.map).length) this.warn(`No official symbol image for ${code}; showing text`, 'assets');
      }
      return `<code class="sym-text">${esc(code)}</code>`;
    }
    const wide = s.width && s.height && s.width / s.height > 1.3 ? ' wide' : '';
    const title = s.english ? `${code} — ${s.english}` : code;
    return `<span class="pip ${this.cssClass(code)}${wide}" role="img" aria-label="${esc(code)}" title="${esc(title)}"></span>`;
  }
  /** "{W}{U}" → pips; returns '' for empty. */
  pips(str) {
    if (!str) return '';
    const codes = String(str).match(/\{[^{}]+\}/g);
    if (!codes) return `<code class="sym-text">${esc(str)}</code>`;
    return `<span class="pips">${codes.map((c) => this.pip(c)).join('')}</span>`;
  }
  /** Escape text and replace known symbol codes inline (e.g. definitions mentioning {T}). */
  inline(text) {
    const parts = String(text ?? '').split(/(\{[^{}\s]{1,12}\})/g);
    return parts.map((p, i) => (i % 2 === 1 && this.map[p] ? this.pip(p) : esc(p))).join('');
  }
  /** CSS rules (data: URIs) for the symbols actually used on the page. */
  css() {
    let out = '';
    for (const [code, cls] of this.used) {
      const s = this.map[code];
      const b64 = fs.readFileSync(path.join(this.dir, 'png', s.png)).toString('base64');
      out += `.${cls}{background-image:url(data:image/png;base64,${b64})}\n`;
    }
    return out;
  }
}

// ---------- syntax highlighting (build time, tiny tokenisers) ----------

const TTL_RE = new RegExp(
  [
    '(?<comment>#[^\\n]*)',
    '(?<lstring>"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\')',
    '(?<string>"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\')',
    '(?<iri><[^<>"\\s]*>)',
    '(?<kw>@prefix|@base|PREFIX|BASE|GRAPH|\\ba\\b|\\btrue\\b|\\bfalse\\b)',
    '(?<lang>@[a-zA-Z]+(?:-[a-zA-Z0-9]+)*)',
    '(?<dt>\\^\\^)',
    '(?<pname>(?:[A-Za-z][\\w.-]*)?:(?:[\\w%-]|\\\\.)(?:[\\w.%/-]|\\\\.)*(?<!\\.)|(?:[A-Za-z][\\w.-]*)?:(?=[\\s;,.)\\]]))',
    '(?<num>[+-]?(?:\\d+\\.\\d*|\\.\\d+|\\d+)(?:[eE][+-]?\\d+)?)',
    '(?<bnode>_:[\\w.-]+)',
  ].join('|'),
  'g',
);

export function highlightTurtle(src) {
  return highlightWith(TTL_RE, src);
}

const SPARQL_KW =
  'SELECT|CONSTRUCT|DESCRIBE|ASK|WHERE|FILTER|OPTIONAL|UNION|MINUS|GRAPH|SERVICE|BIND|VALUES|PREFIX|BASE|DISTINCT|REDUCED|ORDER|BY|GROUP|HAVING|LIMIT|OFFSET|AS|FROM|NAMED|NOT|EXISTS|IN|COUNT|SUM|MIN|MAX|AVG|SAMPLE|GROUP_CONCAT|STR|LANG|LANGMATCHES|DATATYPE|BOUND|IRI|URI|BNODE|REGEX|CONTAINS|STRSTARTS|STRENDS|LCASE|UCASE|COALESCE|IF|isIRI|isBlank|isLiteral|ASC|DESC|INSERT|DELETE|DATA|a|true|false';
const SPARQL_RE = new RegExp(
  [
    '(?<comment>#[^\\n]*)',
    '(?<lstring>"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\')',
    '(?<string>"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\')',
    '(?<iri><[^<>"\\s{}|^`\\\\]*>)',
    '(?<var>[?$][\\w]+)',
    `(?<kw>\\b(?:${SPARQL_KW})\\b)`,
    '(?<lang>@[a-zA-Z]+(?:-[a-zA-Z0-9]+)*)',
    '(?<dt>\\^\\^)',
    '(?<pname>(?:[A-Za-z][\\w.-]*)?:(?:[\\w%-])(?:[\\w.%/-])*(?<!\\.)|(?:[A-Za-z][\\w.-]*)?:(?=[\\s;,.)\\]]))',
    '(?<num>\\b\\d+(?:\\.\\d+)?\\b)',
  ].join('|'),
  'gi',
);
export function highlightSparql(src) {
  return highlightWith(SPARQL_RE, src);
}

function highlightWith(re, src) {
  let out = '';
  let last = 0;
  re.lastIndex = 0;
  for (const m of String(src).matchAll(re)) {
    if (m.index > last) out += esc(src.slice(last, m.index));
    const kind = Object.entries(m.groups).find(([, v]) => v !== undefined)?.[0] || 'x';
    const cls = { lstring: 'string' }[kind] || kind;
    out += `<span class="t-${cls}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  out += esc(String(src).slice(last));
  return out;
}

export function highlight(lang, code) {
  const l = String(lang || '').toLowerCase();
  if (['turtle', 'ttl', 'trig', 'n3'].includes(l)) return highlightTurtle(code);
  if (['sparql', 'rq'].includes(l)) return highlightSparql(code);
  return esc(code);
}

/** A <pre> block with copy button. */
export function codeBlock(code, { lang = '', label = '', download = '', maxHeight = false } = {}) {
  return `<div class="code${maxHeight ? ' code-tall' : ''}">
  <div class="code-bar"><span class="code-lang">${esc(label || lang)}</span><span class="code-actions">${
    download ? `<a class="btn-sm" href="${attr(download)}" download>Download</a>` : ''
  }<button type="button" class="btn-sm" data-copy-code>Copy</button></span></div>
  <pre><code class="lang-${esc(lang)}">${highlight(lang, code)}</code></pre></div>`;
}

/** Inline-safe JSON for <script type="application/json">. */
export function jsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
