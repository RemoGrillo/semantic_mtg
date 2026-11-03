# ADR-0004 — Open vocabularies; unknown source codes become unstable concepts

- **Status:** proposed
- **Date:** 2026-11-03
- **Related:** RQ-LY-1, RQ-LY-3, RQ-TY-2, AP-07

## Context
The 2026-11-03 snapshot contains layouts the plan did not anticipate: `prepare` (72 Oracle cards,
548 printings) and `front_card` (291 Oracle cards). It also has 176 subtype words outside Scryfall's
catalogs. A closed OWL enumeration (`owl:oneOf`) would make every new release a breaking change.

## Decision
- Controlled vocabularies are SKOS concept schemes whose concepts are typed by an SMTG class
  (`smtg:Layout`, `smtg:CardType` …). There are no `owl:oneOf` closures.
- The generator emits a concept for **every observed code**, with `smtg:observedCount`. Codes
  without a curated definition get `vs:term_status "unstable"` and a placeholder definition stating
  that it is uncurated. Curated codes that are not observed are not emitted (logged).
- `owl:AllDifferent` is asserted among layouts, colours and weights, so that defined classes stay
  provably disjoint.

## Consequences
New Magic mechanics never break the ontology. The cost is a curation queue of *unstable* concepts,
which the documentation lists.
