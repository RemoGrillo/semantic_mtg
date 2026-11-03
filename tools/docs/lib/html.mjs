// Small HTML toolkit: escaping, badges, mana symbols (mana-font), code highlighting.
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


// ---------- mana & card symbols (mana-font npm package) ----------
// Symbols are drawn with the open-source Mana font by Andrew Gioia (npm `mana-font`; font SIL OFL 1.1,
// CSS MIT; the symbol designs are © Wizards of the Coast). Codes the font lacks fall back to a text chip.

const CHIP_COLOUR = { W: 'w', U: 'u', B: 'b', R: 'r', G: 'g', C: 'c' };
export function textChip(code) {
  const inner = String(code).replace(/^\{|\}$/g, '');
  const cls = CHIP_COLOUR[inner] ? ` sym-${CHIP_COLOUR[inner]}` : '';
  return `<span class="sym-chip${cls}" title="${esc(code)}">${esc(inner)}</span>`;
}

// Scryfall code (inside braces) → mana-font class, for codes whose name is not simply the lower-cased letters
const SPECIAL = { T: 'tap', Q: 'untap', '½': '1-2', '∞': 'infinity', PW: 'planeswalker', CHAOS: 'chaos', A: 'acorn', TK: 'ticket', E: 'e', P: 'p', H: 'h', HW: 'w', HR: 'r' };

export class Symbols {
  constructor(manaDir, warn = () => {}) {
    this.warn = warn;
    this.cssText = '';
    this.classes = new Set();
    this.missing = new Set();
    try {
      let css = fs.readFileSync(path.join(manaDir, 'css', 'mana.css'), 'utf8');
      const woff2 = fs.readFileSync(path.join(manaDir, 'fonts', 'mana.woff2')).toString('base64');
      // keep only the Mana @font-face (drop MPlantin, a commercial typeface) and embed the font as data: URI
      css = css.replace(/@font-face\s*{[^}]*MPlantin[^}]*}/g, '');
      css = css.replace(/@font-face\s*{[^}]*font-family:\s*"Mana";[^}]*}/, `@font-face{font-family:"Mana";src:url(data:font/woff2;base64,${woff2}) format("woff2");font-weight:normal;font-style:normal;font-display:block}`);
      css = css.replace(/\/\*# sourceMappingURL=.*?\*\//g, '');
      this.cssText = css;
      for (const m of css.matchAll(/\.ms-([a-z0-9-]+)/g)) this.classes.add(m[1]);
    } catch (e) {
      warn(`mana-font not found (${e.message}) — run npm install; symbols fall back to text`, 'assets');
    }
  }
  /** mana-font class for a Scryfall code like "{W/U}" (or null). */
  classFor(code) {
    const inner = String(code).replace(/^\{|\}$/g, '');
    const cands = [SPECIAL[inner], inner.toLowerCase().replace(/\//g, ''), inner.toLowerCase()].filter(Boolean);
    return cands.find((c) => this.classes.has(c)) ?? null;
  }
  has(code) {
    return !!this.classFor(code);
  }
  /** HTML for one symbol code: a mana-font glyph in a cost circle (or a text chip). */
  pip(code) {
    const k = this.classFor(code);
    if (!k) {
      if (!this.missing.has(code) && this.classes.size) {
        this.missing.add(code);
        this.warn(`mana-font has no glyph for ${code}; showing text`, 'assets');
      }
      return textChip(code);
    }
    return `<span class="ms ms-${k} ms-cost" role="img" aria-label="${esc(code)}" title="${esc(code)}"></span>`;
  }
  /** "{W}{U}" → symbols; '' for empty. */
  pips(str) {
    if (!str) return '';
    const codes = String(str).match(/\{[^{}]+\}/g);
    if (!codes) return textChip(str);
    return `<span class="pips">${codes.map((c) => this.pip(c)).join('')}</span>`;
  }
  /** Escape text and replace known symbol codes inline (e.g. definitions mentioning {T}). */
  inline(text) {
    const parts = String(text ?? '').split(/(\{[^{}\s]{1,12}\})/g);
    return parts.map((p, i) => (i % 2 === 1 && this.has(p) ? this.pip(p) : esc(p))).join('');
  }
  /** CSS for the page: the mana-font stylesheet with the font embedded. */
  css() {
    return this.cssText;
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
