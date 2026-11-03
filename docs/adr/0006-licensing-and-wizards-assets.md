# ADR-0006 — Licensing, and no Wizards fonts or symbol artwork in anything published

- **Status:** accepted for the Wizards assets (decided 2026-11-03 at the project owner's request);
  the code/ontology licences remain a proposal
- **Date:** 2026-11-03
- **Related:** PLAN §2.4

## Context: what the sources say (read 2026-11-03)

**Wizards of the Coast Fan Content Policy**
(https://company.wizards.com/en/legal/fancontentpolicy)
- Fan content may use Wizards' IP if it is free to access and carries the notice: "[Title] is
  unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by Wizards.
  Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC."
- Rule 4 says "Don't use Wizards' logos and trademarks." The FAQ explains: "You cannot incorporate
  Wizards patents, game mechanics …, logos, or trademarks into your Fan Content without our prior
  written permission." It then lists "the most frequently asked about trademarks and logos that you
  may not include in your Fan Content" as images. That list includes `Mana_Symbols.png`, which shows
  the W, U, B, R, G, colorless, untap and tap symbols, and `guild_symbols.png` (the ten guild
  watermarks).
- "Fan Content does not include the verbatim copying and reposting of Wizards' IP."
- Permission can be withdrawn at any time; content must then be taken down.
- The policy says nothing about fonts.

**Scryfall** (https://scryfall.com/docs/api, card-symbols page)
- Data and images are provided "as part of the Wizards of the Coast Fan Content Policy". Scryfall
  states that "the literal and graphical information … including card images and mana symbols, is
  copyright Wizards of the Coast". Scryfall therefore cannot grant more than the policy allows.

**Beleren**
- A bespoke typeface commissioned by Wizards from Delve Fonts (2012–2014); "Beleren and Magic: The
  Gathering are trademarks of Wizards of the Coast" (Delve Fonts project page). There is no public
  or retail licence.
- The npm package `@saeris/typeface-beleren-bold` says its files were extracted from Wizards'
  website and that it is "not an official or authorized library", for non-commercial use.
  Embedding the font in a published page would re-publish the font file verbatim.

## Decision
1. **Anything published** (GitHub Pages, shared builds, the repository) contains **no Wizards symbol
   artwork and no Wizards font files**.
   - Symbols are rendered as their brace notation in neutral text chips, with plain colour swatches
     for W/U/B/R/G/C.
   - Headings use **Alegreya / Alegreya SC** (Huerta Tipográfica, SIL Open Font License 1.1, via
     `@fontsource`).
   - This is the default `npm run docs:build` → `site/`.
2. An opt-in **private build** (`npm run assets && npm run docs:build:private` → `site-private/`,
   gitignored) embeds Beleren and Scryfall's official symbol images, for viewing on the owner's own
   machine only. It is labelled as such on its About page and is never deployed: the Pages workflow
   only runs the default build.
3. The required Fan Content Policy notice stays on every page footer, on the About page and in the
   README. That covers the use of card names, card text and other card data.
4. Card images are never stored or embedded; the ontology links to Scryfall-hosted images, following
   Scryfall's image guidelines.

## Licences (proposal, unchanged)
| Category | Terms |
|---|---|
| Source code (`tools/`) | MIT (`LICENSE`) |
| Ontology, shapes, docs | CC BY 4.0 (proposed) |
| Fixtures (small Scryfall/Tagger/Spellbook excerpts) | source terms with attribution; no paywall (Scryfall) |
| Raw dumps, generated KG | not in git (`data/` gitignored) |
| Headings font | Alegreya, SIL OFL 1.1 |

## Still open
- **The project name.** "Magic: The Gathering" is a Wizards trademark. Using it to describe what a
  project is *about* (nominative use, with the notice) is common practice. Making it part of the
  project's *name* ("Semantic Magic: The Gathering") could be read as suggesting affiliation. A name
  such as "SMTG: a semantic model of Magic: The Gathering card data" would be safer. This is the
  owner's decision.
- This is a reading of public policies, not legal advice. If the project becomes a publication or
  a public service, ask Wizards for written permission or consult counsel.
