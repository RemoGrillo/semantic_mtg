// Card references in documentation text: [[Card Name]], [[Card Name|SET|CN|lang]], [[!…]] for an
// inline image. Parsing is shared by the resolver (tools/docs/resolve-cards.mjs) and the docs build;
// rendering uses the committed docs/card-refs.json (images are hot-linked from Scryfall, not stored).
import fs from 'node:fs';
import { esc, attr } from './html.mjs';

export const CARD_REF_RE = /\[\[(!?[^[\]\n]+?)\]\]/g;
// one or more image references in a row (separated only by white space or line breaks): shown
// together as a row of cards below the text, not interleaved with it
const IMAGE_RUN_RE = /\[\[![^[\]\n]+?\]\](?:(?:\s|<br>)*\[\[![^[\]\n]+?\]\])*/g;

export function parseCardRef(inner) {
  inner = String(inner).replace(/\\\|/g, '|'); // "\|" inside Markdown table cells
  const raw = `[[${inner}]]`;
  const image = inner.startsWith('!');
  const parts = (image ? inner.slice(1) : inner).split('|').map((s) => s.trim());
  const [name, set, cn, lang] = parts;
  if (!name) return null;
  const ref = { raw, image, name, set: set ? set.toLowerCase() : null, cn: cn || null, lang: lang ? lang.toLowerCase() : null };
  // the image flag does not change what is referenced
  ref.key = [name.toLowerCase().replace(/[’']/g, "'"), ref.set ?? '', ref.cn ?? '', ref.lang ?? ''].join('|');
  return ref;
}

let DATA = { refs: {} };
let warn = () => {};
export function loadCardRefs(file, warnFn = () => {}) {
  warn = warnFn;
  try {
    DATA = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    DATA = { refs: {} };
    warn('docs/card-refs.json not found — card references render as plain names (run npm run cards:resolve)', 'cards');
  }
  return DATA;
}

const decode = (s) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);
const warned = new Set();

/** HTML for one reference (inner text without the brackets). */
export function cardRefHtml(inner) {
  const ref = parseCardRef(inner);
  if (!ref) return esc(`[[${inner}]]`);
  const hit = DATA.refs?.[ref.key];
  const label = ref.name;
  if (!hit || hit.unresolved) {
    if (!warned.has(ref.raw)) {
      warned.add(ref.raw);
      warn(`Card reference ${ref.raw} is not resolved — run npm run cards:resolve`, 'cards');
    }
    return `<span class="cardref unresolved" title="Card not resolved in the Scryfall snapshot">${esc(label)}</span>`;
  }
  const imgs = hit.images ?? [];
  const where = hit.kind === 'printing' ? `${hit.set_name} (${hit.set.toUpperCase()}) #${hit.collector_number}${hit.lang && hit.lang !== 'en' ? `, ${hit.lang}` : ''}` : null;
  const title = `${hit.name}${where ? ` — ${where}` : ''} · open on Scryfall`;
  if (ref.image) {
    const faces = imgs
      .map((i) => `<img src="${attr(i.normal)}" alt="${attr(`${i.face}${where ? `, ${where}` : ''}${hit.artist ? `, illustrated by ${hit.artist}` : ''}`)}" loading="lazy" width="244" height="340" referrerpolicy="no-referrer">`)
      .join('');
    return `<span class="card-figure"><a class="card-figure-imgs" href="${attr(hit.scryfall_uri)}" target="_blank" rel="noopener" title="${attr(title)}">${faces}</a><span class="card-caption"><span class="card-caption-name">${esc(hit.name)}</span>${where ? `<span class="card-caption-where">${esc(where)}</span>` : ''}</span></span>`;
  }
  const set = hit.kind === 'printing' ? `<span class="cardref-set">${esc(hit.set.toUpperCase())}${hit.lang && hit.lang !== 'en' ? ` · ${esc(hit.lang)}` : ''}</span>` : '';
  return `<a class="cardref" href="${attr(hit.scryfall_uri)}" target="_blank" rel="noopener" title="${attr(title)}" data-card-img="${attr(imgs[0]?.normal ?? '')}"${imgs[1] ? ` data-card-img2="${attr(imgs[1].normal)}"` : ''}>${esc(label)}${set}</a>`;
}

/** A row of card images, for the inner texts of several image references ("!Name|SET…"). */
export function cardRowHtml(inners) {
  return `<span class="card-row">${inners.map((inner) => cardRefHtml(inner)).join('')}</span>`;
}

/** Replace [[…]] references inside already-escaped HTML text. */
export function replaceCardRefs(html) {
  return String(html)
    .replace(IMAGE_RUN_RE, (run) => cardRowHtml([...run.matchAll(CARD_REF_RE)].map((m) => decode(m[1]))))
    .replace(CARD_REF_RE, (m, inner) => cardRefHtml(decode(inner)));
}
