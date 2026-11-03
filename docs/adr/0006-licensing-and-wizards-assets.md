# ADR-0006 — Licensing proposal and handling of Wizards of the Coast assets

- **Status:** proposed — requires review before any public release (PLAN §2.4)
- **Date:** 2026-11-03

## Proposal
| Category | Proposed terms | Notes |
|---|---|---|
| Source code (`tools/`) | MIT | `LICENSE` |
| Ontology, shapes, docs | CC BY 4.0 | attribution to SMTG contributors |
| Fixtures (small Scryfall/Tagger/Spellbook excerpts) | source terms; attribution | Scryfall asks for attribution and no paywalls; Spellbook and Tagger terms to be checked |
| Raw dumps, generated KG | **not in git** | `data/` is gitignored; recreated by `npm run audit:fetch` |
| Card images | **not stored**; linked from source | `DigitalImage.contentURL` points to Scryfall |
| Mana/card symbols | Scryfall's official SVGs (© Wizards), rasterized to PNG at build time | `assets/vendor/` gitignored; embedded only in the built site |
| Beleren typeface | © Wizards; npm `@saeris/typeface-beleren-bold` (non-commercial) | used for headings in the built docs only |

The built documentation carries the Wizards Fan Content Policy notice: "Semantic Magic: The
Gathering is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by
Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast
LLC."

## Open
Whether the public GitHub Pages build may embed Wizards symbols and the font (fan-content use), or
must fall back to text codes and a free typeface. That needs a decision before publication.
