# Contributing: reviewing and changing the ontology

The ontology is plain Turtle under `ontology/`, and everything else (documentation pages,
diagrams, coverage tables, competency-question results) is **generated from it**. So any change,
small or radical, follows the same loop: change the TTL, run `npm run build`, look at the docs and
the checks.

## Four ways to contribute

1. **Comment on a concept (no git needed).** Run `npm run docs:serve`, open the concept page and
   use *Suggest a change*. Suggestions are saved as Markdown files in `review/suggestions/` and can
   be committed.
2. **Open an issue.** Templates: *Concept change* (one term), *Radical proposal* (restructure a
   module), *Question*. Please cite the IDs you are responding to (`RQ-…`, `AP-…`, `CQ-…`).
3. **Edit the Turtle and open a pull request.** Follow `docs/ontology/authoring-conventions.md`:
   every term needs `rdfs:label`, `skos:definition`, `rdfs:isDefinedBy` and `vs:term_status`; the
   rationale goes in `skos:scopeNote`. Then:
   ```bash
   npm run build      # regenerates vocab and examples, validates, runs the CQs, rebuilds the docs
   npm run reason     # HermiT: consistency, unsatisfiable classes, negative OWL tests
   ```
   Add or adjust a competency question in `queries/competency/` when you change meaning, and an
   ADR in `docs/adr/` (copy `0000-template.md`) for any decision with wide impact.
4. **Propose an alternative module (radical changes).** Put it in `proposals/<short-name>/`. It does
   not replace the core until reviewers accept it; meanwhile the docs render it next to the core
   with a *proposal* badge and a diff. See `proposals/README.md`.

## Rules of thumb (see `docs/ontology/anti-patterns.md`)
- Don't add `rdfs:domain`/`rdfs:range` or disjointness unless it is true for **every** use.
  Otherwise use `smtg:intendedDomain` / `smtg:intendedRange` (documentation only) and SHACL.
- Don't make anything transitive without showing that the meaning composes.
- Weak, time-bound or attributed statements are `smtg:Claim`s, never bare triples.
- Never mint IRIs from names; never use `owl:sameAs` in instance data.
- Never invent source facts in fixtures; synthetic test data must say `SYNTHETIC` in its header.

## Commit hygiene
Small commits with a message saying *what changed in the model and why*. Generated files
(`ontology/vocab/`, `examples/`, `docs/status/`, `docs/ontology/competency-questions.md`) are
committed so that reviewers without Node can read them; regenerate them rather than editing by hand.
