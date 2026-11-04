# Spec Delta

## ADDED Requirements

### Requirement: Before and after
Every level SHALL keep its `media` and photo evidence. An intake entry created by a level drop SHALL return `levels: { before, after }`, each `{ id, volume_ml, created_at, media, evidence }`, and the after level's media as its own `media`. Other entries SHALL return `levels: null`. It makes no model request.

#### Scenario: Jug before and after
- **WHEN** bed 1's water jug is recorded at 08:00 at 1000 mL with photo A and evidence, then at 12:00 at 600 mL with photo B and evidence
- **THEN** the 400 mL entry returns:
  - `levels.before`: 1000 mL at 08:00, with photo A and the first level's evidence
  - `levels.after`: 600 mL at 12:00, with photo B
  - `media`: photo B
