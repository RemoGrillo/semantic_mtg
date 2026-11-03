# Semantic anti-patterns

Modelling mistakes that SMTG is designed to avoid. Each is referenced from the ontology terms that
guard against it (`smtg:antiPattern`), and most have a SHACL shape, an OWL axiom or a competency
question that would catch a regression.

### AP-01 — Printing as Oracle card
Treating a printing as the card itself, making `CardPrinting` a subclass of `OracleCard`, or using
`owl:sameAs` between them.
**Instead:** `CardPrinting` and `OracleCard` are disjoint, linked by `smtg:isPrintingOf`.
**Guarded by:** OWL disjointness (reasoner test `invalid-owl/printing-is-oracle-card.ttl`), SHACL
`OracleCardShape`, CQ-ID-03.

### AP-02 — String identifier as the entity
Using a Scryfall UUID string, a name or a URL as if it *were* the card.
**Instead:** a qualified `smtg:Identifier` (value + scheme). IRIs are opaque.

### AP-03 — Shared image ⇒ same thing
Concluding that two printings are the same because they share an illustration, or that an
illustration is the image file.
**Instead:** `Illustration` is shared across printings; `DigitalImage` is a separate representation.
**Guarded by:** CQ-ID-02, SHACL `NoSameAs`.

### AP-04 — Same name ⇒ same card
Matching entities by display name: card names, flavor names (the Godzilla series printing
[[Void Beckoner|IKO|373]] reads *Spacegodzilla, Death Corona*), artist credit
strings ("A & B"), tag labels (renamed upstream).
**Instead:** match on stable source IDs. Names are labels; flavor names and credits are text
expressions.

### AP-05 — Absence as negation (closed-world thinking in OWL)
Reading a missing triple as "false": no colour triple ⇒ colourless, no mana-cost triple ⇒ no mana
cost, no tag ⇒ not that role.
**Instead:** colourless is the explicit combination `C`; "no mana cost" is `hasNoManaCost true`;
tag absence is unknown. Negative queries are explicitly closed-world (`FILTER NOT EXISTS`) and
labelled as such.
**Guarded by:** SHACL `ManaCostXorEmpty`, CQ-MC-01.

### AP-06 — "Modal" means one thing
Conflating a modal double-faced card (a layout) with a modal spell ("choose one —").
**Instead:** `ModalDoubleFacedCard` is defined only by layout; modal abilities are not interpreted in v1.
**Guarded by:** CQ-FL-06 ([[Kolaghan's Command]] is not an MDFC).

[[!Kolaghan's Command]] [[!Agadeem's Awakening // Agadeem, the Undercrypt]]

### AP-07 — Tags and vocabulary values as OWL classes
Turning every tag or vocabulary code into an `owl:Class` ("Removal", "Mythic", "Foil"), which closes
vocabularies and makes every tag assignment a class-membership entailment.
**Instead:** SKOS concepts typed by a small number of OWL classes. A few classes defined by
`owl:hasValue` where classification is justified.

### AP-08 — The type line as one string
Storing "Legendary Creature — Phyrexian Vampire" only as text, or splitting it into bare strings.
**Instead:** the verbatim string **plus** relations to scheme-specific concepts, with the parse
recorded as a normalization activity.
**Guarded by:** SHACL `CardFaceShape` (subtypes must be concepts), fixture
`invalid-rdf/subtype-as-string.ttl`.

### AP-09 — Unjustified transitivity
Declaring transitive relations (tag hierarchies, "supports", evidence chains) without proof that
the meaning composes. Weak, community-made links then propagate without limit.
**Instead:** `taggerParent`, `supportedBy` and synergy relations are not transitive. Transitivity is
used only where it is mathematically true (`subCombinationOf` = subset inclusion). Hierarchical
expansion is an opt-in view.

### AP-10 — Volatile facts as timeless properties
Asserting `:card :legalIn :modern` as if it were always true; storing one price forever.
**Instead:** `LegalityAssertion`, `PriceObservation` and `RankObservation`, scoped by snapshot.

### AP-11 — Unqualified projections as evidence
Emitting only `:card :hasTag :t`, which loses weight, source, date and attitude, and then reasoning
over it as if it were a fact.
**Instead:** a first-class `TagAssignment` claim; `hasTag` is a declared, lossy projection in a
separate graph (opt-in view).

### AP-12 — Pseudo-probabilities on entailments
Attaching a confidence to an OWL entailment, or averaging community weights into a probability.
**Instead:** entailments are certain given their premises; the premises carry their own status.
`smtg:confidence` is only for machine proposals. Weights stay ordinal.

### AP-13 — Text in the picture as card text
Treating words visible inside an artwork as flavor text or rules text, or treating flavor text as
Oracle text.
**Instead:** `ArtworkInscription` (part of the illustration, transcribed with provenance) is
disjoint from `TextExpression`; `FlavorText` and `OracleText` are disjoint.
**Guarded by:** SHACL `FlavorNotOracle`.

### AP-14 — URL as artwork
Treating an image URL as the artwork or the printing.
**Instead:** `DigitalImage` (URL, variant, rights) `depictsArtworkOf` an `Illustration`.

### AP-15 — Documented or co-occurring ⇒ proven synergy
Treating a curated combo, a co-occurrence statistic or an inferred match as a proof that cards
interact.
**Instead:** `ComboVariant` (community-curated claim), `ObservedAssociation` (statistical claim) and
`SynergyHypothesis` (rule-derived hypothesis) are disjoint claim types.

### AP-16 — Variant = recipe
Identifying Commander Spellbook's generated variants with the editor-authored combos they come from.
**Instead:** `ComboVariant` and `ComboRecipe` are disjoint, linked by `generatedFromRecipe` /
`includesRecipe`.
