# Disclaimer and credits

## Unofficial fan content

**Semantic MTG is unofficial Fan Content permitted under the Fan Content Policy. Not
approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast.
©Wizards of the Coast LLC.**

Wizards of the Coast Fan Content Policy: <https://company.wizards.com/en/legal/fancontentpolicy>

## We do not own Magic: The Gathering, or anything of it

- **Magic: The Gathering**, **MTG**, the Magic logos, the planeswalker symbol, and all related names,
  marks and trade dress are trademarks of Wizards of the Coast LLC, a subsidiary of Hasbro, Inc.
- **Card names, Oracle and printed card text, flavor text, rules text, game terminology and
  mechanics, mana and card symbols, set symbols, watermarks, guild and clan symbols, card frames,
  and card artwork** are the property of Wizards of the Coast LLC and of the respective artists.
- The Semantic MTG project, its contributors and the SMTG-O ontology **claim no ownership of, and no
  rights in**, any of this material. It is referred to only to describe, document and study the
  game's card data.
- Semantic MTG is **not produced, endorsed, sponsored, supported or approved** by Wizards of the
  Coast or Hasbro, and is **not affiliated** with them in any way.

## Mana and card symbols

The documentation displays mana and card symbols to document card data (mana costs, colours,
colour identities, symbol vocabularies). They are drawn with **Mana**, the widely used open-source
symbol font by Andrew Gioia (npm package [`mana-font`](https://www.npmjs.com/package/mana-font)
1.18.0, <https://mana.andrewgioia.com>; font licensed under the SIL Open Font License 1.1, CSS under
the MIT License). As the Mana project itself states, **the mana, tap and card type symbol images
are copyright Wizards of the Coast**. This repository contains no symbol images. The font is added
to the built documentation from the npm package, and its bundled MPlantin typeface is deliberately
left out.

No Wizards of the Coast typefaces are used. Headings are set in Alegreya and Alegreya SC (Huerta
Tipográfica, SIL Open Font License 1.1).

## Data sources

- **Scryfall** (<https://scryfall.com>) provides the card, set, symbol and bulk data, under its API
  and data-use guidelines. Scryfall is not affiliated with this project and has not endorsed it;
  the Scryfall name and logo belong to Scryfall.
- **Scryfall Tagger** (<https://tagger.scryfall.com>): the Oracle and art tags and their
  assignments are the work of the Tagger community contributors.
- **Commander Spellbook** (<https://commanderspellbook.com>): combo data is the work of the
  Commander Spellbook project and its contributors. It is not affiliated with this project.
- **Magic: The Gathering Comprehensive Rules** (<https://magic.wizards.com/en/rules>, © Wizards of the
  Coast) are used only as a reference to cross-check keyword and ability-word lists. Rule numbers are
  cited; the rules text is not redistributed.
- **Card images are not stored, copied or hosted here.** The data only *links* to images hosted by
  Scryfall. The documentation shows some card images to illustrate examples (`[[Card Name]]`
  references). They are loaded from Scryfall's image servers when a page is viewed, shown whole and
  unmodified (artist credit and copyright line intact), following Scryfall's image guidelines. Only small source excerpts (fixtures) are kept in the repository, with their origin and
  checksum. Full source dumps are never committed.

## Free and non-commercial

Semantic MTG, its data and its documentation are free to access: no paywall, no registration, no
surveys, no subscriptions. Nothing here is sold or licensed for a fee.

## No warranty, not an official source

Everything is provided **"as is", without warranty of any kind**. Card data may be incomplete,
outdated or wrong. Semantic MTG is **not** an authoritative source for card text, rulings or format
legality. Rely on Wizards of the Coast's official resources and the Magic Comprehensive Rules
instead.

## Rights holders: contact and takedown

If you hold rights in any material used here and object to its use, please open an issue at
<https://github.com/RemoGrillo/semantic_mtg/issues>. It will be addressed promptly. If Wizards of
the Coast restricts or withdraws permission under its Fan Content Policy, the affected content
will be taken down.

## What our own licences cover

Our licences apply **only to the project's own work**: source code under the MIT License
(`LICENSE`), and ontology, shapes and documentation under CC BY 4.0 (proposed). They do not cover,
and grant no rights in, any third-party material listed above.

## Third-party software, fonts and tools

| Component | Use | Licence |
|---|---|---|
| Mana (`mana-font` 1.18.0), Andrew Gioia | symbol rendering in the docs | font OFL 1.1, CSS MIT |
| Alegreya / Alegreya SC (`@fontsource` 5.3.0), Huerta Tipográfica | headings | OFL 1.1 |
| Mermaid 12.2.0 | diagrams | MIT |
| N3.js 2.13.12 | Turtle parsing and writing | MIT |
| rdf-validate-shacl 0.6.5 | SHACL validation | MIT |
| Oxigraph 0.5.13 | SPARQL (competency questions) | MIT or Apache-2.0 |
| marked 16.4.2 | Markdown rendering | MIT |
| stream-json 3.8.0 | streaming the Spellbook export | BSD-3-Clause |
| ROBOT, with HermiT (downloaded at run time into `.tools/`, not redistributed) | OWL reasoning and QC | BSD-3-Clause (ROBOT), LGPL-3.0 (HermiT) |
| Eclipse Temurin JRE 21 (downloaded at run time, not redistributed) | runs ROBOT | GPL-2.0 with Classpath Exception |

All other trademarks are the property of their respective owners.
