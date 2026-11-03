# ADR-0002 — Module boundaries, and a separate claims module

- **Status:** proposed
- **Date:** 2026-11-03
- **Related:** PLAN §5.3, RQ-CL-1…4, epistemic-layer-dec.md

## Context
PLAN §5.3 proposes the modules core, cards, printings, text-art, taxonomies, tags, combos, decks,
provenance and strategy. Tag assignments, legality, prices, documented combos, AI proposals and
synergy hypotheses all share one structure: a statement attributed to an agent, observed in a
snapshot, with a strength and an attitude. One reviewer works on DEC, a reasoner for conjectural and
doxastic content, and needs a single place to plug in alternative semantics.

## Decision
Add **`smtg-claims.ttl`**. It defines `Claim ⊑ prov:Entity`, `Observation`, and the epistemic status,
propositional attitude, strength and lifecycle vocabularies. `TagAssignment`, `LegalityAssertion`,
`PriceObservation`, `RankObservation`, `ComboVariant`, `SynergyHypothesis`, `ObservedAssociation`,
`ArtworkDepiction` and `AffordanceStatement` are all subclasses of `Claim`. Generated vocabularies
live in their own module (`smtgm:vocab`). Interpretation choices (SKOS hierarchy over Tagger parents,
the `hasTag` projection) are **opt-in view modules** outside the default import closure.

## Consequences
SHACL can require provenance on every claim (one shape). A DEC-based module can replace
`smtg-claims.ttl` as a proposal without touching cards and printings.
