# Status

_Last updated: 2026-11-03._

**Phase:** 0 (source audit) done for a first pass; **Phase 1 (ontology draft) ready for review
round R1–R3**. Per the plan's gate 1 there is **no production ETL** and no endpoint until the
ontology is reviewed.

## What exists
- Source snapshots (2026-11-03): Scryfall all_cards, oracle_cards, oracle_tags, art_tags, catalogs,
  symbology, sets; Commander Spellbook variants. Checksummed manifest in `data/raw/` (gitignored).
- Field census and profiles: `docs/source-audit/`.
- Ontology draft v0.1.0: 11 modules + a generated vocabulary module (41 schemes, 2,358 concepts)
  + 2 opt-in views. 325 SMTG terms, all labelled and defined.
- SHACL shapes (19 node shapes) and 8 deliberately invalid fixtures, all rejected with the expected
  message.
- Real fixtures for the plan's §4.2 edge cases, and the example RDF generated from them by a
  fixture-only prototype mapper.
- 27 competency questions (SPARQL) with results.
- HermiT (via ROBOT on a portable JRE): TBox consistent, no unsatisfiable classes; TBox + examples
  consistent; 2 negative OWL tests inconsistent as intended.
- Mapping coverage for every observed source path (Scryfall 198, Spellbook 94, Tagger 19): mapped,
  derived, excluded or deferred, none unmapped.
- Documentation site (`npm run docs:build` → `site/index.html`) and review mode (`npm run docs:serve`).

## Assumptions
- Namespace `https://w3id.org/smtg/` is a placeholder (ADR-0003).
- Licensing is a proposal (ADR-0006) and needs review before anything public.

## Next steps (after review)
1. Resolve R1–R3 review questions; record decisions as ADRs.
2. Planar-type catalog and multi-word subtype parsing (RQ-TY-2).
3. Decide claim-content representation together with DEC (RQ-CL-2) and the QLever version.
4. Then Phase 2: ETL specification and streaming pipeline.

## Known limitations of this draft
- `all_parts` references outside the fixtures stay unresolved in the examples (reported).
- The strategy and decks modules are sketches; no data.
- Docs: no browser screenshot test is available on this machine; visual check is manual.
