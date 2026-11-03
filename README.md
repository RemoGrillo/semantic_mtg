# Semantic Magic: The Gathering (SMTG)

**An identity-aware, provenance-rich ontology for Magic: The Gathering card data**, the first
step towards a maintained Linked Open Data knowledge graph built from Scryfall, Scryfall Tagger and
Commander Spellbook and served through QLever.

> **Status: first ontology draft for review (v0.1.0-draft, 2026-11-03).** No production ETL and no
> public endpoint yet. Per the plan, those wait for the ontology review (see `PLAN.md`, gate 1).

SMTG keeps apart what card databases flatten: the **Oracle card** (abstract identity) and its
**faces**; **printings** and **printed faces**; **illustrations** and **images**; text by **role and
language**; controlled vocabularies as **open SKOS schemes**; and community tags and other weak or
time-bound statements as first-class **claims**, with source snapshot, strength and propositional
attitude.

## Quick start

```bash
npm install
npm run audit:fetch      # download source snapshots (manifest-driven, checksummed) into data/raw/
npm run assets           # official mana symbols (Scryfall SVG → PNG) for the docs
npm run build            # vocab → fixture examples → SHACL validation → competency questions → docs
npm run reason           # OWL DL check with HermiT (bootstraps a portable JRE + ROBOT in .tools/)
open site/index.html     # the documentation: a single self-contained file that works offline
npm run docs:serve       # review mode: per-concept suggestion box, saved under review/suggestions/
```

## Repository map

| Path | What |
|---|---|
| `ontology/` | the ontology: `smtg.ttl` (aggregate) + one file per module; `vocab/` (generated); `views/` (opt-in interpretations); `catalog-v001.xml` (for Protégé/ROBOT) |
| `shapes/` | SHACL shapes (closed-world validation) |
| `fixtures/` | small, real source excerpts (`scryfall/`, `tagger/`, `spellbook/`) and deliberately invalid data (`invalid-rdf/`, `invalid-owl/`) |
| `examples/` | example RDF generated from the fixtures by the prototype mapper |
| `queries/competency/` | competency questions as SPARQL |
| `mappings/` | source field → ontology term dispositions |
| `docs/` | design docs: review questions, anti-patterns, DEC/epistemic layer, ADRs, source audit, status |
| `proposals/` | alternative or extension modules proposed by reviewers |
| `review/suggestions/` | suggestions collected in review mode |
| `tools/` | Node tooling (audit, vocab, map, validate, reason, docs) |

## How to review or change the ontology
See **[CONTRIBUTING.md](CONTRIBUTING.md)**. In short: comment on a concept page in review mode,
open an issue, edit the Turtle and rebuild, or put a whole alternative module in `proposals/`.

## Legal
Semantic Magic: The Gathering is unofficial Fan Content permitted under the Fan Content Policy. Not
approved/endorsed by Wizards. Portions of the materials used are property of Wizards of the Coast.
©Wizards of the Coast LLC. Magic: The Gathering, card names, card text, mana symbols, set symbols and
the Beleren typeface are property of Wizards of the Coast LLC.

Card data courtesy of [Scryfall](https://scryfall.com) and the [Tagger](https://tagger.scryfall.com)
community; combo data from [Commander Spellbook](https://commanderspellbook.com). SMTG is not
affiliated with any of them. Source dumps, images, symbols and fonts are **not** redistributed in
this repository. Code: MIT (`LICENSE`). Ontology and documentation: CC BY 4.0 (proposed, ADR-0006).
