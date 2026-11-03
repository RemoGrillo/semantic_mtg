// Type-line parsing shared by the vocabulary generator and the fixture mapper.
// Normalization provenance: this is the "type line parse" NormalizationActivity.
import { readJSON, rawFile } from './common.mjs';
import { slug } from './rdf.mjs';

export const SUBTYPE_CATALOGS = {
  'creature-type': ['creature-types', 'CreatureType', ['Creature', 'Kindred']],
  'artifact-type': ['artifact-types', 'ArtifactType', ['Artifact']],
  'enchantment-type': ['enchantment-types', 'EnchantmentType', ['Enchantment']],
  'land-type': ['land-types', 'LandType', ['Land']],
  'planeswalker-type': ['planeswalker-types', 'PlaneswalkerType', ['Planeswalker']],
  'spell-type': ['spell-types', 'SpellType', ['Instant', 'Sorcery']],
  'battle-type': ['battle-types', 'BattleType', ['Battle']],
};

export function loadTypeSystem() {
  const catalog = (name) => readJSON(rawFile(`scryfall:catalog:${name}`)).data;
  const supertypes = catalog('supertypes');
  const cardTypes = catalog('card-types');
  const subtypeIndex = new Map(); // name -> [scheme…]
  for (const [scheme, [cat]] of Object.entries(SUBTYPE_CATALOGS))
    for (const n of catalog(cat)) subtypeIndex.set(n, [...(subtypeIndex.get(n) ?? []), scheme]);
  const multiword = [...subtypeIndex.keys()].filter((n) => n.includes(' ')).sort((a, b) => b.length - a.length);
  return { supertypes, cardTypes, subtypeIndex, multiword, catalog };
}

/** Split one face's English type line into left-hand words and subtype names. */
export function parseTypeLine(tl, ts) {
  const [left, right] = String(tl).split(' — ');
  const leftWords = (left ?? '').trim().split(/\s+/).filter(Boolean);
  const subs = [];
  if (right) {
    let rest = ` ${right.trim()} `;
    for (const mw of ts.multiword) {
      if (rest.includes(` ${mw} `)) {
        subs.push(mw);
        rest = rest.replace(` ${mw} `, ' ');
      }
    }
    subs.push(...rest.trim().split(/\s+/).filter(Boolean));
  }
  return { leftWords, subs };
}

/** Resolve a parsed type line to vocabulary IRIs (scheme-qualified subtypes). */
export function resolveTypeLine(tl, ts, V) {
  const { leftWords, subs } = parseTypeLine(tl, ts);
  const supertypes = leftWords.filter((w) => ts.supertypes.includes(w)).map((w) => `${V}supertype/${slug(w)}`);
  const types = leftWords.filter((w) => ts.cardTypes.includes(w));
  const cardTypes = types.map((w) => `${V}card-type/${slug(w)}`);
  const residue = leftWords.filter((w) => !ts.supertypes.includes(w) && !ts.cardTypes.includes(w));
  const subtypes = subs.map((s) => {
    const schemes = ts.subtypeIndex.get(s);
    if (!schemes) return `${V}other-subtype/${slug(s)}`;
    // choose the scheme applicable to the face's card types (Rule 205.3)
    const fit = schemes.find((sc) => SUBTYPE_CATALOGS[sc][2].some((t) => types.includes(t))) ?? schemes[0];
    return `${V}${fit}/${slug(s)}`;
  });
  return { supertypes, cardTypes, subtypes, residue };
}
