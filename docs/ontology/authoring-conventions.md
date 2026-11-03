# Authoring conventions (the contract between ontology, tooling and docs)

The Turtle files are the **single source of truth**. The documentation site, the coverage
reports and the review pages are generated from them, so anything a reviewer should see must be
expressed with the annotations below. Follow these conventions when editing or proposing changes.

## Namespaces

| Prefix | IRI | Use |
|---|---|---|
| `smtg:` | `https://w3id.org/smtg/ontology#` | classes, properties, annotation properties |
| `smtgv:` | `https://w3id.org/smtg/vocab/` | controlled-vocabulary concepts and concept schemes, e.g. `smtgv:layout/modal_dfc` is written `<https://w3id.org/smtg/vocab/layout/modal_dfc>` |
| `smtgid:` | `https://w3id.org/smtg/id/` | instance data (minted from stable source IDs, never from names) |
| `smtgm:` | `https://w3id.org/smtg/ontology/` | module (owl:Ontology) IRIs, e.g. `smtgm:cards` |

The base is a **placeholder** (see ADR-0003 / RQ-NS-1). It is configured once in `smtg.config.json`.

Standard prefixes used: `rdf rdfs owl xsd skos dcterms prov sh vs` (vs = `http://www.w3.org/2003/06/sw-vocab-status/ns#`), `dcat`.

## Files

```
ontology/smtg.ttl                 aggregate ontology, owl:imports every module
ontology/smtg-<module>.ttl        one module per file (core, cards, printings, text-art, taxonomies,
                                  tags, claims, combos, decks, provenance, strategy)
ontology/vocab/smtg-vocab-<scheme>.ttl   GENERATED controlled vocabularies (do not hand-edit;
                                  edit tools/vocab/ or the curated overrides in tools/vocab/curated.mjs)
ontology/views/*.ttl              OPT-IN interpretation views (not imported by default)
shapes/smtg-shapes.ttl            SHACL shapes (closed-world validation)
examples/*.ttl                    instance data generated from real fixtures (ABox)
fixtures/invalid-rdf/*.ttl        deliberately invalid data; SHACL must reject each file
proposals/<name>/*.ttl            alternative/extension modules proposed by reviewers
queries/competency/CQ-*.rq        competency questions as SPARQL
```

## Module header

Each module file declares exactly one `owl:Ontology`:

```turtle
smtgm:cards a owl:Ontology ;
  rdfs:label "SMTG Cards"@en ;
  dcterms:title "Cards: Oracle identity, faces and layouts"@en ;
  dcterms:description "…a paragraph…"@en ;
  owl:versionInfo "0.1.0-draft" ;
  smtg:moduleOrder 2 ;                 # sidebar order
  vs:term_status "unstable" ;
  owl:imports smtgm:core .
```

## Term annotations (every class, property and named individual)

| Annotation | Required | Meaning |
|---|---|---|
| `rdfs:label` (@en) | yes | display label |
| `skos:definition` (@en) | yes | precise natural-language definition (what it IS, not how it is stored) |
| `rdfs:isDefinedBy` | yes | the module IRI (`smtgm:cards`) |
| `vs:term_status` | yes | `stable-draft` (we believe it's right), `unstable` (likely to change), `proposal` (sketch for discussion), `deprecated` |
| `rdfs:comment` (@en) | no | extra explanation |
| `skos:scopeNote` (@en) | no | **modelling rationale**: why it is modelled this way, what it deliberately does NOT mean |
| `skos:example` (@en) | no | short textual example ("Bonecrusher Giant // Stomp has two faces…") |
| `smtg:sourceField` (string) | no, repeatable | source JSON path(s) mapped here, prefixed by source: `scryfall:card_faces[].oracle_text`, `tagger:taggings[].weight`, `spellbook:variants[].uses[].quantity` |
| `smtg:reviewQuestion` (string) | no, repeatable | ID of an open question in `review-questions.md`, e.g. `RQ-ID-2` |
| `smtg:antiPattern` (string) | no, repeatable | ID in `anti-patterns.md`, e.g. `AP-04` |
| `smtg:docExample` (IRI) | no | an instance in `examples/` to show on the term's doc page |

Logical axioms (`rdfs:subClassOf`, `rdfs:domain`, `rdfs:range`, `owl:disjointWith`,
`owl:equivalentClass`, characteristics) are stated **only when semantically correct**. Prefer
leaving `rdfs:domain` out and documenting the intended subject class with
`smtg:intendedDomain` (non-logical annotation) when a global domain would create false inferences.
Likewise `smtg:intendedRange`. The docs draw both logical and intended edges (intended = dashed).
Intended domains and ranges are still a contract: `npm run validate` generates a SHACL shape from
each annotation (subjects, respectively values, must belong to one of the listed classes) and checks
the examples together with the materialised inferred graph.

## Controlled vocabularies

```turtle
smtgv:layout a skos:ConceptScheme ; rdfs:label "Card layouts"@en ; rdfs:isDefinedBy smtgm:taxonomies ;
  smtg:conceptClass smtg:Layout .
<https://w3id.org/smtg/vocab/layout/modal_dfc> a smtg:Layout ;
  skos:inScheme smtgv:layout ; skos:prefLabel "Modal double-faced card"@en ;
  skos:notation "modal_dfc" ;          # the exact source code value
  skos:definition "…"@en ;
  smtg:sourceValueOf "scryfall:layout" ;
  smtg:symbol "{W}" .                  # optional: Scryfall symbol code → rendered with the official PNG
```

`smtg:Layout` etc. are subclasses of `skos:Concept`. Vocabulary individuals are generated from
the Scryfall catalogs and the field census, then enriched by `tools/vocab/curated.mjs`.

## Proposals (how to suggest a radical change)

Put alternative modules in `proposals/<short-name>/`. Each file has an `owl:Ontology` header with

```turtle
<https://w3id.org/smtg/ontology/proposal/dec-claims> a owl:Ontology ;
  rdfs:label "DEC-based claims module (proposal)"@en ;
  smtg:proposalOf smtgm:claims ;       # the module it would replace or extend
  smtg:proposalKind "replace" ;        # replace | extend | alternative
  dcterms:creator "Name" ;
  dcterms:description "…"@en .
```

Terms in proposals use the same annotations; the docs render them with a **proposal** badge and
list which core terms the proposal adds, redefines or removes (`smtg:replacesTerm <iri>`).

## Generated data files consumed by the docs

| File | Producer | Shape (top level) |
|---|---|---|
| `docs/source-audit/sources.json` | `tools/audit/fetch-sources.mjs` (copy of `data/raw/manifest.json`, paths only) | `{ files:[{key,url,bytes,sha256,retrievedAt,sourceUpdatedAt,etag}] }` |
| `docs/source-audit/scryfall-census.json` | `tools/audit/census-scryfall.mjs` | `{ source, snapshot, records, layouts:{}, fields:[{path,present,nulls,types:{},distinct,topValues:[[v,n]],samples:[],byLayout:{}}] }` |
| `docs/source-audit/tagger-profile.json` | `tools/audit/profile-tagger.mjs` | `{ oracle:{…}, art:{…} }` with counts, weights, multi-parent, depth histogram, DAG check |
| `docs/source-audit/spellbook-profile.json` | `tools/audit/profile-spellbook.mjs` | `{ timestamp, version, variants, statuses:{}, fields:[…census-like…], … }` |
| `mappings/*.fields.json` | hand-written | `[{ path, scope, disposition, terms:[], note }]` — disposition ∈ mapped, raw, derived, excluded, deferred |
| `docs/status/validation.json` | `tools/validate/validate.mjs` | `{ generatedAt, parse:[…], shacl:{ positive:[…], negative:[…] } }` |
| `docs/status/cq-results.json` | `tools/validate/run-cq.mjs` | `{ generatedAt, results:[{ id, title, question, kind, rows:[…], expected, pass }] }` |
| `docs/status/reasoner.json` | `tools/reason/reason.mjs` | `{ generatedAt, reasoner, consistent, unsatisfiable:[…], log }` |

## Competency question files

```sparql
# id: CQ-ID-01
# title: Printings of an Oracle card in a language
# question: Which printings of Lightning Bolt exist in Italian?
# kind: SPARQL            (SPARQL | OWL | SHACL | negative)
# expects: nonempty       (nonempty | empty | count=N)
# modules: cards, printings
PREFIX smtg: <https://w3id.org/smtg/ontology#>
SELECT …
```

## Card references in documentation text

Write card names in documentation text (Markdown pages, and `skos:definition`, `skos:scopeNote`,
`skos:example` and other annotation literals) with the convention of the Scryfall and
MTGCardFetcher bots:

| You write | The docs show |
|---|---|
| `[[Lightning Bolt]]` | a link to the card on Scryfall, with an image preview on hover or focus |
| `[[Lightning Bolt\|LEA]]` | a printing in that set (lowest collector number) |
| `[[Lightning Bolt\|LEA\|161]]` | a specific printing (set and collector number) |
| `[[Lightning Bolt\|M10\|146\|it]]` | a specific printing in a given language (default `en`) |
| `[[!Bonecrusher Giant // Stomp]]` | the card image itself (all faces for double-faced cards) |

Names are exact Oracle names (a face name such as `[[Stomp]]` also works). `npm run cards:resolve`
resolves every reference against the local Scryfall snapshots into `docs/card-refs.json`, which is
committed so the docs build without data or network. Unresolved references are listed and render as
plain text. Images are loaded from Scryfall's image servers when the page is viewed, unmodified, and
are never stored in the repository. Inside code (`` `…` ``) a reference stays literal.
