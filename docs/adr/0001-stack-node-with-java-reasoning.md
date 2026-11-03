# ADR-0001 — Node for the whole project, Java only for OWL DL reasoning

- **Status:** accepted (project owner, 2026-11-03)
- **Date:** 2026-11-03
- **Related:** PLAN §3 (which originally suggested Python)

## Context
The project owner prefers a single full-stack language. The tooling SMTG needs exists in Node:
streaming JSONL (`node:readline`, `node:zlib`), Turtle (`n3`), SHACL (`rdf-validate-shacl`), SPARQL
(`oxigraph`), Mermaid for diagrams, and later web UI and SPARQL clients. Mature OWL 2 DL reasoners
(HermiT, ELK, Pellet) run on the JVM and are best driven through ROBOT. The DEC reasoner under
discussion is also an OWL reasoner and is likely OWLAPI-based.

## Decision
- Node ≥ 22, ESM, no framework, for fetching, auditing, vocabulary generation, mapping, validation,
  competency questions and documentation.
- OWL DL reasoning through **ROBOT + HermiT** on a **portable JRE** that `npm run reason` downloads
  into the gitignored `.tools/`. No system installation and no sudo.
- Reasoners are configurable (`smtg.config.json → reasoners`), so DEC can be added beside HermiT/ELK.

## Consequences
Python and pyshacl are not used, and the PLAN's suggested stack is superseded here. The JVM
dependency is confined to `tools/reason/`. CI needs network access the first time it fetches the JRE
and ROBOT.
