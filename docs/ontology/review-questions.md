# Review questions

Open design questions for human ontologists. Each has an ID referenced from the ontology
(`smtg:reviewQuestion`), the current **draft choice**, the alternatives, and what changes if we
switch. Nothing here is decided; the draft choice is only what the TTL currently does.

Please answer by opening an issue (template *Concept change* or *Radical proposal*), by leaving a
suggestion on the term's page in review mode (`npm run docs:serve`), or by adding a proposal module
under `proposals/`. Resolutions get recorded as ADRs.

Review rounds (PLAN §5.4): **R1** identity & bibliographic structure · **R2** type systems & semantic
integrity · **R3** claims, provenance & extensibility.

---

## R1 — Identity and bibliographic structure

### RQ-ID-1 — What is a "card" for reversible printings?
*Draft:* A reversible printing (`printingLayout reversible_card`) `isPrintingOf` the Oracle card(s)
named by the face-level `oracle_id`s, so one or two Oracle cards. In the fixtures both sides of Jinnie
Fay and Ghalta carry the *same* Oracle ID, so the printing manifests one Oracle card twice (see
CQ-ID-05).
*Alternatives:* (a) a `PackagingRelation` between two printings; (b) treat each side as a separate
printing resource.
*Consequence:* (b) breaks the 1:1 mapping between printing resources and Scryfall card IDs.

### RQ-ID-2 — Oracle card for non-traditional objects
*Draft:* Tokens, emblems, planes, schemes, vanguards, art cards and front cards are all
`smtg:OracleCard`, distinguished by `smtg:hasObjectKind`.
*Alternative:* separate top-level classes (`TokenDefinition`, `Emblem` …), with OracleCard reserved
for deck-legal cards.
*Question:* Is "Oracle card" the right umbrella term, or should it be `GameObjectDefinition`?

### RQ-ID-3 — Qualified identifiers vs plain literals
*Draft:* Identifiers are `smtg:Identifier` nodes (value + scheme). That is verbose: Lightning Bolt
alone yields dozens of identifier nodes (multiverse, MTGO, Arena, TCGplayer, Cardmarket …).
*Alternative:* one datatype property per scheme (`smtg:scryfallId`, `smtg:arenaId` …), plus
qualified nodes only where provenance is needed.
*Consequence:* simpler queries, but we lose a uniform "list all identifiers with their authority" pattern.

### RQ-CF-1 — Every Oracle card has at least one face
*Draft:* Single-faced cards get one `CardFace` (index 0), so all characteristics (name, cost, type
line, Oracle text, P/T) are always on faces and a query never needs to branch on layout.
*Alternative:* characteristics on the OracleCard for single-faced cards, on faces otherwise (this is
what Scryfall's JSON does).
*Question:* Is the extra node per card acceptable? It roughly doubles the node count for normal cards.

### RQ-CF-2 — Lexical and numeric P/T, loyalty, defense
*Draft:* `powerText` (always) plus `powerValue` (only when numeric).
*Alternative:* a reified `CharacteristicValue` node with lexical form, numeric value and a
"variable" flag.

### RQ-CF-3 — Where does "object kind" come from?
*Draft:* derived from the layout code (token, emblem, planar …), otherwise "traditional card".
Dungeons, attractions, stickers and contraptions need a better rule (type line, set type).

### RQ-CF-4 — Meld and all_parts
*Draft:* `PartRelationship` (qualified) plus the projection `meldsInto`. Scryfall `all_parts` points
to *printings*; the prototype resolves them to Oracle cards only when the target printing is
present (129 references in the fixtures are reported unresolved, not guessed).
*Question:* should `PartRelationship` link printings (as the source does) or Oracle cards (as the
game does), or both?

## R1 — Layouts

### RQ-LY-1 — Layout as SKOS concept vs OWL class
*Draft:* both. Layout codes are open SKOS concepts (`smtgv:layout/*`); a few layouts also define an
OWL class through `owl:hasValue` (`ModalDoubleFacedCard ≡ OracleCard ⊓ ∃hasLayout.{modal_dfc}`).
Because `hasLayout` is functional and the layout concepts are `owl:AllDifferent`, these classes are
**provably disjoint**. HermiT confirms it: the fixture `invalid-owl/adventure-and-mdfc.ttl` is
inconsistent.
*Question:* is functional `hasLayout` too strong if Scryfall ever assigns different layouts to
printings of the same Oracle card?

### RQ-LY-2 — Printing layout vs game layout
*Draft:* `smtg:hasLayout` (Oracle card, game-relevant) and `smtg:printingLayout` (printing, as
published). They differ for `reversible_card` and possibly `art_series`.

### RQ-LY-3 — New layouts arriving without notice
Observed in the 2026-11-03 snapshot and absent from the plan: **`prepare`** (Secrets of Strixhaven:
a creature face plus a spell face; "while prepared you may cast a copy of its spell") and
**`front_card`** (291 non-game memorabilia front cards). Both were absorbed as new vocabulary concepts
with status *unstable*, without changing any class axiom (ADR-0004).
*Question:* should the generator fail the build on unknown codes (strict), or warn and continue as
it does now?

## R2 — Type systems and semantic integrity

### RQ-TY-1 — Same word, different subtype schemes
*Draft:* every subtype is a concept in a type-qualified scheme
(`smtgv:creature-type/elf`, `smtgv:land-type/forest` …). The parser picks the scheme that applies to
the face's card types (Rule 205.3; creature types also apply to Kindred).
*Question:* do we also want a SKOS `related` link between homonymous subtypes across schemes?

### RQ-TY-2 — Type-line words outside the catalogs
`docs/source-audit/type-line-residue.json` lists 176 subtype words and about 20 left-hand words that
are not in Scryfall's catalogs. They are mostly **planar types** (Dominaria, Ravnica, "Las Vegas" …)
plus Un-card jokes; the left-hand words are mostly `Card`, `Stickers` and old `Summon`. They are kept
as `smtg:OtherSubtype` (status *unstable*), not dropped. Multi-word planar types are currently split
incorrectly ("Las" + "Vegas"): we need a planar-type catalog or a curated list.

### RQ-TY-3 — Keywords vs ability words vs keyword actions
Scryfall's `keywords` array mixes keyword abilities, keyword actions and ability words. The draft
resolves each value against the catalogs, in the order ability, action, ability word, flavor word.
*Question:* should a card's keyword list also record which catalog matched (provenance of the
normalization)?

### RQ-TX-1 — Versioning of Oracle text
*Draft:* `OracleText` nodes are minted per snapshot (`…/oracle-text/<snapshot>`), so errata produce
new nodes and the old ones stay in history graphs.
*Question:* is a per-snapshot node acceptable, or should identical text across snapshots be one
node observed in many snapshots (hash-based IRIs)?

### RQ-AR-1 — Illustration identity
*Draft:* Scryfall's `illustration_id` is the identity of an illustration. Census: 57,043 distinct
illustration IDs; **2,670 illustrations appear on more than one Oracle card**. Most are art-series
and front cards, but 44 are pairs of ordinary cards (e.g. *Strip Mine* / *Burrowing*), so artwork
identity really is independent of card identity. Where the ID sits depends on the layout: faces
only for transform, MDFC, art series and reversible printings; both root and faces for split,
adventure, prepare and flip. 558 normal printings have no illustration ID at all. CQ-ID-02 lists
illustrations shared by several printings in the fixtures.

### RQ-AR-2 — Art tags vs depictions
*Draft:* art-tag assignments are thematic classification (belief, community-curated);
`ArtworkDepiction` is reserved for claims that a *specific subject* is shown. Which art tags (for
example character tags such as *rashida scalebane*) can be mapped to depictions?

### RQ-AR-3 — Unknown inscriptions
*Draft:* inscriptions are only recorded when transcribed by an identified source; absence means
"not transcribed". Do we need an explicit `NoInscriptionObserved` claim for reviewed artworks?

## R3 — Claims, provenance and extensibility (DEC discussion)

### RQ-TG-1 — What does a Tagger parent link mean?
*Draft:* `smtg:taggerParent`, deliberately **not** `skos:broader` and **not** transitive. An opt-in
view (`views/smtg-tags-skos-view.ttl`) makes it `skos:broader`, which brings
`broaderTransitive` with it.
*Evidence from the data:* for Oracle tags the link behaves like **implication between card sets**.
Lightning Bolt's tag *burn any* has the parents *burn creature*, *burn player*,
*burn planeswalker* and *burn battle*: anything that can burn any target can burn each of them
(CQ-TG-03). For art tags it mixes kinds of link: a character tag such as *rashida scalebane* has
five parents (species, role, plane …).
*Second piece of evidence:* across about 577k checks, Tagger **never** assigns a parent tag to a
target that already carries the child tag; the export lists only the most specific tag. Tagger
therefore expects hierarchical inclusion at query time. "Cards tagged X" in Tagger's own sense
needs closure over the hierarchy, even though the closure is never materialised.
*Options:* (a) keep the raw edge only; (b) oracle-tag parents ⇒ `skos:broader`, art-tag parents ⇒
`skos:related` unless curated; (c) DEC: inherited tags become **beliefs of reduced strength**.
That would be a doxastic weakening along the chain rather than a transitive entailment.

### RQ-TG-2 — Multiple inheritance at scale
711 of 4,601 Oracle tags and 5,122 of 11,828 art tags have more than one parent. Both hierarchies
are acyclic in the 2026-11-03 snapshot (checked; see *Source audit*). Should SMTG fail ingestion if
a cycle ever appears, or keep the edges and mark the cycle?

### RQ-TG-3 — Is the absence of a tag informative?
*Draft:* no. Tagger coverage is incomplete, so the absence of an assignment is never a negative
label (AP-05). Negative filters in the UI must be presented as closed-world queries
(`FILTER NOT EXISTS`) with a caveat.

### RQ-TG-4 — AI proposals
*Draft:* `AIAnnotationProposal ⊑ TagAssignment`, with epistemic status *machine-proposed* and stored
in a separate graph. Should AI proposals share the TagAssignment class at all, or be a sibling under
`Claim`?

### RQ-CL-1 — Epistemic status and attitude: labels or semantics?
*Draft:* `hasEpistemicStatus` (authority behind the claim) and `hasAttitude` (knowledge-claim /
belief / conjecture / hypothesis) are SKOS concepts **without formal semantics**. Current defaults:

| Claim | Epistemic status | Attitude |
|---|---|---|
| Legality reported by Scryfall | authoritative-report | knowledge-claim |
| Tagger assignment | community-curated | belief |
| Price, EDHREC rank | statistical-observation | (none) / belief |
| Spellbook variant | community-curated | (open) |
| Synergy hypothesis | rule-derived | hypothesis |

*For DEC:* should attitude be a property of the claim, as now, or of the *agent's relation* to the
claim (agent A believes p, agent B conjectures p)? The second needs a claim–attitude–agent triple
pattern.

### RQ-CL-2 — How should claim content be represented?
*Draft:* the qualified-relation pattern (the claim's own properties carry its content).
*Alternatives:* RDF 1.2 triple terms (`<<( :card smtg:hasTag :tag )>>`), named graph per claim
(nanopublication style), or a DEC-native encoding. Supporting the chosen QLever version is a
precondition.

### RQ-CL-3 — Conflicting claims
*Draft:* conflicts are data (`smtg:conflictsWithClaim`), not OWL inconsistencies. Disjointness
axioms are reserved for structural impossibilities (a printing cannot be an Oracle card).
*Question for DEC:* can a doxastic reasoner keep inconsistent beliefs from different agents
side by side, with consistency checked per agent?

### RQ-CL-4 — What do Tagger weights mean?
Observed: Oracle taggings are almost all *median* (239,296), very_strong 629, strong 1. Art taggings:
median 491,612, strong 6,072, **weak 4,718**, very_strong 2,723. So weight carries information
mostly at the extremes.
*Options:* (a) ordinal only (draft); (b) thresholds, e.g. "only ≥ strong counts as evidence";
(c) a mapping to degrees of belief for DEC. Any numeric mapping must be explicit and reviewed,
never implied.

### RQ-PV-2 — One claim per snapshot, or one claim observed in many?
*Draft:* a claim resource is keyed by its content (tag + target) and gets `observedIn` for each
snapshot where it appears. Weight changes produce a new claim that `supersedes` the old one.

### RQ-PR-4 — Is legality really an Oracle-level fact?
The census shows that every Oracle-level field is identical across all printings of an Oracle ID,
with one exception: **`legalities.oldschool` varies between printings for 779 Oracle IDs**. Old
School legality depends on the edition. *Draft:* `LegalityAssertion` is about the Oracle card.
*Option:* allow `legalityOf` a printing for edition-dependent formats. The property has no range
axiom, so this is already possible.

### RQ-PR-2 — Prices in the public graph
Prices are volatile and commercial. Do we publish them, publish only aggregates, or keep them out
of v1?

### RQ-PR-3 — "Game changer" and other curated lists
`game_changer` (the Commander Game Changers list) changes over time. Should it be an observation, as
legality is, rather than a boolean on the card?

### RQ-CB-1 — Recipes known only by ID
The bulk variants export contains recipes (`of`, `includes`) only as IDs. Do we fetch recipe details
through the API (sparse, rate-limited), or mark them "details unavailable"?

### RQ-CB-2 — Hypotheses vs documented combos
Where is the boundary between a documented Spellbook variant (community-curated claim) and an SMTG
`SynergyHypothesis` (rule-derived)? Proposed: variants are never re-derived as hypotheses, and
hypotheses never cite variants as proof, only as context.

### RQ-CB-4 — Variant identity is composed from its parts
Every one of the 117,875 variant IDs is the sorted list of Spellbook card IDs joined with `-`, plus
`--<templateId>` per template (e.g. `2034-2850--71`). The ID therefore **changes whenever the card
set changes**. The export's 5,856 aliases record this: 119 redirect to a new ID and 5,737 point to
null. *Draft:* aliases become `smtg:formerIdentifier` of the current variant, or an identifier with
`identifierWithdrawn true`. Is a content-derived ID acceptable as the basis of an SMTG IRI, or
should SMTG mint its own stable variant IRIs?

### RQ-CB-3 — Spellbook status codes
Feature `status` values (e.g. S, H, C …) and variant statuses are stored verbatim. Their meaning must
be confirmed against Spellbook's domain model before mapping them to concepts.

### RQ-ST-1 — Which affordances, and who maps tags to them?
The strategy module is a sketch. Which 10–20 affordances (sacrifice outlet, death-trigger payoff …)
are worth defining, and which Tagger tags or Spellbook features map to them with
`skos:closeMatch` / `exactMatch`? Mapping is a reviewed `ReviewActivity`, never automatic.

### RQ-NS-1 — Namespace
`https://w3id.org/smtg/` is a placeholder (w3id needs a pull request to register a redirect). The
alternative is an owned domain. Changing it is one line in `smtg.config.json` plus a regeneration.
