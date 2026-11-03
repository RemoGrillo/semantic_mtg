// Parse the Magic: The Gathering Comprehensive Rules (plain-text release) for the authoritative
// lists used to cross-check Scryfall's keyword catalogs:
//   207.2c  ability words           (one sentence listing them)
//   701.x   keyword actions         (section headings)
//   702.x   keyword abilities       (section headings)
// The rules text is © Wizards of the Coast; it is downloaded into data/raw/ (gitignored), never committed.
import fs from 'node:fs';

export function parseComprehensiveRules(file) {
  const L = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const effective = L.find((l) => /^These rules are effective as of /.test(l))?.replace(/^These rules are effective as of /, '').replace(/\.$/, '') ?? null;
  // The table of contents also has a "Glossary" line: the rules body starts at the first "100.1."
  const start = L.findIndex((l) => /^100\.1\. /.test(l));
  const end = L.findIndex((l, i) => i > start && /^Glossary\s*$/.test(l));
  const body = L.slice(start, end > 0 ? end : undefined);
  const heads = (sec) =>
    body
      .map((l) => l.match(new RegExp(`^(${sec}\\.(\\d+))\\. (.+)$`)))
      .filter((m) => m && m[2] !== '1') // x.1 is the general rule of the section
      .map((m) => ({ rule: m[1], name: m[3].trim() }));
  const aw = body.find((l) => l.startsWith('207.2c'));
  const abilityWords = aw
    ? aw.split('The ability words are ')[1].replace(/\.$/, '').replace(/, and /, ', ').split(', ').map((s) => s.trim())
    : [];
  return { effective, abilityWords: abilityWords.map((name) => ({ rule: '207.2c', name })), keywordActions: heads('701'), keywordAbilities: heads('702') };
}

/** Normalised comparison key: case, apostrophes and spacing do not matter. */
export const crKey = (s) => String(s).toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
