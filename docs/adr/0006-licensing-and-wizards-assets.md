# ADR-0006 — Licensing, Wizards material, symbols and fonts

- **Status:** accepted (project owner, 2026-11-03); the code/ontology licences remain a proposal
- **Date:** 2026-11-03
- **Related:** PLAN §2.4, `DISCLAIMER.md`, ADR-0008

## Context (sources read 2026-11-03)
- **Wizards Fan Content Policy** (https://company.wizards.com/en/legal/fancontentpolicy)
  - Fan content may use Wizards' IP if it is free and carries the required notice.
  - Rule 4 asks not to use Wizards' logos and trademarks. The FAQ shows an image of marks not to
    include without written permission; that image depicts the mana symbols (and, separately, the
    guild symbols).
  - The policy says nothing about fonts.
- **Scryfall** offers its data and images within that policy and states that the mana symbols are
  © Wizards of the Coast.
- **Community practice:** the mana symbols are used everywhere in fan tools, databases and community
  sites (Scryfall itself, deckbuilders, wikis). They are commonly drawn with the open-source
  **Mana** font (`mana-font` on npm, Andrew Gioia; font OFL 1.1, CSS MIT), whose README notes that
  the symbol images are © Wizards of the Coast.
- **Beleren** is a proprietary typeface commissioned by Wizards, with no public licence.

## Decision (project owner)
1. **No Wizards fonts.** Beleren is removed. Headings use Alegreya / Alegreya SC (SIL OFL 1.1).
2. **Mana and card symbols are shown**, drawn with the `mana-font` npm package, only to document
   card data (mana costs, colours, symbol vocabularies).
   - No symbol image files are stored in the repository.
   - The Mana font's bundled MPlantin typeface is left out.
   - Codes the font lacks fall back to plain text chips.
   - The owner accepts the residual risk of the FCP listing, in line with widespread community
     practice, together with a prompt takedown commitment.
3. A full **Disclaimer & credits** statement (`DISCLAIMER.md`, also a docs page) says that we own
   none of the Wizards material. It includes the required Fan Content Policy notice, the
   non-affiliation statements, the data sources, the no-warranty clause, a takedown contact and
   all third-party licences. The short notice is repeated in the README, the About page and every
   page footer.
4. Card images are never stored or embedded; the data links to Scryfall-hosted images. Source dumps
   are never committed; only small fixtures are, with attribution.
5. The project is free and non-commercial: no paywall, no registration.

## Licences (proposal)
| Category | Terms |
|---|---|
| Source code (`tools/`) | MIT (`LICENSE`) |
| Ontology, shapes, docs | CC BY 4.0 (proposed) |
| Fixtures | source terms with attribution; no paywall (Scryfall) |
| Raw dumps, generated KG | not in git |
| Fonts in the docs | Alegreya (OFL 1.1), Mana (OFL 1.1; CSS MIT) |

This is a reading of public policies, not legal advice. For a formal publication or a public
service, consider asking Wizards for written permission.
