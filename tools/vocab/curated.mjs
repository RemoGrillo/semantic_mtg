// Curated knowledge layered on top of generated vocabularies.
// Everything here is editorial (reviewable) — the generator never invents codes:
// a concept is emitted only if its code is observed in the source data or catalogs
// (curated entries for codes not observed are emitted with smtg:observedInSnapshot false).

export const FACE_CONFIGS = {
  'single': { label: 'Single face', def: 'One conceptual face on the front of the card.' },
  'same-side-parts': { label: 'Several parts on one side', def: 'Two or more conceptual faces printed on the same physical side (split, flip, adventure, prepare).' },
  'double-sided': { label: 'Faces on opposite sides', def: 'Two conceptual faces printed on the front and the back of one physical card (transform, modal DFC, double-faced tokens).' },
  'double-sided-separate-objects': { label: 'Opposite sides, separate Oracle objects', def: 'Front and back of the physical card carry different Oracle identities (reversible printings; meld halves whose backs show parts of the meld result).' },
  'none': { label: 'No game face', def: 'The record has no playable face (e.g. front cards, art cards).' },
};

export const OBJECT_KINDS = {
  'traditional-card': { label: 'Traditional card', def: 'A card that can be put in a deck under the normal rules.' },
  'token': { label: 'Token', def: 'A token object (or the card representing it).' },
  'emblem': { label: 'Emblem', def: 'An emblem created by a planeswalker or other effect.' },
  'plane': { label: 'Plane or phenomenon', def: 'A Planechase plane or phenomenon card.' },
  'scheme': { label: 'Scheme', def: 'An Archenemy scheme card.' },
  'vanguard': { label: 'Vanguard', def: 'A Vanguard avatar card.' },
  'art-card': { label: 'Art-series card', def: 'An art-series card (artwork on both sides, no game function).' },
  'front-card': { label: 'Front card', def: 'A non-game "front card" (e.g. Jumpstart theme cards), observed as layout front_card.' },
  'dungeon': { label: 'Dungeon', def: 'A dungeon card used with venture/initiative.' },
  'other-nontraditional': { label: 'Other non-traditional object', def: 'Another non-traditional object (stickers, attractions, helper cards, …) pending curation.' },
};

// layout code → curated description + matrix annotations
export const LAYOUTS = {
  normal: { label: 'Normal', def: 'A single-faced card with a standard frame.', fc: 'single', faces: '1', sides: '1', arr: 'one face, front' },
  split: { label: 'Split', def: 'Two (or more) half-cards side by side on one side, including fuse and aftermath.', fc: 'same-side-parts', faces: '2+', sides: '1', arr: 'halves side by side (aftermath: rotated)', cls: 'SplitCard' },
  flip: { label: 'Flip', def: 'Two faces on one side, the second printed upside down; the permanent flips.', fc: 'same-side-parts', faces: '2', sides: '1', arr: 'second face inverted', cls: 'FlipCard' },
  transform: { label: 'Transform', def: 'Double-faced card whose front is cast and whose back it can transform into.', fc: 'double-sided', faces: '2', sides: '2', arr: 'front / back', cls: 'TransformingDoubleFacedCard' },
  modal_dfc: { label: 'Modal double-faced', def: 'Double-faced card where the player chooses which face to cast or play.', fc: 'double-sided', faces: '2', sides: '2', arr: 'front / back, either playable', cls: 'ModalDoubleFacedCard' },
  meld: { label: 'Meld', def: 'Two cards whose backs combine into a third object, the meld result.', fc: 'double-sided-separate-objects', faces: '1 per card', sides: '2', arr: 'two fronts; back halves form the result', sep: 'yes: halves and result are three Oracle cards', cls: 'MeldCard' },
  leveler: { label: 'Leveler', def: 'Single-faced card with level-up bands.', fc: 'single', faces: '1', sides: '1', arr: 'one face, level bands' },
  class: { label: 'Class', def: 'Single-faced enchantment with class levels.', fc: 'single', faces: '1', sides: '1', arr: 'one face, level bands' },
  case: { label: 'Case', def: 'Single-faced Case enchantment with a "to solve" condition.', fc: 'single', faces: '1', sides: '1', arr: 'one face' },
  saga: { label: 'Saga', def: 'Single-faced Saga with chapter abilities in a vertical frame.', fc: 'single', faces: '1', sides: '1', arr: 'one face, vertical text' },
  adventure: { label: 'Adventure', def: 'A permanent face with an inset Adventure spell face on the same side.', fc: 'same-side-parts', faces: '2', sides: '1', arr: 'main face + inset spell', cls: 'AdventurerCard' },
  prepare: { label: 'Prepare', def: 'Observed 2026 layout: a creature face and a spell face on the same side; while prepared, a copy of the spell may be cast (from reminder text).', fc: 'same-side-parts', faces: '2', sides: '1', arr: 'creature face + spell face', cls: 'PrepareCard', unstable: true },
  mutate: { label: 'Mutate', def: 'Single-faced creature with mutate frame.', fc: 'single', faces: '1', sides: '1', arr: 'one face' },
  prototype: { label: 'Prototype', def: 'Single-faced card with an inset prototype cost/size.', fc: 'single', faces: '1', sides: '1', arr: 'one face with prototype inset' },
  battle: { label: 'Battle', def: 'Battle card (printed sideways).', fc: 'double-sided', faces: '2', sides: '2', arr: 'front rotated / back' },
  planar: { label: 'Planar', def: 'Planechase plane or phenomenon (oversized, landscape).', fc: 'single', faces: '1', sides: '1', arr: 'one face, landscape', ok: 'plane' },
  scheme: { label: 'Scheme', def: 'Archenemy scheme (oversized).', fc: 'single', faces: '1', sides: '1', arr: 'one face', ok: 'scheme' },
  vanguard: { label: 'Vanguard', def: 'Vanguard avatar (oversized).', fc: 'single', faces: '1', sides: '1', arr: 'one face', ok: 'vanguard' },
  token: { label: 'Token', def: 'A token card.', fc: 'single', faces: '1', sides: '1', arr: 'one face', ok: 'token' },
  double_faced_token: { label: 'Double-faced token', def: 'A token card with a token printed on each side; Scryfall gives it two faces.', fc: 'double-sided', faces: '2', sides: '2', arr: 'front / back', ok: 'token' },
  emblem: { label: 'Emblem', def: 'An emblem card.', fc: 'single', faces: '1', sides: '1', arr: 'one face', ok: 'emblem' },
  augment: { label: 'Augment', def: 'Un-card augment half (attaches to a host).', fc: 'single', faces: '1', sides: '1', arr: 'one face (half-card)' },
  host: { label: 'Host', def: 'Un-card host creature that augments attach to.', fc: 'single', faces: '1', sides: '1', arr: 'one face' },
  art_series: { label: 'Art series', def: 'Art-series card: artwork on both sides, no game function (Scryfall gives two faces).', fc: 'double-sided', faces: '2', sides: '2', arr: 'art front / art back', ok: 'art-card', printingOnly: true },
  reversible_card: { label: 'Reversible card', def: 'A printing showing a card on both sides (e.g. alternative-art Secret Lair). Each side carries its own Oracle ID; this is a printing convention, not a game layout.', fc: 'double-sided-separate-objects', faces: '1 per side', sides: '2', arr: 'same or different card on each side', sep: 'yes: Oracle ID on each face', printingOnly: true },
  front_card: { label: 'Front card', def: 'Observed layout for non-game "front cards" in memorabilia sets (e.g. Jumpstart theme fronts).', fc: 'none', faces: '0–1', sides: '1–2', arr: 'non-game card', ok: 'front-card', unstable: true },
};

export const COLORS = [
  ['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green'],
];

// WUBRG-ordered code → community name(s)
export const COMBO_NAMES = {
  C: ['Colorless'], W: ['Mono-white'], U: ['Mono-blue'], B: ['Mono-black'], R: ['Mono-red'], G: ['Mono-green'],
  WU: ['Azorius'], UB: ['Dimir'], BR: ['Rakdos'], RG: ['Gruul'], WG: ['Selesnya'],
  WB: ['Orzhov'], UR: ['Izzet'], BG: ['Golgari'], WR: ['Boros'], UG: ['Simic'],
  WUG: ['Bant'], WUB: ['Esper'], UBR: ['Grixis'], BRG: ['Jund'], WRG: ['Naya'],
  WBG: ['Abzan'], WUR: ['Jeskai'], UBG: ['Sultai'], WBR: ['Mardu'], URG: ['Temur'],
  UBRG: ['Glint-Eye', 'Non-white'], WBRG: ['Dune-Brood', 'Non-blue'], WURG: ['Ink-Treader', 'Non-black'],
  WUBG: ['Witch-Maw', 'Non-red'], WUBR: ['Yore-Tiller', 'Non-green'], WUBRG: ['Five-color', 'WUBRG'],
};

export const RARITIES = {
  common: [1, 'Common'], uncommon: [2, 'Uncommon'], rare: [3, 'Rare'], mythic: [4, 'Mythic rare'],
  special: [5, 'Special (e.g. timeshifted)'], bonus: [5, 'Bonus (e.g. special guests)'],
};

export const LEGALITY = {
  legal: 'Legal in the format.',
  not_legal: 'Not legal in the format (e.g. never printed into its card pool).',
  restricted: 'Restricted: at most one copy allowed.',
  banned: 'Banned in the format.',
};

export const SIDES = { front: 'Front of the physical card.', back: 'Back of the physical card.' };
export const ORIENTATIONS = {
  upright: 'Read in the card’s normal orientation.',
  rotated: 'Rotated 90° relative to the card (aftermath halves, battles, split halves).',
  inverted: 'Upside down relative to the other face (flip cards).',
};
export const IMAGE_VARIANTS = {
  png: 'Full card, PNG with transparent rounded corners (745×1040).',
  large: 'Large full-card JPEG/WebP.', normal: 'Normal-size full-card image.', small: 'Small thumbnail.',
  art_crop: 'Crop of the artwork only.', border_crop: 'Full card cropped at the border.',
};
export const GAMES = { paper: 'Physical paper Magic.', arena: 'Magic: The Gathering Arena.', mtgo: 'Magic Online.', astral: 'Astral (historical Microprose digital game).', sega: 'Sega Dreamcast game (historical).' };
export const FINISHES = { nonfoil: 'Non-foil finish.', foil: 'Foil (traditional or special) finish.', etched: 'Etched foil finish.', glossy: 'Glossy finish.' };
export const CURRENCIES = { usd: 'US dollar (TCGplayer market).', usd_foil: 'US dollar, foil.', usd_etched: 'US dollar, etched.', eur: 'Euro (Cardmarket).', eur_foil: 'Euro, foil.', eur_etched: 'Euro, etched.', tix: 'MTGO event tickets (Cardhoarder).' };
export const RANKINGS = { edhrec: ['EDHREC rank', 'Rank by popularity in EDHREC-indexed Commander decklists.'], penny: ['Penny Dreadful rank', 'Rank by popularity in the Penny Dreadful MTGO format.'] };
export const ZONES = { B: 'Battlefield', H: 'Hand', G: 'Graveyard', E: 'Exile', L: 'Library', C: 'Command zone' };
export const COMPONENTS = {
  token: 'The related object is a token the card can create.',
  meld_part: 'The related object is one of the two meld halves.',
  meld_result: 'The related object is the result of a meld.',
  combo_piece: 'Loose Scryfall relation to a card commonly used together (not a documented combo).',
};
export const LANGUAGES = {
  en: ['English', 'en'], es: ['Spanish', 'es'], fr: ['French', 'fr'], de: ['German', 'de'], it: ['Italian', 'it'],
  pt: ['Portuguese', 'pt'], ja: ['Japanese', 'ja'], ko: ['Korean', 'ko'], ru: ['Russian', 'ru'],
  zhs: ['Simplified Chinese', 'zh-Hans'], zht: ['Traditional Chinese', 'zh-Hant'], he: ['Hebrew', 'he'],
  la: ['Latin', 'la'], grc: ['Ancient Greek', 'grc'], ar: ['Arabic', 'ar'], sa: ['Sanskrit', 'sa'],
  ph: ['Phyrexian', null], qya: ['Quenya', 'qya'],
};
