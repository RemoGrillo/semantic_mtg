# ADR-0008 — Project and ontology names

- **Status:** accepted (project owner, 2026-11-03); the ontology name is provisional
- **Date:** 2026-11-03
- **Related:** ADR-0006

## Context
The draft was called "Semantic Magic: The Gathering". Putting the trademark "Magic: The
Gathering" into the project's own name can suggest an affiliation. Using it to describe what the
project is about (nominative use, with the Fan Content notice) is the common practice.

## Decision
- **Project:** **Semantic MTG**, subtitle *Linked data for Magic: The Gathering cards*.
- **Ontology:** **SMTG-O**, *Semantic MTG Ontology*. This is a working name until a better one is
  found.
- The `smtg:` prefix, the IRIs (`https://w3id.org/smtg/…`, still a placeholder, ADR-0003) and the
  "SMTG" shorthand stay unchanged, now read as *Semantic MTG*. Module labels read "SMTG-O Cards",
  "SMTG-O Tags", and so on.
- Repository: https://github.com/RemoGrillo/semantic_mtg

## Consequences
Renaming the ontology later only touches labels (`ontology/smtg.ttl`, module labels,
`smtg.config.json`), never IRIs.
