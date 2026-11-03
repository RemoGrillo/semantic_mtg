// Tiny Turtle-emitting helpers (string based, deterministic output).
export const PREFIXES = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dcterms: 'http://purl.org/dc/terms/',
  prov: 'http://www.w3.org/ns/prov#',
  vs: 'http://www.w3.org/2003/06/sw-vocab-status/ns#',
  smtg: 'https://w3id.org/smtg/ontology#',
  smtgm: 'https://w3id.org/smtg/ontology/',
  smtgv: 'https://w3id.org/smtg/vocab/',
  smtgid: 'https://w3id.org/smtg/id/',
};

export const V = 'https://w3id.org/smtg/vocab/';
export const ID = 'https://w3id.org/smtg/id/';

export function prefixBlock(extra = {}) {
  return Object.entries({ ...PREFIXES, ...extra })
    .map(([k, v]) => `@prefix ${k}: <${v}> .`)
    .join('\n');
}

export const iri = (u) => `<${u}>`;

export function lit(value, langOrType) {
  const s = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  if (!langOrType) return `"${s}"`;
  if (langOrType.startsWith('@')) return `"${s}"${langOrType}`;
  return `"${s}"^^${langOrType}`;
}
export const en = (s) => lit(s, '@en');

/** Slug for vocabulary concept IRIs: stable, readable, no spaces/apostrophes. */
export function slug(s) {
  return String(s)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'x';
}

/** Mana symbol code → IRI-safe slug: {W/U} → W-U, {½} → half, {∞} → infinity */
export function symbolSlug(sym) {
  return sym
    .replace(/[{}]/g, '')
    .replace('½', 'half')
    .replace('∞', 'infinity')
    .replace(/\//g, '-');
}

/** Render a subject block: [[pred, obj], ...] (obj already serialized) */
export function block(subject, pairs) {
  const ps = pairs.filter(([, o]) => o !== undefined && o !== null && o !== '');
  return `${subject}\n  ${ps.map(([p, o]) => `${p} ${o}`).join(' ;\n  ')} .\n`;
}
