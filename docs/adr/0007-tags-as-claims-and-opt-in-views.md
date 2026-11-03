# ADR-0007 — Tagger data as weighted claims; hierarchy and projections as opt-in views

- **Status:** proposed
- **Date:** 2026-11-03
- **Related:** RQ-TG-1…4, RQ-CL-4, AP-09, AP-11

## Context
Tagger (official Scryfall bulk files since 2026) has 4,601 Oracle tags with 239,926 taggings and
11,828 art tags with 505,125 taggings. Taggings carry a weight (weak / median / strong / very_strong)
and sometimes an annotation. Tags have several parents (711 Oracle tags and 5,122 art tags). Both
hierarchies are DAGs, with no dangling parents, in this snapshot.

## Decision
- Tags are SKOS concepts (`OracleTag`, `ArtTag`; disjoint), with IRIs from the tag UUID.
- Parent edges are recorded as `smtg:taggerParent`, which is not `skos:broader` and not transitive.
- Every tagging is an `OracleTagAssignment` / `ArtTagAssignment` claim: weight, annotation,
  `claimedBy` the Tagger community, `observedIn` the snapshot, status *community-curated*, attitude
  *belief*.
- `views/smtg-tags-skos-view.ttl` (taggerParent ⊑ skos:broader) and
  `views/smtg-tags-projection-view.ttl` (property chain to `hasTag`) are opt-in.

## Consequences
Hierarchical search remains possible (an explicit property path, or the view), but it is a visible
interpretive step rather than a hidden entailment. The DEC collaboration can replace the views with
belief-propagation semantics.
