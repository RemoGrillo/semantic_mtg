# Review session guide (first draft, 2026-11-03)

A 30–45 minute walkthrough of the draft for ontologists. Open `site/index.html`; for live
suggestions run `npm run docs:serve` and use the printed URL.

## 1. The problem, in one diagram (5 min)
*Overview → big-picture diagram.* SMTG keeps apart Oracle card, card face, printing, printed face,
illustration and image, plus claims and provenance. Then show one card end to end:
*Classes → Oracle card* has an instance diagram of **Bonecrusher Giant // Stomp**: one Oracle card,
two faces, one physical side.

## 2. Identity and layouts, review round R1 (10 min)
- *Layout matrix:* 25 layouts observed in the 2026-11-03 data, including two the plan didn't know
  (`prepare`, `front_card`). Absorbing them required no schema change (ADR-0004).
- *Classes → Card printing:* the Italian Lightning Bolt (*Fulmine*), with printed text as a separate
  text expression.
- Reasoning: an adventure card can't also be an MDFC, and HermiT proves it (*Status* page,
  negative OWL tests).
- Ask: **RQ-ID-1** (reversible printings), **RQ-CF-1** (one face even for single-faced cards),
  **RQ-ID-3** (identifier nodes vs literals), **RQ-PR-4** (Old School legality varies by printing).

## 3. Types and vocabularies, round R2 (5–10 min)
- *Vocabularies → Color combinations:* 32 concepts, so "colourless" and "exactly WU" are positive
  facts. `subCombinationOf` is the only transitive property, and transitivity is correct there.
- *Source audit → type-line residue:* planar types are missing from the Scryfall catalogs
  (**RQ-TY-2**).

## 4. Claims and the DEC question, round R3 (15 min)
- *Epistemic layer & DEC* page: what the draft guarantees, then the three concrete cases.
- *Competency questions → CQ-TG-03:* Lightning Bolt's tag *burn any* has the parents *burn
  creature*, *burn player* … — parents behave like **implication**. For art tags they mix
  categories. Tagger never materialises inherited tags (**RQ-TG-1**).
- Weights: almost everything is *median*; there are 4,718 *weak* art taggings (**RQ-CL-4**).
- Ask the DEC colleague the five questions at the end of that page. The ideal outcome is a
  `proposals/dec-claims/` module.

## 5. How changes come in (2 min)
*Contributing* page: suggestion box (review mode), issue templates, edit TTL + `npm run build`, or
an alternative module in `proposals/`. Decisions become ADRs.

## Numbers to have at hand
- all_cards: 547,953 printings; 39,287 Oracle IDs; 57,043 illustrations; 20 languages.
- Tagger: 4,601 Oracle tags (239,926 taggings); 11,828 art tags (505,125 taggings); both DAGs.
- Spellbook: 117,875 variants (version 7.3.4); 5,856 aliases; 178 templates; 1,102 features.
- Ontology: 327 SMTG terms; 41 generated schemes / 2,358 concepts; 19 SHACL node shapes; 27 CQs
  passing; HermiT consistent.
