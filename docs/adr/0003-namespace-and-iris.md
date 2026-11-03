# ADR-0003 — Namespace and IRI policy (placeholder)

- **Status:** proposed — namespace is a placeholder (RQ-NS-1)
- **Date:** 2026-11-03

## Decision (draft)
- Terms: `https://w3id.org/smtg/ontology#`; module IRIs `https://w3id.org/smtg/ontology/<module>`;
  version IRI `https://w3id.org/smtg/ontology/<version>`.
- Vocabularies: `https://w3id.org/smtg/vocab/<scheme>/<code>`, where the code is the source value
  (or a slug of it). The exact source value is always in `skos:notation`.
- Instances: `https://w3id.org/smtg/id/<kind>/<stable-source-id>` (e.g.
  `id/oracle-card/<oracle_id>`, `id/printing/<scryfall id>`, `id/illustration/<illustration_id>`,
  `id/tag/oracle/<tagger id>`, `id/combo-variant/<spellbook id>`). Sub-resources extend the path
  (`…/face/0`, `…/face/0/mana-cost`). IRIs are **never** minted from names.
- IRIs are opaque. Queries use `smtg:Identifier` nodes, never string operations on IRIs.

## Consequences
A domain change is one value in `smtg.config.json` plus regenerating vocab and examples. w3id
registration (a pull request to perma-id/w3id.org) is needed before publication.
