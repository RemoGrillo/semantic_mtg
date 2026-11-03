# ADR-0005 — Every Oracle card and every printing has at least one face

- **Status:** proposed
- **Date:** 2026-11-03
- **Related:** RQ-CF-1

## Decision
Face-level characteristics (name, mana cost, type line, Oracle text, P/T, loyalty, defense, colours,
colour indicator) are always on `CardFace` / `PrintedFace`, including for single-faced cards (face
index 0, front side). The Oracle card carries only card-level facts: combined name, layout, colour
identity, keywords, produced mana, mana value as reported, Reserved List.

## Consequences
Queries do not branch on layout ("faces with card type Creature" works for every card). This costs
roughly one extra node per single-faced card. SHACL requires `hasFace` ≥ 1 and `hasPrintedFace` ≥ 1.
