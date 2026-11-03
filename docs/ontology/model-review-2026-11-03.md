# Model review, 2026-11-03

A review of the first draft against the 2026-11-03 data (547,953 printings, 39,287 Oracle cards),
Scryfall's schemas and search features, and the Comprehensive Rules (effective 25 September 2026).
It covers what holds up, what was missing, and what was added on the same day.

## What the data confirms

- **Oracle-level invariance holds.** Across all printings of each Oracle ID, these never vary:
  layout, name, mana cost, mana value, type line, Oracle text, colours, colour identity, colour
  indicator, and P/T. That supports putting them at Oracle level, and the functional `hasLayout` /
  `hasColorIdentity`. The single exception is `legalities.oldschool` (RQ-PR-4).
- **Reversible printings.** All 83 carry the same Oracle ID on both faces, so `isPrintingOf`
  max 2 is correct but never reaches 2 in practice.
- **Cross-source identifiers resolve.** Tagger and Spellbook identifiers match Scryfall Oracle IDs
  100%, so the reified claims rest on solid joins.

## Questions raised, and answers

**Converted mana cost.** It was already there as `smtg:manaValue`, from Scryfall's `cmc`; Wizards
renamed it "mana value" in 2021. It is taken from the source, never recomputed, because split
cards and other layouts follow special rules (CR 202.3, 709.4). The problem was findability, so
the property now carries the alternative labels "converted mana cost", "CMC" and "cmc" (CQ-MV-01).

**Mana production and tokens.**
- `smtg:producesManaSymbol` comes from Scryfall's `produced_mana`, which Scryfall derives from a
  card's own mana abilities: 2,805 Oracle records, **33 of them tokens** (Eldrazi Spawn and Scion
  {C}, Treasure, Powerstone, Gold…).
- Through the `all_parts` token links, **681 cards create a token that can produce mana**.
- This is now an inference:
  - `smtg:createsToken` is a projection of the source's token relations (rule R-TOKEN);
  - `smtg:producesManaViaToken` is defined by the property chain `createsToken ∘
    producesManaSymbol` (rule R-MANA-VIA-TOKEN);
  - results are materialised into the inferred graph only. Example: [[Eldrazi Confluence]] →
    [[Eldrazi Scion]] → {C} (CQ-INF-01).

  [[!Eldrazi Confluence]] [[!Eldrazi Scion]]

- Data quirk: [[Sole Performer]] has `produced_mana: ["T"]`. That is not a mana type, so the mapper
  now only accepts real mana symbols and reports the rest.

**Permanents vs non-permanents.**
- This belongs to **faces**: 287 Oracle cards have one permanent face and one instant or sorcery
  face. Face counts: 28,743 permanent, 7,975 instant/sorcery, 5,957 neither (planes, schemes, art
  cards…).
- Three Un-cards are typed both, e.g. [[Lightning Colt]] ("Instant Creature — Horse"), so the face
  classes are deliberately not disjoint.
- Whether a *card* is a permanent card (CR 110.4a) depends on which face counts outside the
  battlefield and stack:
  - the front face of a double-faced card (CR 712.8a);
  - the normal characteristics of an adventurer, flip or preparation card (CR 715.4, 710.1, 722.2);
  - both halves of a split card combined (CR 709.4).
- Added:
  - `smtg:PermanentCardType` / `smtg:InstantOrSorceryCardType`, typing the card-type vocabulary;
  - `smtg:PermanentFace` / `smtg:InstantOrSorceryFace`;
  - `smtg:primaryFace` (per-layout policy, with the rule reference, on each layout concept);
  - `smtg:PermanentCard`.
- [[Agadeem's Awakening // Agadeem, the Undercrypt]] is correctly *not* a permanent card, while
  [[Bonecrusher Giant // Stomp]] is (CQ-INF-02, CQ-INF-03).

## Gaps closed

| Gap | Change | Check |
|---|---|---|
| Symbol properties (Scryfall `is:hybrid`, `is:phyrexian`) | `isHybrid`, `isPhyrexian`, `appearsInManaCosts`, `isFunny` on symbols; `HybridManaSymbol`, `PhyrexianManaSymbol` | CQ-SY-01 |
| Keywords only per card (717 multi-face Oracle cards) | `smtg:faceKeyword`: normalised per face from the Oracle text | CQ-KW-01 |
| Spellbook `usedFace` deferred | `smtg:usesFace` (1-based in the source, verified on all 4,730 uses) | CQ-CB-03 |
| Rules-defined type groups (Scryfall `is:historic` …) | `smtg:TypeGroup`: historic (700.6), party (700.8), outlaw (700.12), members checked against the rule text | CQ-TY-03 |
| Rulings | `smtg:Ruling` claims (Wizards: authoritative report; Scryfall: source editorial), 193 for the fixture cards | CQ-RU-01 |
| Set metadata | printed size, foil-only, nonfoil-only, digital, icon, parent set, set-level identifiers | CQ-ST-01 |
| Asserted vs inferred not demonstrated | `rules/*.rq` + `npm run infer`: inferred graph with PROV activity, never merged into source graphs | CQ-PV-03, CQ-PV-04 |
| "Mapped" only meant "claimed by an annotation" | Mapping coverage now checks, per mapped field, whether the prototype mapper actually emits a claimed term | Mapping coverage page |

## Opportunities left open

- **Commander eligibility** ("can be your commander") needs the Oracle text ("can be your
  commander") on top of type data. That is a text-derived claim, not a type fact.
- **Devotion** can be computed from symbol occurrences (hybrid symbols count for both colours),
  but it is a game-state notion. Better offered as a SPARQL view than as an ontology term.
- **Vanilla creatures** (717 creature faces with empty Oracle text) are a query, not a class.
- **Token links are incomplete.** Many tokens are referenced in `all_parts`, but not every
  token-making card has the link. Text-based enrichment would be a separate, evaluated claim layer
  (PLAN §8.5).
- **Primary face of meld results** is face 0 by policy, but a meld result never exists outside
  the battlefield, so the notion barely applies (RQ-CF-5).
