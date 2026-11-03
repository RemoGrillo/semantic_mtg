# Proposals

Alternative or extension modules proposed by reviewers. A proposal does **not** change the core
ontology until it is accepted (then it is merged and recorded in an ADR). Until then the
documentation shows it beside the core module, with a *proposal* badge and a term-by-term diff.

## How to add one

```
proposals/<short-name>/
  README.md            what, why, which RQ-/AP- it answers
  <module>.ttl         one or more Turtle files
```

Each Turtle file starts with an ontology header:

```turtle
@prefix smtg:    <https://w3id.org/smtg/ontology#> .
@prefix smtgm:   <https://w3id.org/smtg/ontology/> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix owl:     <http://www.w3.org/2002/07/owl#> .
@prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .

<https://w3id.org/smtg/ontology/proposal/dec-claims> a owl:Ontology ;
  rdfs:label "DEC-based claims module (proposal)"@en ;
  smtg:proposalOf smtgm:claims ;      # which core module it concerns
  smtg:proposalKind "replace" ;       # replace | extend | alternative
  dcterms:creator "Your Name" ;
  dcterms:description "Why and what changes."@en .
```

Terms follow `docs/ontology/authoring-conventions.md`. To say that a term replaces a core term,
annotate it with `smtg:replacesTerm <core term IRI>`. Then run `npm run build`: the proposal is
parsed, rendered and listed under *Proposals*. Validation (`npm run validate`) parses proposals but
does not yet run SHACL or reasoning against them; ask for that in the proposal README if needed.

## Ideas already on the table
- `dec-claims`: DEC semantics for attitudes and strengths (see `docs/ontology/epistemic-layer-dec.md`).
- `tags-belief-propagation`: an alternative to the SKOS view where inherited tags are weakened beliefs.
