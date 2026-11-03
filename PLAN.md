> **Renamed 2026-11-03:** the project is now **Semantic MTG** (linked data for Magic: The Gathering cards) and the ontology is **SMTG-O**, the Semantic MTG Ontology (working name); see `docs/adr/0008-project-and-ontology-names.md`. The plan below keeps its original wording.

# Semantic Magic: The Gathering (SMTG)
## Master implementation plan for Claude Code

**Document type:** living technical/research roadmap and implementation specification  
**Status:** planning; ontology-first, with mandatory human review gates  
**Prepared:** 2026-11-03  
**Primary deliverable:** a maintained Magic: The Gathering Linked Open Data knowledge graph, a public SPARQL endpoint powered by **QLever**, and a documented, reusable ontology developed specifically for this project.

---

## 0. Instructions to Claude Code: how to execute this plan

This is a **phased plan, not an instruction to build everything in one pass**. Treat each phase's acceptance criteria as a gate. In particular, **do not implement the full extraction/transformation/loading pipeline, create a production dataset, or deploy a public endpoint before the ontology has undergone explicit human review and has been approved**.

On first invocation:

1. Inspect the existing repository and environment, if any. Preserve existing code, naming conventions, infrastructure and work; do not overwrite or delete files without a reason and consent.
2. Read this plan and create a short `docs/STATUS.md` recording what already exists, what is missing, assumptions, dependencies, blockers and the current phase.
3. Begin with **Phase 0: source/domain audit**, then **Phase 1: ontology design**. Produce concrete files and diagrams, not just a narrative plan.
4. Document choices in Architecture Decision Records (`docs/adr/`). Maintain a list of **questions requiring a human ontologist** in `docs/ontology/review-questions.md`. Do not quietly decide contentious semantics.
5. Use small, curated JSON fixtures and representative card examples during ontology design; this is *not* authorization for a mass ETL.
6. Run whatever validation is feasible and report actual results. Never report a source verified, a test passing, or an endpoint functioning unless it really has been checked.
7. Stop and request an explicit **ontology design approval** before Phase 3 (production ETL). Design can iterate several times with human reviewers.
8. For later phases, implement reproducible, idempotent commands with dry-run modes, logs, tests and rollback. Prefer maintainable solutions over clever one-off scripts.
9. Do not invent source API features, data usage permissions, or OWL inferences. Recheck the official documentation and actual response examples against the date of execution.

**Working language:** English for source code, ontology identifiers, project documentation, issues and Claude Code instructions. Provide human-readable documentation and UI labels in English, with a structure that permits Italian localization later.

## 1. Vision, scope and research motivation

### 1.1 What the project is

Semantic Magic: The Gathering is a **semantically structured, interoperable, continuously updated knowledge graph** of Magic's cards, printings, card faces, artworks, metadata, community annotations, and documented card combinations. It has an OWL ontology (TBox), RDF instance data (ABox), explicit provenance, a SPARQL endpoint in QLever, and an optional discovery interface.

It should be **at least as expressive as Scryfall's metadata model and more semantically precise**: represent entities and relations that Scryfall encodes in flattened fields, arrays and loosely structured strings, while preserving information faithfully and making new joins/inferences possible.

Source datasets planned for initial ingestion:

- **Scryfall** card, printing, set, face, artwork references and all other relevant metadata.
- **Scryfall Tagger** Oracle tags, art tags, hierarchy, assignments and associated evidence/weights if available.
- **Commander Spellbook** documented combo variants, ingredients, requirements, features, descriptions and status, subject to data shape and licensing checks.

Potential enrichment and extensions (separately versioned): AI/Jev-assisted tag proposals, other open vocabularies and authority files, user-provided decklists, bibliographic/art historical links, and ultimately QRAKEN-based natural language querying.

### 1.2 Scientific questions

**RQ1 — Semantic modeling and interoperability:** Can a rigorously designed ontology represent the card/printing/face/artwork/tag/combination ecosystem without conflating levels, and support integration of independently maintained sources?

**RQ2 — Expressive query capability:** Which meaningful, reusable SPARQL queries over linked and structured metadata are not natively expressible through the original source interfaces, and how do they compare with equivalent SQL/JSON pipelines?

**RQ3 — Explainable deductive inference:** Which new, genuinely useful classifications and potential strategic complementarities can be inferred from functional annotations and a carefully designed OWL module, without representing execution of card abilities?

**RQ4 — Symbolic vs. frequency-based recommendations (evaluation hypothesis):** Can a knowledge-based method identify plausible, explainable and less popular recommendations in cases where deck-frequency-based recommenders have sparse observational evidence, while retaining acceptable precision? This is a **hypothesis to test**, not a fact to assume about EDHREC.

**RQ5 — Maintainable LOD:** Can continuously changing heterogeneous card sources be integrated reproducibly while preserving identifiers, source attribution, updates, history and the ability to roll back?

### 1.3 Strict exclusions for v1

- No Forge/XMage rules engine, no card execution simulation, no stack/priority resolution, no proof of combo legality.
- No full logical interpretation of Oracle text. Store it faithfully and in its correct entity/face/version context; structured keywords/metadata can still be represented.
- Do not parse card rulings into formal executable semantics. Their later addition must be possible without redesigning the identity model.
- Do not manually annotate tens of thousands of cards with bespoke strategic roles. Import and normalize **existing** Tagger annotations; AI-assisted enrichment is optional and separately evaluated.
- Do not depend on bulk EDHREC decklist access or construct a permanent mass scraper of deckbuilding sites.
- Do not claim that OWL necessarily outperforms statistical retrieval or that a co-occurrence is a causal synergy.

### 1.4 Fundamental design principles

1. **Separate ontological levels**: Oracle identity, printed manifestation, face, text version, illustration, visible inscription, tag concept, annotation, combo, decklist and synergy hypothesis are different things.
2. **Faithfully preserve the source** even when a higher-level semantic normalization is introduced. A source-specific raw field and a normalized relation can coexist.
3. **No false precision**: absence of a tag is not negation of a role; a potential support relation is not proof of in-game interaction; a feature reported by Commander Spellbook is a curated claim, not an independently verified logical consequence.
4. **Open-world semantics for OWL, closed-world validation for SHACL/ETL**; never use missing RDF facts as automatically false.
5. **Version by observation**: the graph may represent a state of knowledge at a given time, not eternal claims about legalities, prices, Oracle text or tag assignments.
6. **Extensibility**: new Magic card types, layouts, subtypes, finishes and mechanics must not cause data loss or require hard-coded breaking migrations.
7. **Traceability**: every asserted or inferred tag, claimed synergy and source-specific fact must be attributable to source and processing method at a useful granularity.
8. **Machine-checkable design**: ontology logical coherence, SHACL constraints, source mapping coverage, reasoner tests and CQ queries form one maintained specification.

---

## 2. First technical reality checks (important)

### 2.1 Scryfall bulk selection

**Do not use only `oracle_cards`.** It provides a representative object per Oracle ID, so by itself it cannot reconstruct all printings. Depending on source support and desired multilingual coverage:

- `oracle_cards`: compact up-to-date abstract card reference and Oracle metadata; note edge cases (notably reversible cards).
- `all_cards`: every card object in every available language; preferred canonical source for full printing coverage.
- `default_cards`: lighter alternative for one preferred language per printing; document exactly which multilingual facts are omitted if used.
- `unique_artwork`: may help audit illustration coverage/deduplication.
- `oracle_tags` **and** `art_tags`: tag vocabularies and associations, separately interpreted.
- `rulings`: explicitly **out of current semantic execution scope**; may remain an optional bibliographic text source in a later release.
- Sets and catalogs through documented Scryfall API endpoints when needed for complete set/type vocabularies.

Discover current files through `https://api.scryfall.com/bulk-data`, reading the returned download URI fields dynamically. As of 2026, Scryfall is also publishing gzipped **JSONL** bulk exports; do not assume the previous JSON-array format or hard-code dated URLs. Parse by content and manifest, with compatibility handling if formats evolve. Respect rate limits and the API's required user-agent and Accept headers. Prefer bulk files to thousands of requests.

**Special case:** Scryfall's `reversible_card` layout can put `oracle_id` on each face rather than the root. The identity mapping must not silently drop or merge these objects. Inspect the maintained `scryfall/api-types` definitions and actual fixtures.

### 2.2 Commander Spellbook

Official documentation directs bulk users to `https://json.commanderspellbook.com/variants.json.gz`. The exported object has a timestamp, version, variant records and aliases. The source model distinguishes `Card`, `Feature`, `Template`, editor-authored `Combo` and generated `Variant`. **A variant is not identical to a combo recipe**. The bulk export may not supply every underlying editor-authored object as a stand-alone record; verify actual coverage and supplement sparsely via the documented API only where justified.

The download is a **periodically refreshed snapshot**, not necessarily an incremental event stream. Updates should normally be detected by snapshot/version comparisons, then diffed locally. Do not invent an `updatedSince` API if none is documented.

### 2.3 QLever capabilities and limits

QLever supports SPARQL 1.1 queries, **SPARQL 1.1 Update** and the Graph Store HTTP Protocol. It can persist update deltas when configured to do so. Its update data structures are different from the main compressed index: monitor delta size and plan periodic index rebuilding (`qlever rebuild-index`), or use a supported automatic rebuild policy after testing its behavior for the installed version. A rebuild can require a short service transition unless blue/green infrastructure is designed.

**Do not assume QLever automatically performs full OWL 2 DL reasoning.** Separate ontology development/reasoner validation from the query server. A dedicated reasoning/materialization stage will generate selected inferred triples (and corresponding provenance) for indexing and SPARQL access. Choose the supported reasoning profile explicitly after prototyping.

### 2.4 Rights and publication

The source code of a project having an MIT license does not imply that every underlying Magic card image, card text or user contribution is licensed under MIT. Review Scryfall policies, Tagger usage, Commander Spellbook terms and Wizards of the Coast's Fan Content Policy before public release. Record legal decisions in an ADR and a data licensing matrix. Prefer linking to source-hosted images rather than redistributing full copyrighted artwork; distinguish legally redistributable metadata from assets or derived material requiring restrictions. Do not publish a dataset under a blanket open license without justifying the rights to each data category.

---

## 3. Target system architecture

```text
                 source documentation + source bulk manifests
                                     |
                          [source adapters / archives]
                                     |
                 [raw immutable snapshots + checksums + manifests]
                                     |
                  [diff engine / source-level canonical records]
                                     |
                       [ontology-aligned ETL transforms]
                                     |
                   [SHACL + mapping tests + reconciliation]
                                     |
          [asserted RDF named graphs]      [normalized evidence]
                     |                              |
                     +----------[OWL materializer]--+
                                     |
                            [inferred RDF graphs]
                                     |
                           [QLever SPARQL endpoint]
                          /             |             \
                    raw SPARQL      faceted form     future QRAKEN

             Separate: provenance graph, pipeline metadata store,
             monitored update service, history/rollback store
```

Suggested implementation stack (change only with an ADR):

- Ontology/vocabularies: Turtle/OWL 2, SKOS, RDFS, OWL, PROV-O, Dublin Core Terms, SHACL; optional external vocabulary imports only when justified.
- Python 3.12+ with `uv` for ingestion/validation orchestration; `httpx`, `pydantic`, `rdflib`, `pyshacl` and CLI tooling, version-pinned.
- A small **operational** metadata database (SQLite for local development; PostgreSQL if operations warrant it) to track snapshots, hashes, batches, tombstones, jobs, cursors and applied updates. This is not a replacement for RDF.
- QLever via a reproducible Qleverfile/Docker setup, SPARQL GET/POST endpoint, admin update token isolated from public read access.
- Optional OWL 2 reasoning tools evaluated by profile: OWLAPI-compatible DL reasoner for ontology testing, rule/OWL-RL materialization for scalable ABox inferences if the axioms allow it. **No assumption that an arbitrary OWL 2 axiom is computable by a selected RL reasoner.**
- Optional lightweight web UI (e.g. React/TypeScript) backed by a read-only API adapter or tightly constrained SPARQL query templates.
- Future QRAKEN integration consuming ontology documentation, observed graph patterns, examples, endpoint contracts and read-only query interface.

---

## 4. Phase 0 — Source/domain inventory, competency questions and ontology design brief

**Goal:** produce the evidence and specifications needed to design the ontology. **No mass ETL yet.**

### 4.1 Audit source schemas (actual files + official documentation)

Create a **comprehensive Scryfall field dictionary**, not merely a list of types. For every field document:

`source endpoint/dump · JSON path · name · type · nullable/optional · sample · interpretation · identity scope (Oracle/face/printing/artwork/set/etc.) · time sensitivity · target RDF class/property · representation rationale · validation rule · potential legal constraint`.

Inspect all of the following families; add newly discovered fields instead of silently discarding them:

| Area | Fields and distinctions to examine |
|---|---|
| Identity | `id`, `oracle_id`, face-specific IDs, `illustration_id`, `set_id`, `artist_ids`, `multiverse_ids`, Arena/MTGO/TCGplayer/Cardmarket identifiers, API and source URIs |
| Card identity/game characteristics | `name`, `layout`, `cmc`/mana value, mana cost, colors, color identity, color indicator, produced mana, keywords, reserved status, legalities, type line, oracle text, power, toughness, loyalty, defense, hand/life modifiers |
| Faces and parts | `card_faces`, order and placement, face-specific Oracle text/cost/types/artists/illustrations; `all_parts`, `component`, related objects; reversible, transform, modal DFC, split, flip, adventure, meld, prototype and future layouts |
| Printing | set, collector number, language, release date, rarity, frame and frame effects, border color, watermark, finish availability, promo and promo types, booster, story spotlight, variation, oversight/oversized, game availability, security stamp |
| Printed text | translated/printed name, printed type line, printed Oracle/rules text, flavor text and flavor names; textless versions |
| Visual/editorial | art ID, art crop and face image URIs, image status/resolution, artist, art tags, visible artwork subject vs words depicted in the artwork |
| Market/distribution | price observations, purchase URIs, related external URIs, card back IDs; separate volatile/commercial attributes from persistent card identity |
| Catalogs | card supertypes, card types, per-type subtype vocabularies (creature, land, artifact, enchantment, spell, planeswalker, etc.), mechanics/keyword catalogs, formats, languages, rarities, finishes, layouts |

**Important:** `type_line` can contain overlapping-looking terms from distinct namespaces (supertype, type, subtype), and different subtypes have type-dependent validity. Do not model the whole type line as an unparsed string alone; preserve it verbatim while giving its components distinct entities and typed relations.

Also produce field dictionaries for:

- **Tagger `oracle_tags` and `art_tags`**: ids/slugs, labels/descriptions/aliases, parent and child relationships (possibly multiple inheritance), assignment records, weights and association targets. Verify the exact live export schema; do not extrapolate from third-party summaries.
- **Commander Spellbook**: variant ID, aliases, status, participating cards and quantities, generated vs editor-authored combos, templates, prerequisites, features produced/required, notes, description, colors, source IDs and status. Mark what exists only in API, not bulk.

### 4.2 Select representative examples and edge cases

Build **small versioned fixtures** for at least the following, preserving original source JSON and an expected conceptual interpretation:

1. Simple single-faced spell: Lightning Bolt.
2. Single-faced creature with printed power/toughness and a functional tag: Blood Artist.
3. Transform double-faced card.
4. **Modal** double-faced card (MDFC).
5. Split card (including an unusual mana value/type configuration).
6. Adventure card (not a double-faced physical card).
7. Flip card (not equivalent to transform DFC).
8. Meld pair and meld result, including related object identities.
9. Reversible card (exceptional face-specific Oracle identifiers).
10. A multi-faced/double-faced token or other nontraditional object.
11. A card with multiple printing artworks and/or multiple artists.
12. A printing with a different localized name/flavor text and/or special flavor name.
13. One case of mana cost absent versus zero mana cost; one variable/non-numeric power or loyalty.
14. A token/emblem/art-series/Planechase/Scheme/Vanguard object, even if excluded from the initial user-facing card collection.
15. A Commander Spellbook variant involving a template and multiple cards/features.
16. A tag with **multiple parents**, an art tag and a missing/weak assignment.
17. A modal *spell ability* ("choose one") contrasted with an MDFC: **these meanings of modal must not be conflated**; representing the former as an interpreted ability is outside v1, but the ontology must not make the terminological mistake.

Use actual fixtures fetched from current source data and record stable identifiers. Never invent sample source facts to make a test pass; synthetic examples must be clearly marked synthetic.

### 4.3 Develop competency questions and negative tests

Create `docs/ontology/competency-questions.md` with: CQ ID, user, motivation, source fields, ontology terms, expected output, SPARQL shape, required inference, baseline comparison, limitations and a small expected-answer fixture.

Examples:

- **Identity:** Which Oracle card has exactly these printings in a particular set/language? Which two printing objects depict the same illustration? Do not confuse edition and artwork.
- **Faces/layout:** Which cards have a back face of a given type; which are MDFCs rather than transform DFCs; which combine types across faces; which have an Adventure part while remaining single-sided?
- **Types:** Which cards have a subtype from the creature-type vocabulary and another from a different type-dependent vocabulary? Which labels are ambiguous without a typing context?
- **Text provenance:** Which official Oracle text was current in a particular archived observation; which flavor text belongs only to a printing; which inscriptions are observed *inside an image* rather than printed in its card text box?
- **Tag hierarchy:** Which cards have tag `X` or a qualified narrower tag, with the original assigned leaf tag and provenance shown?
- **Complementarity:** Which cards potentially provide an abstract functional affordance needed by other cards in an already documented strategy? Do not claim an executable combo.
- **Conflict:** Which cards are potentially in tension through typed resource provision/restriction annotations? Only if reliable source annotations support this inference.
- **Combo:** Which documented Commander Spellbook variants use a given Oracle card and produce a documented feature; how does that differ from a player's decklist containing the card?
- **Decklist:** What kinds of role coverage does a supplied decklist appear to have, with uncertainty explicit and no forced closed-world OWL negatives?
- **Cross-source:** Which proposed AI tags differ from Tagger for the same Oracle card, at which dates and with which evidence?
- **Update:** Which previously observed tag assignment was retracted upstream, and is the current public view consistent with that change?

Also specify **negative tests**: an Adventure is not an MDFC; a print is not an Oracle card; two cards sharing an image are not `owl:sameAs`; same visible name is not same card; a tag's absence is not a negative label; a visual-inscription tag is not flavor text.

### 4.4 Outputs and acceptance

Deliver `docs/source-audit/`, field mapping spreadsheets or Markdown/CSV, fixture source data, conceptual sketches, a schema drift risk register, `docs/ontology/design-brief.md`, and the first CQ/negative-test catalog.

**Gate 0:** ontology design can start after the source dictionaries and enough representative fixtures exist to avoid a speculative or Scryfall-JSON-shaped model.

---

## 5. Phase 1 — Ontology design (highest priority)

**Goal:** create the first as-comprehensive-as-possible, coherent, extensible, documented **new SMTG ontology**. Do **not** inherit the earlier MTG Ontology as a starting structure. It may be reviewed only as prior art and for comparison, never as an authoritative design.

### 5.1 Modeling levels: mandatory distinctions

#### A. Ontological identity and identifiers

Model separate entities for:

- `OracleCard`: abstract playable/card identity (with awareness that exceptional layouts require a nuanced Scryfall mapping).
- `CardPrinting`: an edition/language/variant-specific published representation, distinct from abstract identity.
- `CardFace`: a conceptual face/component of the abstract card.
- `PrintedFace`: face as manifested on a particular printing, with localized names, flavor text, printed typography and art.
- `Identifier`: an identifier assignment or appropriately modeled literal/URI, with a scheme/authority (`ScryfallOracleID`, `ScryfallCardID`, `IllustrationID`, `SetID`, etc.). **A string identifier is not the card itself.** Use stable opaque identifiers to mint internal URIs, not the display name.
- `CardRelatedObject`/typed relationships: meld piece, token produced, component, alternative face, variation and other source relations where substantiated.

Avoid making `CardPrinting` a subclass of `OracleCard` or asserting identity between them. An OracleCard may have many printings; a printing may have multiple printed faces.

**Identity convention proposal** (validate before fixing):

```text
https://<approved-domain>/id/oracle-card/<oracle-uuid>
https://<approved-domain>/id/printing/<scryfall-card-uuid>
https://<approved-domain>/id/illustration/<illustration-uuid>
https://<approved-domain>/id/tag/oracle/<tag-id-or-slug>
https://<approved-domain>/id/tag/art/<tag-id-or-slug>
https://<approved-domain>/id/combo-variant/<source-id>
```

Domain is deliberately a placeholder until a stable owned domain is chosen. For exceptional source identities, define dedicated mapping rules and explicit source identifier links. Do not fabricate UUIDs from card names.

#### B. Structure, faces and layouts

Separate three concerns often flattened into a `layout` string:

1. **Face configuration**: one face vs multiple conceptual faces; front/back physically vs multiple parts on the same side; order, position and orientation.
2. **Card layout/printing convention**: normal, split, flip, adventure, transform DFC, MDFC, meld, reversible, saga, class, prototype, and other source-supported layouts.
3. **Modal selection semantics**: modal double-faced card as a published layout is not identical to a spell whose ability text allows choosing modes. v1 can classify the former by authoritative layout without interpreting the latter's Oracle text.

Consider `FacePosition` or `FaceOccurrence` with order/index, side and orientation, and explicit typed relations `hasFace`, `printedFaceOf`, `appearsOnSide`, `correspondsToOracleFace`. Use qualified relation nodes where a simple binary relation loses positional or temporal information.

Design to accommodate **previously unseen layouts** without violating axioms, while maintaining a reviewed catalog of known kinds. Do not make type or layout enums artificially closed in OWL.

#### C. Card characteristic vocabularies

Separate controlled vocabularies for:

- `Supertype` (e.g. Legendary, Basic, Snow).
- `CardType` (e.g. Creature, Instant, Artifact, Enchantment, Planeswalker, Land, Sorcery, Battle, Kindred, and supported new types).
- `Subtype` under *type-qualified* schemes (creature types, artifact types, enchantment types, land types, spell types, planeswalker types, etc.). A concept can require more than one type association.
- `Color`, `ColorIdentity`, `ManaSymbol`, `ManaCost` vs `ManaValue` (historical label "converted mana cost"), `ManaProduction` (as documented by Scryfall), `Keyword` catalog, `Format`, `LegalityStatus`.
- `Power`, `Toughness`, `Loyalty`, `Defense` as lexical expressions with optional normalized numeric values *when valid*. `*`, `X`, `1+*` etc. are not malformed integers.

Preserve the raw printed/source type line as text **and** transform its actual components into explicit object relations with documented parsing provenance. A single English word can occur in distinct type/subtype schemes; use scheme-specific URIs to disambiguate. Do not assume every `skos:broader` relation is a strict OWL subclass relationship.

Colors and color identity must be modeled separately. Colorless is not automatically inferred from the absence of color triples under the open-world assumption. Do not attempt to recompute color identity from mana cost alone.

Legalities and volatile attributes should have **time-scoped source assertions/observations** rather than timeless universal properties.

#### D. Artwork and textual content

Separate:

- `Artwork` / `Illustration`: an intellectual/visual work, typically identified via `illustration_id`, which may appear in several printings.
- `ArtworkDepiction`: a semantically annotated subject, scene, object or motif **depicted in the artwork** (from Tagger art tags or later enrichment); distinguish thematic classification from a claim that a real-world person/object is depicted.
- `ArtworkInscription`: **words visibly included inside the illustration itself**, if observed and transcribed from a source. Keep source, language, text, location in image (if available), and uncertainty. **Do not confuse this with flavor text or the card's printed rules text.** Do not automatically generate OCR in v1.
- `Artist` and `ArtisticContribution`: permit multiple artists and roles if data warrants; the literal artist-name string is not equivalent to a reliably reconciled person URI.
- `CardText`/`TextExpression` by role and location: current Oracle text, language-specific printed text, flavor text, flavor name, printed name, printed type line, other editorial text. Model the relevant face/printing link and observation/version.
- Images/media assets as **digital representations** of artworks/printed faces, with source URL, crop/type and rights metadata; an image URL is not the artwork itself.

Keep art tags and Oracle tags as separate concept schemes and assignment classes; do not merge them because they have similar English labels.

#### E. Sets, publications, formats and commercial metadata

Model `Set`, `SetRelease`/publication event where needed, `Printing` in `Set`, collector number, rarity, language, availability in paper/Arena/MTGO, variations, finishes, promo type, watermark, printed frame, security stamp, product relationships (extension ready), and optionally **price observations** rather than one immutable price.

Use a time-aware legality assertion: `card / format / status / observedAt / source`. Respect Scryfall's distinctions (`legal`, `not_legal`, `restricted`, `banned`) and changing format definitions. Avoid deriving a complete Commander-legal deck from color identity alone; deck legality has other constraints and evolves.

#### F. Tags and functional knowledge

Model at least:

- `TagConcept` as SKOS concept in separate `OracleTagScheme` and `ArtTagScheme`.
- `skos:prefLabel`, `skos:altLabel`, `skos:definition`, direct `skos:broader` / `skos:narrower`; permit **multiple parents** and verify DAG/cycle behavior with actual source data.
- `TagAssignment` / `AnnotationAssertion` as a *first-class annotation event/assertion* connecting a tag, the actual target (Oracle card, face or illustration as appropriate), the source, original strength/weight (if present), observation date, human or AI method and evidence references. Avoid losing provenance by only emitting an unqualified `hasTag` triple.
- Optional materialized `hasTag` relations for convenient querying, clearly designated as a projection from first-class assertions.
- A **small curated strategic ontology module** with `StrategicRole`, `Affordance`, `Resource`, `PotentialRequirement`, `PotentialSuppression`, `StrategicPattern` and typed relations; this is separate from Tagger's descriptive vocabulary and introduced only where definitions have adequate observational support.

**Careful semantic mapping:** `tagger:removal-creature skos:broader tagger:removal` need not imply `owl:subClassOf`. For selected functional tags, map to role/affordance concepts with `skos:exactMatch` / `closeMatch` or explicit interpretation rules **after review**. Do not invent that every tag implies a `providesAffordance` relation.

#### G. Lists, collections, combos and synergies

These must be separate:

- `DeckList` / `DeckListVersion`: a documented list of cards, with author/source, format, date, notes, zones and cardinalities.
- `DeckEntry`: a reified membership with count, zone/role (commander, companion, mainboard, sideboard, etc.) and choice of Oracle card versus printing. A list is not itself a card or a combo.
- `Collection` / `CollectionEntry`: ownership/collecting is distinct from constructed deck membership; optional extension, not required as a data source.
- `ComboRecipe`: a curator-defined interaction in Commander Spellbook (only when obtainable).
- `ComboVariant`: a concrete set/multiset of required cards generated from recipes, with prerequisites, feature claims, status and source ID; templates/placeholders must remain distinguishable from concrete cards.
- `Feature`, `Precondition`, `CombinationParticipant` and, if justified by source model, `ComboTemplate`; store **textual descriptions and documented feature labels** without simulating their effects.
- `SynergyHypothesis`: an **inferred, qualified, potentially useful association**, different from a sourced `DocumentedCombo` or statistical `ObservedAssociation`. Include evidence, inference rule, confidence/limitations and scope. Do not use `owl:sameAs`, `subClassOf` or an unqualified symmetric `synergizesWith` without formal justification.
- `StrategicPattern`/`DeckArchetype` as an optional *vocabulary of patterns*, not a claim that each card has one immutable deck role.

A card's intrinsic functional tag, a deck's strategy, a documented combo and an inferred recommendation are epistemically different. The ontology must make this distinction recoverable in SPARQL.

#### H. Provenance, claims and temporal semantics

Use **PROV-O**, named graphs and qualified assertions together where appropriate:

- `SourceDataset`, `SourceSnapshot`, `ETLActivity`, `NormalizationActivity`, `AIClassificationActivity`, `InferenceActivity`, `ReviewActivity`.
- Timestamps for source publication, harvesting, derivation and replacement; distinguish source validity from observation time.
- Individual `TagAssignment` and `SynergyHypothesis` resources with `prov:wasDerivedFrom`, `prov:wasGeneratedBy`, `prov:wasAttributedTo`, method/model/rule identifier, source record key and status.
- Named graphs for source-specific asserted data and materialized inferences, plus a dedicated provenance/administrative graph.
- Assertions withdrawn upstream must be removed from the **current view** but may remain documented in a separate immutable historical record/snapshot and changelog.
- Two sources asserting identical triples must not erase the difference between their evidence. Do not rely on just one global triple with a single graph-level source citation when per-assertion provenance is required.

Prepare at least one example where Tagger asserts a tag and Jev independently proposes it at another confidence/date; SPARQL must distinguish both.

### 5.2 Reuse of standards and formal semantics

Recommended alignments:

- OWL 2 and RDFS for formal class/property semantics and justified axioms.
- SKOS for source tag/taxonomy and controlled concepts, not indiscriminate `rdfs:subClassOf`.
- PROV-O for provenance (entities, activities, agents, derivation, generation).
- SHACL for closed-world structural constraints on normalized instance graphs.
- Dublin Core Terms for appropriate bibliographic/editorial metadata (subject to ontology decisions).
- OWL-Time only if temporal relationships justify it; do not complicate v1 unnecessarily.
- External person/artwork authority linkages as optional modules; never equate identities on name alone.

A limited OWL profile (RL, EL, or a carefully constrained subset of DL) should be proposed **based on actual research inferences and benchmark data**. Record why each axiom is included, and whether the chosen reasoner supports it. Maintain a separate SHACL shapes graph and a rule/materialization manifest.

### 5.3 Required artifacts of the first ontology draft

Create:

- `ontology/smtg-core.ttl`, `smtg-cards.ttl`, `smtg-printings.ttl`, `smtg-text-art.ttl`, `smtg-taxonomies.ttl`, `smtg-tags.ttl`, `smtg-combos.ttl`, `smtg-decks.ttl`, `smtg-provenance.ttl` and optionally `smtg-strategy.ttl` (module boundaries may be revised via ADR).
- `ontology/smtg-imports.ttl` or equivalent module aggregate; coherent ontology/version IRIs and version policy.
- `shapes/*.ttl` for required fields, cardinalities, class membership, provenance links, identifying keys and versioned dimensions.
- `docs/ontology/conceptual-model.md`, class and property catalogs, diagrams (Mermaid + exported images if available), examples in Turtle/TriG, glossary and semantic anti-pattern catalog.
- `docs/ontology/scryfall-mapping.md` **complete field-by-field traceability**, plus equivalent Tagger and Commander Spellbook mapping specifications.
- `docs/ontology/competency-questions.md` and executable test queries/expected results.
- `docs/ontology/review-questions.md` containing ambiguous design issues, alternatives, consequences and recommended resolution.
- `docs/adr/` for all high-impact decisions.

Use well-written natural-language definitions for classes/properties, not just labels. Publish domain/range and disjointness **only when semantically correct**, since careless universal restrictions or global domains can create false inferences. Document every inferred relationship's intended interpretation.

### 5.4 Review iterations with human ontologists

Organize at least **three conceptual review rounds** (more if needed):

1. **Identity and bibliographic structure**: Oracle card vs printing vs face vs illustration vs text expression; unusual layouts.
2. **Type systems and semantic integrity**: supertypes/types/subtypes, modalities, names, abstract vocabularies, SKOS/OWL boundaries, reasoner constraints.
3. **Claims and extensibility**: provenance, art/content, combo/list/synergy, temporal observations, future expansions, planned inference semantics.

For each round: circulate diagrams, definitions, 5–10 real fixtures, CQ answers, counterexamples, detected inconsistencies and an explicit decision log. Store comments/resolutions in the repo. Incorporate revisions and re-run checks; schedule further reviews as necessary. External feedback is **required** for final signoff; Claude Code must not pretend to have obtained it.

### 5.5 Formal tests and approval gate

- Parse all ontology modules and shape files.
- Run an OWL reasoner on the complete TBox and small test ABox; verify logical consistency and intended class hierarchy.
- Verify key disjointness, no mistaken `sameAs`, expected domain/range behavior, and class assignment inference.
- Run SHACL against the curated example dataset, including deliberately invalid fixtures.
- Answer the CQ suite on a synthetic+real sample, comparing expected results.
- Measure field-to-ontology mapping completeness and list intentionally deferred source fields; **no silent loss**.
- Ask a human to review the types/layout corner cases, identifiers, namespace design, and negative test cases.

**Gate 1 (hard stop):** the reviewed ontology draft, mappings, fixtures, tests and outstanding issues are accepted by human ontologists and the project owner. **Only then begin production ETL implementation.**

---
## 6. Phase 2 — Confirm the mapping, then build an ETL specification and reproducible staging pipeline

**Prerequisite:** Gate 1 has been passed. No mapping code should override the approved ontology without a documented change request.

### 6.1 ETL design goals

- Deterministic, replayable and **idempotent**: same source snapshot + same ontology/mapping versions => same canonical RDF output (apart from explicitly excluded operational timestamps).
- Completely traceable from source JSON path and record ID to RDF statements/qualified assertions.
- Streaming and memory-bounded: process compressed JSONL and potentially hundreds of thousands of printing objects without loading them all into RAM.
- Loss-aware: maintain an explicit source-field disposition matrix (`mapped`, `retained raw`, `derived`, `deliberately excluded`, `unsupported`).
- Strictly preserve Oracle identity vs printing metadata vs card faces vs artworks.
- Produce human-understandable error reports for malformed records and new layouts/types rather than quietly skipping them.
- Handle additions, modifications, removals, source corrections, identifier migrations and ontology mapping version changes.
- Keep ETL deterministic and **separate AI-suggested annotations** from facts in upstream authoritative dumps.

### 6.2 Canonical data flow

```text
FETCH MANIFESTS
  -> compare upstream timestamps/version/ETag/checksums (when provided)
  -> fetch changed whole bulk snapshot if source supplies no true delta feed
  -> preserve immutable raw gzip files + source manifest + SHA-256
  -> stream and normalize records to a canonical source-specific form
  -> identify records by stable source IDs; hash canonicalized record payloads
  -> compare with previous snapshot (ADDED / MODIFIED / REMOVED / UNCHANGED)
  -> transform changed/deleted records to RDF insertions/deletions
  -> build assertion and provenance changes
  -> validate staged output (schema + SHACL + reconciliation)
  -> update current asserted graphs in QLever, or stage a new index
  -> recompute affected inference materializations
  -> consistency and CQ smoke tests
  -> mark job successful and advance stored source watermark
```

**No source-specific incremental API is assumed.** Scryfall and Commander Spellbook bulk exports can be polled for new snapshots; in the absence of a documented change feed, **the diff is computed locally by the SMTG pipeline**. Sparse REST API calls may fill documented gaps; they must not form an unnecessary per-card polling loop. A new bulk `updated_at` is a freshness signal, not proof that every record changed.

### 6.3 Connectors and initial datasets

#### Connector A: Scryfall

- Fetch the bulk manifest; record version, source `updated_at`, URI, checksum, headers, byte counts and retrieval time.
- Fetch `all_cards` for printing coverage; `oracle_cards` for reference/consistency where warranted. Import sets/catalogs from official endpoints as needed. Treat `unique_artwork` as an additional quality-check or complementary source, not a substitute for printing objects.
- Upsert abstract card identities from Oracle IDs **except layout-specific exceptions** following approved mappings. Join every printing to the correct abstract identity/face relationships.
- Extract set, type components, mana, card faces, image references, illustrations, artist identifiers, legalities, language, finishes, print variants and optional commercial observations according to ontology modules.
- Maintain per-field provenance at the granularity specified by the ontology review. Preserve source strings and original JSON for audit.
- Never assume a specific art ID, keyword or artist ID is present; model qualified missingness where needed. Do not invent an artist entity when only ambiguous text is available without documenting the reconciliation status.

#### Connector B: Scryfall Tagger

- Retrieve `oracle_tags` and `art_tags` from the current bulk manifest (when available).
- Import terms and direct hierarchy/aliases as **source vocabulary assertions**; preserve stable source IDs, not only labels.
- Import assignments as first-class annotation records with target, source, weighting if present, acquisition timestamp, original assignment ID if supplied, and mapping version.
- Avoid collapsing assignment nodes to a single unqualified card/tag triple until provenance is retained elsewhere.
- Distinguish: **Oracle/card functional tag** vs **artwork/visual subject tag**; inspect how the source identifies art-tag targets before relating them to `Illustration` entities.
- Handle taxonomy evolution: renamed labels, added/removed parents, merged tags, altered assignments, deprecation and new slugs. Do not use the English label as immutable identity.

#### Connector C: Commander Spellbook

- Fetch the gzipped bulk `variants.json.gz`, retain timestamp/version and aliases.
- Ingest only public/eligible status records according to source rules. Preserve the source's distinct IDs and model `Variant` separately from `ComboRecipe`.
- Store participating cards as qualified membership objects with quantities and any documented starting locations.
- Link curated feature labels to properly scoped `Feature` concepts; preserve prerequisites and step-by-step descriptions as **text** without turning them into executable instructions.
- Where template dependencies or source combos are available, represent their semantics accurately; mark absent underlying data as unavailable, not as nonexistent.
- Handle alias redirects, canonical ID changes, removals, status transitions and nonpublic variants.
- Do not infer that every set of cards matching a description is guaranteed to form a working combo.

### 6.4 Suggested command-line interface

Implement commands with dry-run, structured logs and resume support, e.g.:

```bash
smtg sources list
smtg sources check --source scryfall
smtg sources fetch --source scryfall --snapshot latest
smtg sources fetch --source tagger --snapshot latest
smtg sources fetch --source spellbook --snapshot latest
smtg snapshots diff --source scryfall --from SNAP_A --to SNAP_B
smtg etl transform --snapshot SNAP_B --dry-run
smtg etl validate --batch BATCH_ID
smtg etl apply --batch BATCH_ID --dry-run
smtg etl apply --batch BATCH_ID
smtg etl rollback --batch BATCH_ID
smtg reasoning materialize --scope changed
smtg reconcile --all
smtg status
```

These are **proposed interfaces**, not claims that the tools already exist. `apply` must verify environment and batch readiness; production destructive actions require the configured approval/authorization policy.

### 6.5 Dataset reconciliation

After full loads and each significant update, check:

- counts per source, class and layout; source unique IDs vs KG subject IDs;
- set and printing cardinality, cross-source Oracle ID alignment, print-to-face link completeness;
- all known tags imported with parent/child edges and assignment target IDs;
- no accidental merging of Oracle identities or artwork IDs;
- no orphaned referenced entities after removals;
- Commander Spellbook variant aliases and memberships;
- asserted graphs vs provenance graph records;
- deltas transformed exactly once and recoverable from logs.

Use equality checks where source semantics warrant it. For optional, partial or heterogeneous data, report coverage and expected gaps rather than failing on legitimate absence.

---

## 7. Phase 3 — Continuous updates, provenance and QLever deployment

**Goal:** a reliable production-grade graph whose current view can be updated without repeatedly rebuilding the complete ETL from scratch.

### 7.1 Source update policies

Maintain an explicit config file for per-source policy; initial candidates (adjust after observing source cadence and server resources):

| Source | Initial check cadence | Technique | Notable issue |
|---|---|---|---|
| Scryfall card + printing + art/tag bulk | Every 12–24 hours | Poll manifest; fetch changed snapshot; local canonical diff | Bulk manifest/version can change; some data is highly volatile |
| Commander Spellbook bulk variants | Daily | Check export timestamp/version/checksum; local diff | No documented global incremental feed; aliases/status can change |
| Sets and controlled type catalogs | Daily or alongside Scryfall refresh | API/snapshot comparison | Vocabulary evolves with new Magic releases |
| External IDs or future authority links | Source-specific | Small controlled adapters | Identity and licensing changes |
| AI/Jev enrichment | On demand or after upstream changes | Queue affected records and tag definitions | Suggestions must not overwrite Tagger facts |

No hard-coded universal polling rule. Use ETag/Last-Modified when valid, but content hashes are the robust fallback. Schedule through cron/systemd timer or a modest job runner; no need for a complex message broker until justified by load.

### 7.2 Event and snapshot state

Keep immutable source snapshots in a versioned object-store directory, with:

```text
source, source_snapshot_id, source_updated_at, downloaded_at,
source_url, content_sha256, record_count, parser_version,
ontology_version, mapping_version, ETL_batch_id, validation_report,
apply_status, last_successful_checkpoint
```

For each source record retain a stable source-record key, canonical hash, last seen snapshot, deletion/tombstone status and the RDF subjects it projects onto. A changed source record must be able to regenerate the same set of target statements and provenance objects.

### 7.3 QLever graph organization

Propose logically separate graphs, while benchmarking physical granularity:

```text
.../graph/asserted/scryfall
.../graph/asserted/tagger-oracle
.../graph/asserted/tagger-art
.../graph/asserted/commander-spellbook
.../graph/asserted/ai-proposals
.../graph/inferred/ontology-<reasoner-or-ruleset-version>
.../graph/provenance
.../graph/schema
```

**Caution:** these are logical graph names. Keeping every historical snapshot in the live query dataset may greatly increase index size, so archived snapshot graphs can live in external versioned storage while a small current provenance/history view remains online. Do not assume per-entity named graphs are performant; decide graph partition granularity by benchmark. Do not collapse to a single graph when that would destroy source distinction.

Support public SPARQL querying across the approved current graphs; expose historical/provenance queries intentionally rather than making deleted claims appear current by accident. Provide examples using `GRAPH`, `FROM`/`FROM NAMED`, and default graph policy.

### 7.4 Apply/recovery protocol

1. Produce a complete and validated change batch and a **reverse change batch** (or an equivalent restorable snapshot).
2. Validate references to source IDs; reject any unexpected large deletion wave, anomalous change count or violation of a configured change budget.
3. Apply changes via supported QLever Update/Graph Store APIs, with admin token protected and **no public write authorization**.
4. Never assume an arbitrarily large multi-request update is atomic. Test QLever's installed-version semantics; record per-operation progress; restart safely from a checkpoint. For large structural releases, prefer staging/building a new index.
5. Reconcile actual QLever graph state against the expected target-state hashes/counts and CQ smoke tests.
6. Re-materialize affected inference graphs; invalidate stale inferred statements whose supporting facts have disappeared.
7. Mark batch committed **only after** all validation and reconciliation checks pass. If failure occurs, restore the last known good state and do not advance the source watermark.
8. Periodically compact/rebuild the main QLever index; consider blue/green query servers if production availability requires avoiding brief restarts. Monitor delta triples and rebuild triggers.

Persist updates (`PERSIST_UPDATES`) only after verifying actual QLever behavior, restart recovery and disk constraints. Follow the installed QLever documentation for `qlever rebuild-index`, `REBUILD_INDEX_STRATEGY`, authorization and graph-store operations.

### 7.5 Stability, security and observability

- Read-only public SPARQL endpoint, access-controlled admin update endpoint; never expose tokens in logs, browser code or example files.
- Reverse proxy with TLS, query timeout, concurrency/memory caps, abuse control, availability checks and standardized SPARQL result formats.
- A status page or RDF metadata showing *last successful ingestion per source*, ontology version, inference version and freshness lag.
- Basic metrics: records/second, triples added/deleted, failed parses, SHACL errors, inference duration, QLever query latency, update backlog, delta triples, index rebuild state, missed scheduled runs.
- Backups of raw snapshots, operational metadata and indexed state; restore procedure tested on an independent environment.
- Monitor breaking source schema changes, lost fields and unexpected missing tag/art IDs; quarantine and alert instead of dropping them.

---

## 8. Phase 4 — OWL reasoning and strategic inference

**Important:** OWL is a formal deductive language, not a ranking algorithm and not a game simulator. A genuine contribution must be measured against the simple alternatives (joins, taxonomy expansion, rules and tag combinations) rather than assumed.

### 8.1 Separate asserted, normalized and inferred knowledge

Three distinct stages should be visible:

1. **Source claim:** `Tagger says card C has tag T` (with source, time, strength).
2. **Normalized interpretation:** `tag T corresponds to strategic role R`, where the mapping has a reviewed meaning.
3. **OWL consequence:** `C belongs to a functionally defined class` or `C potentially supports D` from a formally valid axiom or chain.

Keep separate **confidence and authority** for sourced, heuristically normalized, AI-proposed, and OWL-entailed assertions. A logical entailment is certain *given its premises*; the premises can still be incomplete or mistaken. Avoid assigning a pseudo-probability to OWL entailment itself.

### 8.2 Candidate inference modules

**Module A — Controlled taxonomy expansion**

Selected tags map to broader roles and consistent type/feature interpretations. SKOS hierarchy traversal is useful, but **not by itself a compelling scientific novelty**. Track it as a baseline.

**Module B — Role and affordance-based classification**

E.g. classify `CandidateSacrificeSupportCard`, `GraveyardValueCard` or `PotentialTokenStrategyContributor` from a combination of imported functional annotations and reviewed ontology axioms, not from text parsing.

**Module C — Potential complementarity and conflict**

Only after the source tags have a sufficiently precise mapping to a constrained vocabulary of `offers`, `requires`, `benefitsFrom`, `suppresses`, **with relevant scope** (self/opponents/all, resource type, possible conditions). Property chains can then derive `potentiallySupports` or `potentiallyConflictsWith`, clearly understood as **hypotheses**. Do not assert that these are exact gameplay predictions.

Test whether an inferred pair needs independent facts or merely shares a popular tag. Do not mark general potential support as transitive without a proof that the intended semantics warrants it.

**Module D — Decklist archetype profiles**

On user-provided or licensed decklists, use `some` and valid cardinality restrictions for positive class membership where sufficient evidence exists. For missing roles, counts, constraints and negative conclusions use SPARQL/SHACL or an explicitly closed complete list, not default open-world OWL inference.

**Module E — Knowledge quality and identity validation**

Disjointness and carefully reviewed identities can identify inconsistent mappings. OWL inconsistency checking is not a substitute for SHACL validation. `owl:hasKey` should be used only after validating identity schemes and special face/layout cases; aggressive `owl:sameAs` is particularly dangerous.

### 8.3 Inference materialization engine

- Select a **specific supported OWL profile / subset**. Define its axiom vocabulary and reasoner implementation in ADR.
- Run TBox consistency checks separately from scalable ABox inference. Pilot materialization on representative fixtures and a measurable subset before the full corpus.
- Write inferred triples to a dedicated named graph (or versioned graph), not into the source asserted graph.
- Maintain a machine-readable `inference-rule-catalog.md` that describes each inferred property, axioms, CQ, justification pattern, caveats and expected false-positive risks.
- When a supporting tag or mapping disappears, recalculate **affected inferences** or safely rebuild that module's inferred graph. Do not leave stale implications.
- Where a reasoner does not expose detailed proof traces, an adjacent explanation service may reconstruct supporting assertions for **specific, documented patterns**. Do not claim to have an exact OWL derivation if the system can only produce an approximate explanation.
- Test property chain syntactic correctness and OWL profile compliance; benchmark performance on the real data volume.

### 8.4 Example research-level competency questions

- Which cards are potentially useful to a selected strategy **despite having no direct strategy tag**, because they supply a capability that a documented participant consumes?
- Which less-common cards satisfy a reviewed abstract function supported by multiple narrower Tagger concepts, and what is the explanation chain?
- Which two cards have a **potential** antagonism due to source-supported resource restrictions, and how do player/opponent scopes affect that result?
- For a given decklist, which strategic pattern classes can be *positively established*, and which role requirements can **not yet be established** from available evidence? Keep these distinct from formal negative conclusions.
- How often do the ontology-derived suggestions agree with / differ from documented combos and frequency-based recommendations? Which disagreement classes represent true discoveries rather than false positives?

### 8.5 Enrichment via Jev / other LLMs (optional and later)

This is an **enrichment** stage, never a prerequisite for the first public graph:

1. Identify the subset of functional Tagger tags worth interpreting and evaluate its semantic coverage.
2. Generate candidate missing labels using existing Tagger hierarchies, text similarity or a multilabel classifier; avoid the naïve full `cards × all tags` Cartesian product.
3. Use Jev or another model for batched, bounded binary classification (or a benchmarked equivalent), based on Oracle text and authoritative characteristics, not on hidden inferred labels.
4. Use independent gold samples; report per-tag precision, recall, F1, calibration, coverage and false-positive classes. **Unknown/missing Tagger tags are not negative ground truth.**
5. Store as `AIAnnotationProposal`, including model/version, prompt/version, timestamp, confidence and supporting text, distinct from Tagger assignments.
6. Only promote proposals into the source-independent normalized tag layer under an explicit acceptance policy. For exploratory inference, include/exclude AI proposals via separate materialized graph configurations.

No hard requirement that Jev or a frontier model be installed or available; the pipeline should run without paid AI services.

---

## 9. Phase 5 — Query product: QLever endpoint and structured frontend

### 9.1 Public SPARQL endpoint

Deliver:

- A documented HTTPS SPARQL endpoint using QLever.
- A QLever UI/workbench or compatible query editor with syntax assistance and curated query examples.
- Public schema/ontology URI(s) and downloadable ontology Turtle; machine-readable VoID/DCAT-style dataset metadata as appropriate.
- Clearly stated **default graph policy**, named graph provenance semantics, active snapshot time, ontology version and inference freshness.
- Query limits/security policies and documentation for external consumers.
- Reproducible deployment and a one-command developer bootstrap using small fixture data.

### 9.2 Faceted / structured search interface

Offer a progressively enhanced frontend that is usable without knowing SPARQL. Core features:

- Name/Oracle text/full-text search (depending on indexed capabilities and implementation).
- Filter by color vs color identity, mana value, type/supertype/subtype (with taxonomy traversal), legalities, set/release date, printing, artist, illustration, flavor text, layout, face properties and keywords.
- Explicit **AND / OR / NOT**, grouped conditions, range restrictions, existential conditions (e.g. *has a printing illustrated by X*) and per-face filters. **For `NOT`, use an explicit closed-world query interpretation (`FILTER NOT EXISTS`) and document how incomplete data affects the results**; do not present it as OWL proof of negation.
- Toggles for direct vs inherited tags and Tagger vs AI annotations.
- Combo participant/feature filters, only for documented variants or clearly labeled inferred hypotheses.
- "Why is this result here?" explanation of matched metadata, tag/source mapping and (where available) the formal inference justification.
- Distinct **Card** and **Printing** result views; a card page can show all printings, faces, artworks, source links, annotations, combos and provenance.
- Show the **generated SPARQL** behind every advanced search, with copy and optional opening in the query editor.
- Pagination, stable sorting, export of result tables (CSV/JSON), bookmarks/shareable query URLs, accessible keyboard navigation and mobile layout.

Initial implementation can start with only those filters grounded in approved ontology and indexes. Do not promise unavailable features or compute heavy aggregate queries per keystroke.

### 9.3 Future QRAKEN integration

Treat this as a **separate later workstream** leveraging the user's QRAKEN system, not a prerequisite for the ontology or endpoint.

Integration plan:

- Provide QRAKEN a compact catalog of ontology classes/properties, namespace descriptions, observed graph patterns and canonical sample SPARQL queries.
- Expose a controlled read-only QLever endpoint to its query executor.
- Use QRAKEN's existing iterative syntax/vocabulary/structural query validation methodology; adapt only where needed to SMTG-specific named graphs and SPARQL features.
- Test cross-source joins, card/printing identity, tag hierarchy traversal, aggregates and time-scoped provenance on a golden question set.
- Keep model-generated answers and SPARQL query evidence inspectable; no write permissions and no fabricated inferential facts.

---

## 10. Phase 6 — Evaluation and scientific publication

The research narrative should not rest on "RDF can represent a JSON field" or "OWL can infer a card was illustrated by the artist shown on its printing". Those are foundational engineering, not the main contribution.

### 10.1 Baselines and ablations

| System | What it tests |
|---|---|
| Scryfall advanced search / REST API | What users can already do without a new KG |
| Source JSON + scripting / conventional SQL | Whether SPARQL's expressivity adds something beyond ordinary integration |
| RDF/SPARQL, no inferencing | Added value of explicit linking and relational querying |
| RDF + SKOS expansion only | Gain from simple tag hierarchy matching |
| RDF + OWL module | Incremental gain from justified class axioms/property chains |
| RDF + optional AI annotations | Incremental gain and errors from enrichment |
| Frequency-based recommender where accessible (e.g., EDHREC's published interface) | Quality/popularity tradeoffs relative to inductive recommendations |

Do not assume EDHREC's exact ingestion window, filtering policy, or algorithmic behavior. **Verify current official claims**; EDHREC's lift metric is intended in part to surface non-obvious associations. Avoid a strawman comparison. If no research-permitted dataset/API is available, evaluate against openly accessible results/sampled outputs and state limits explicitly, or use an alternative frequency-based baseline on a separately licensed corpus.

### 10.2 Required evaluations

**Ontology quality:** expressivity, semantic coherence, clarity, modularity, reuse of standards, human review agreement, TBox consistency, constraint coverage, robustness to new terms and layouts, ability to answer designed CQs.

**Mapping/ETL fidelity:** field coverage, identity resolution precision, source-vs-RDF count reconciliation, treatment of face/layout exceptions, provenance completeness, source update correctness, retraction/rollback reliability.

**SPARQL value:** number and complexity of practically useful CQs resolved across sources, comparisons with source interfaces/SQL, reusability and portability, measured latency and cost on the same workloads.

**Reasoning value:** unique *useful* inferred classifications/pairs, precision/recall where a gold standard exists, expert assessment of soundness, evidence traceability, sensitivity to different tag hierarchies/mappings, scalability and false-positive analyses.

**Recommendation value:** blind-spot discovery on underrepresented/new/old cards, recommendation novelty vs validity, user/expert satisfaction, effectiveness of explanations, control for popular staples, formal comparison against tag matching and frequency-based approaches. **Novelty alone is not quality.**

**Maintained KG quality:** time from upstream source update to published graph, missing or stale assertions, ability to reproduce historical snapshots, zero-data-loss recovery and documented rights.

### 10.3 Benchmark construction

- Set aside **unseen test cards** (including new and low-frequency cards) and diverse sets/eras/layouts.
- Construct expert-labeled positive/negative/uncertain card-pair cases for compatibility; use context-dependent cases, not only obvious combos.
- Use Commander Spellbook as **one curated positive evidence source**, not as a complete ground truth for every meaningful strategic synergy.
- Compare a direct Boolean role-match baseline to progressively richer ontological modules; include adversarial cases such as scope mismatch, self-only effects and conditional resource availability.
- For decklist recommendation, avoid training/testing on effectively identical decklists and avoid time leakage: an earlier snapshot should predict or recommend into a later one.
- Report confidence intervals or uncertainty where sample sizes justify them; publish exact experimental configuration, versioned datasets or permissible derived aggregates, queries and code.
- Log and publish ontology/rule changes between rounds; no retroactive alteration of the held-out evaluation to make results look better.

### 10.4 Scientific outputs

Possible papers/work packages:

1. **Ontology engineering + LOD infrastructure:** an empirically evaluated identity-aware, modular and provenance-rich Semantic MTG ontology and maintained endpoint.
2. **Explainable strategic inference:** deductive inference over a sourced, curated functional vocabulary; assessment of which kinds of inference are genuinely useful without modeling card execution.
3. **Symbolic vs inductive recommendation:** controlled study of knowledge-based vs frequency-derived recommendations, especially for long-tail, newly released or historically neglected cards; present strengths and weaknesses of both approaches fairly.

Publication assets should include ontology, shapes, schema mappings, query benchmark, example outputs, reasoner tests, ETL and update system, deployment instructions and reproducibility/licensing statement.

---

## 11. Proposed repository layout

Adapt if an existing repository already has conventions, but maintain these responsibilities:

```text
semantic-mtg/
├── README.md
├── PLAN.md                         # this master plan
├── pyproject.toml                  # CLI/ETL/reasoning tooling
├── uv.lock
├── .env.example                   # safe placeholder values only
├── docker-compose.yml
├── Qleverfile
├── ontology/
│   ├── smtg-imports.ttl
│   ├── smtg-core.ttl
│   ├── smtg-cards.ttl
│   ├── smtg-printings.ttl
│   ├── smtg-text-art.ttl
│   ├── smtg-taxonomies.ttl
│   ├── smtg-tags.ttl
│   ├── smtg-decks.ttl
│   ├── smtg-combos.ttl
│   ├── smtg-provenance.ttl
│   └── smtg-strategy.ttl
├── shapes/                         # SHACL
├── mappings/                       # source field -> RDF specs + code mapping config
├── src/smtg/
│   ├── cli.py
│   ├── sources/{scryfall,tagger,spellbook}.py
│   ├── snapshots/
│   ├── diff/
│   ├── transform/
│   ├── provenance/
│   ├── validate/
│   ├── qlever/
│   ├── reasoning/
│   └── operations/
├── queries/
│   ├── competency/
│   ├── examples/
│   ├── validation/
│   └── evaluation/
├── fixtures/
│   ├── scryfall/
│   ├── tagger/
│   ├── spellbook/
│   ├── expected-rdf/
│   └── invalid-rdf/
├── tests/
│   ├── ontology/
│   ├── source_adapters/
│   ├── etl/
│   ├── delta/
│   ├── provenance/
│   ├── reasoning/
│   └── integration/
├── frontend/                       # deferred until endpoint is stable
├── deployments/                    # local/staging/production
├── docs/
│   ├── STATUS.md
│   ├── adr/
│   ├── source-audit/
│   ├── ontology/
│   ├── operations/
│   ├── api/
│   ├── science/
│   └── licensing/
└── data/                           # large/raw data ignored by git
    ├── raw/
    ├── canonical/
    ├── rdf/
    ├── reports/
    └── checkpoints/
```

Raw Scryfall bulk dumps and full generated KG exports should **not** automatically be checked into Git. Store small legally appropriate fixtures under `fixtures/`; larger datasets are versioned in data storage with manifest and hashes. Provide scripts/Make targets to recreate and verify them.

---

## 12. Work packages, stage gates and completion definition

| Phase | Main outputs | Gate to proceed |
|---|---|---|
| 0. Audit | source field dictionaries, real fixtures, CQs, negative tests | enough evidence to design the model |
| **1. Ontology draft** | modular OWL, vocabularies, SHACL, mapping specs, diagrams, tests | internal coherence and human review rounds |
| **1R. Ontologist review** | decisions, fixes, accepted design version | **explicit owner + human ontologist approval** |
| 2. ETL | reproducible bulk ingestion and mapping, provenance, local diff, validated RDF | fidelity and source-reconciliation tests |
| 3. QLever + updates | indexed dataset, SPARQL endpoint, periodic updates, rollback, monitoring | operational reliability and semantic correctness |
| 4. Reasoning | evaluated inference modules, materialized inferred graphs, explanations | benchmarked precision and honest limitations |
| 5. Frontend | usable structured search, saved queries, card/printing pages | usability and query correctness |
| 5B. QRAKEN (optional) | natural-language SPARQL querying, grounded explanations | independent NL-to-SPARQL evaluation |
| 6. Scientific evaluation | baselines, ablations, benchmarks, paper materials | reproducibility and defensible claims |

### Hard requirements for v1 public release

- [ ] Approved ontology and stable namespace / ontology version.
- [ ] OracleCard, CardPrinting, CardFace and PrintedFace **consistently distinct**.
- [ ] Type/supertype/subtype schemes correctly represented and validated on real edge cases.
- [ ] Layout/face/artwork/Oracle-text/flavor-text/visual-inscription distinctions documented and, where data exists, represented.
- [ ] No source fields silently dropped; all field dispositions documented.
- [ ] Scryfall card/printing and Tagger tag/taxonomy ingest complete to declared coverage scope.
- [ ] Commander Spellbook public variants correctly linked at the Oracle-card level, without false identification of recipe and variant.
- [ ] Provenance queries distinguish source assertions, normalized terms and AI/inferred proposals.
- [ ] QLever endpoint responds to a curated CQ suite with correct current graph semantics.
- [ ] Source update checker, local diff, idempotent application, retraction and rollback actually tested.
- [ ] OWL/SHACL validation and regression test suites pass on representative fixtures and current data.
- [ ] Clear user-facing documentation, source attributions, rights review and data publication terms.
- [ ] Scientific baselines / limitations documented, avoiding claims of inherently superior recommendations.

### Definition of done for every substantial implementation item

A task is not complete unless it has (a) working code/data/ontology artifact, (b) an automated regression test or a defensible reason it cannot be automated, (c) documented source/provenance and mapping impact, (d) any updated diagrams/docs/ADR, and (e) a concise result and next-step note in `docs/STATUS.md`.

---

## 13. First Claude Code work session: concrete instructions

**Do this first, in order.**

1. Inspect repo state, current project files, language/runtime/tooling, and source availability. Create/update `docs/STATUS.md`.
2. Build an **authoritative source reference ledger**, with live URLs and access date for Scryfall Bulk Data, Scryfall `api-types`, Scryfall Tagger datasets, Commander Spellbook bulk/API/domain model, QLever update/index docs and W3C standards.
3. Produce the **Scryfall JSON field dictionary and layout matrix**, explicitly separating Oracle identity, all printings, faces and illustrations. Call out `reversible_card`, `modal_dfc`, split/adventure/flip/meld and other edge cases.
4. Inspect Tagger vocabulary and assignment schema and identify how `parent`/`child`, Oracle tags, art tags, targets and annotation weights are actually represented. Produce the Tagger field dictionary and a *sample* hierarchy visualization.
5. Inspect Commander Spellbook's current bulk structure and model, distinguishing generated variants, editor-authored combos, features, templates and aliases. Produce mapping risks and fixture examples.
6. Draft a **conceptual ontology diagram**, module plan, namespace/URI proposal and class/property inventory, with definitions and at least 10 semantic anti-patterns to avoid.
7. Draft 20+ specific competency questions, including functional, provenance, cross-source and negative scenarios. Explain which require SPARQL, OWL, SHACL or external statistical algorithms.
8. Create the first modular Turtle ontology and SHACL shapes; validate on real small fixtures and run an OWL reasoner on the TBox.
9. Document all significant uncertainties in `docs/ontology/review-questions.md`, organize the first human-review packet and **pause for feedback**.

**At the end of this first session, the expected deliverable is a defensible ontology draft and review packet, NOT a functioning production KG.**

### Important questions for human ontology review

- What exactly is a `Card` in this ontology versus a Scryfall Oracle identity? Is a reversible publication best treated as multiple Oracle identities joined by a packaging relationship?
- Which properties belong to an abstract face, a physical printed face, or a temporally versioned text expression?
- Should layout names be modeled as a SKOS scheme, formal OWL subclasses, or both (with mappings)? How do we avoid confusing modal DFCs and modal abilities?
- How should type/subtype applicability and overlapping names across subtype schemes be formalized?
- When does artwork identity rely on Scryfall `illustration_id`, and when is a separate representation/artwork/depiction entity required?
- How should unknown visual inscriptions and not-yet-annotated art subjects be represented without inventing facts?
- Which published Tagger parent-child relationships support only SKOS hierarchy versus strong logical subsumption?
- How should data from independent sources support the same tag/role without collapsing source provenance?
- Where is the boundary between an authoritative documented Commander Spellbook combo variant and an independently inferred candidate synergy?
- What are the computationally justified OWL 2 axioms / profiles and how will inferences be materialized for QLever?
- Which source facts can safely be asserted as timeless and which require snapshot/version qualification?
- What constitutes a valid semantic-change/deprecation strategy as Magic introduces novel card types or layouts?

---

## 14. Authoritative references and resources to verify

These are starting points, not immutable endpoint contracts; recheck at the time of implementation.

### Source schemas and data

- Scryfall API overview: <https://scryfall.com/docs/api>
- Scryfall bulk-data manifest: <https://api.scryfall.com/bulk-data>
- Scryfall official comprehensive TypeScript API definitions: <https://github.com/scryfall/api-types>
- Scryfall card/face type structure: <https://github.com/scryfall/api-types/blob/main/src/objects/Card/Card.ts>
- Scryfall field definitions: <https://github.com/scryfall/api-types/blob/main/src/objects/Card/CardFields.ts>
- Scryfall layout documentation: <https://scryfall.com/docs/api/layouts>
- Scryfall API access/rate-limit guidance: <https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17>
- Scryfall Tagger: <https://tagger.scryfall.com/>
- Third-party published snapshot useful for studying Tagger hierarchy (not the canonical upstream): <https://huggingface.co/datasets/kasper-cbx/mtg-search-index>
- Commander Spellbook bulk variants: <https://json.commanderspellbook.com/variants.json.gz>
- Commander Spellbook API docs: <https://spacecowmedia.github.io/commander-spellbook-backend/api.html>
- Commander Spellbook domain model: <https://spacecowmedia.github.io/commander-spellbook-backend/domain-model.html>
- Commander Spellbook codebase: <https://github.com/SpaceCowMedia/commander-spellbook-backend>

### Query engine and standards

- QLever documentation: <https://docs.qlever.dev/>
- QLever SPARQL Update and Graph Store operations: <https://docs.qlever.dev/update/>
- QLever index rebuild: <https://docs.qlever.dev/rebuild-index/>
- QLever configuration and persisted update deltas: <https://docs.qlever.dev/qleverfile/>
- OWL 2 Overview: <https://www.w3.org/TR/owl2-overview/>
- SKOS Reference: <https://www.w3.org/TR/skos-reference/>
- PROV-O: <https://www.w3.org/TR/prov-o/>
- SHACL: <https://www.w3.org/TR/shacl/>
- SPARQL 1.1 Query: <https://www.w3.org/TR/sparql11-query/>
- SPARQL 1.1 Update: <https://www.w3.org/TR/sparql11-update/>

### Scientific and methodological comparison

- EDHREC published explanation of the 2026 lift transition: <https://edhrec.com/articles/changelog-replacing-synergy-with-lift-on-edhrecs-card-pages>
- MTGJSON (useful additional source/model benchmark, not automatically an initial ingest dependency): <https://mtgjson.com/>
- Magic Comprehensive Rules (authority on meaning of card types, characteristics and layout as relevant; **not** an instruction to model execution in v1): <https://magic.wizards.com/en/rules>

---

## 15. Short project charter

> **Semantic Magic: The Gathering** will develop a rigorously reviewed ontology and a continuously maintained RDF knowledge graph that disentangles card identity, printings, faces, art, text, editorial metadata, controlled vocabularies, sourced annotations and documented combinations. The graph will integrate Scryfall, Scryfall Tagger and Commander Spellbook with explicit provenance, expose them via a QLever SPARQL endpoint, and evaluate structured cross-source queries and carefully bounded OWL inferences. Its distinctive research aim is to test whether a transparent symbolic representation of functional knowledge can produce useful, explainable discoveries and complement frequency-based recommendations **without formalizing the rules needed to execute games of Magic**. Ontology design and human review must be completed before any full-scale ETL is implemented.
