## What changes in the model and why
<!-- one paragraph; cite RQ-/AP-/CQ-/ADR- IDs -->

## Checklist
- [ ] Every new/changed term has `rdfs:label`, `skos:definition`, `rdfs:isDefinedBy`, `vs:term_status`
- [ ] `npm run build` passes (SHACL positive + negative tests, competency questions)
- [ ] `npm run reason` passes (consistent, no unsatisfiable classes, negative OWL tests inconsistent)
- [ ] Competency question added/updated if meaning changed
- [ ] ADR added for decisions with wide impact
- [ ] No source facts invented; synthetic data marked SYNTHETIC
