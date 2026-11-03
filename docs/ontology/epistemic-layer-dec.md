# Epistemic layer and DEC integration

SMTG integrates sources of **very different epistemic standing**:

- Wizards' Oracle text and format legality, mirrored by Scryfall: authoritative reports.
- Scryfall Tagger tags: community judgements, weighted *weak / median / strong / very_strong*, with
  many-parent hierarchies.
- Commander Spellbook combos: community-curated descriptions.
- Later, machine-proposed tags and SMTG's own rule-derived synergy *hypotheses*.

Flattening all of this into plain triples and letting an OWL reasoner close over it would turn
weak, contestable statements into certain-looking entailments. This page explains where the draft
draws the line and where a reasoner for **conjectural and doxastic** content (DEC) can take over.

> Status: this layer is deliberately a **proposal** (`vs:term_status "proposal"`). The vocabulary is
> in place so that data can be recorded faithfully now; its formal semantics are meant to come from
> the DEC collaboration.

## What the draft guarantees today

1. **Every weak or time-bound statement is a `smtg:Claim`**, never a bare triple in a source graph.
   Claims carry `claimedBy` (agent), `observedIn` (snapshot), `hasEpistemicStatus`, `hasAttitude`,
   `hasStrength` (ordinal; e.g. Tagger weight), optional `confidence` (machine methods only),
   `hasLifecycleStatus` (current / retracted / superseded), `supersedes` and `supportedBy`.
2. **No transitive axioms over claims.** `smtg:taggerParent` is not `skos:broader` and is not
   transitive. `supportedBy` is not transitive. The only transitive property in the core is
   `subCombinationOf` (colour-set inclusion), which is mathematically true.
3. **Projections are opt-in views.** `views/smtg-tags-projection-view.ttl` derives `hasTag` from
   assignments through a property chain, so *every* assignment of *any* weight becomes a plain fact.
   `views/smtg-tags-skos-view.ttl` reads Tagger parents as SKOS hierarchy, so every ancestor becomes
   reachable. Neither is imported by default; each is a choice of epistemic commitment you can see
   and turn off.
4. **Conflicts are data, not inconsistency.** `conflictsWithClaim` records disagreement. OWL
   disjointness is reserved for structural impossibilities: a printing is not an Oracle card, and a
   card cannot have two layouts. HermiT verifies both on negative fixtures.

## The two vocabularies to align

| Epistemic status (authority) | Meaning |
|---|---|
| `authoritative-report` | source mirrors the authority (Oracle text, legality) |
| `community-curated` | community process with editorial rules (Tagger, Spellbook) |
| `machine-proposed` | AI/ML output with model, prompt and confidence |
| `rule-derived` | SMTG inference rule or OWL module output |
| `statistical-observation` | frequency/co-occurrence statistics |
| `reviewer-judgement` | a named SMTG reviewer |

| Propositional attitude | Meaning |
|---|---|
| `knowledge-claim` | put forward as known (epistemic) |
| `belief` | held true with some strength, no claim to knowledge (doxastic) |
| `conjecture` | proposed as plausible, open to refutation |
| `hypothesis` | entertained in order to be tested |

## Where weak tags meet reasoning: three concrete cases from the data

**Case 1: implication-like parents (Oracle tags).** [[Lightning Bolt]] is tagged *burn any*
(weight very_strong). In Tagger, *burn any* has the parents *burn creature*, *burn player*,
*burn planeswalker* and *burn battle*, and further up *removal-creature* and *removal* (CQ-TG-03).
Reading parents as subsumption between card sets is plausible here, so should Lightning Bolt be
believed to be *removal* with the same strength as *burn any*?

**Case 2: mixed parents (art tags).** The art tag *rashida scalebane* (a character) has five
parents: species, role, plane and others. Transitive closure would let any ancestor of *plane*
reach the illustration, a chain of category, part-of and theme links that no single reading
supports.

**Case 3: weak assignments.** 4,718 art taggings are *weak*. Under a plain projection they count the
same as *very_strong*. Should a weak belief propagate at all? Should it weaken at every step?

## Extension points for DEC

- **Replace or extend `smtg-claims.ttl`.** Create `proposals/dec-claims/` with an ontology header
  `smtg:proposalOf smtgm:claims ; smtg:proposalKind "replace"` (or `"extend"`). The docs render it
  next to the core module with a term-by-term diff.
- **Add a reasoner.** `smtg.config.json → reasoners.available.dec` is a placeholder. Fill in its
  command line and run `npm run reason -- --reasoner dec`. The same TBox, example ABox and negative
  fixtures are used.
- **Interpretation views.** Write alternative views (e.g. "inherited tags as weakened beliefs")
  beside the existing opt-in views, so different epistemic commitments can be compared on the same
  competency questions.

## Questions for the DEC colleague

1. Should attitude attach to the claim (as now) or to the agent–claim relation, so that agent A
   believes p while agent B conjectures p (RQ-CL-1)?
2. How should hierarchical propagation of beliefs behave: no propagation, propagation with
   decay, or propagation only along parent links typed as implication (RQ-TG-1)?
3. Can the ordinal Tagger weights be mapped to DEC's doxastic strengths, and if so by what reviewed
   rule (RQ-CL-4)?
4. What is the right representation of claim content for DEC: qualified relations, RDF 1.2 triple
   terms or named graphs (RQ-CL-2)?
5. How should inconsistent beliefs from different agents be handled: consistency per agent, or
   paraconsistent handling over the whole graph (RQ-CL-3)?
