# Spec Delta

## MODIFIED Requirements

### Requirement: Care status on chart reads
Each `GET /api/admissions` item and `GET /api/admissions/:id/entries` SHALL include `care`:
- `orders`: the active orders, at most one per kind, in the order acuity, nil by mouth, thickened fluids, fluid limit, intake target, catheter;
- `fluid_limit`, `intake_target` and `catheter`: their progress, each null without its order.

It is computed without any model request.

#### Scenario: Fresh store
- **WHEN** `GET /api/admissions` is called on a fresh store
- **THEN** every admission has `care: { orders: [], fluid_limit: null, intake_target: null, catheter: null }`, and the upstream received no request

#### Scenario: Display order
- **WHEN** a catheter order, then a fluid limit, then nil by mouth, then acuity `watch` are set on one bed
- **THEN** that bed's `care.orders` kinds read `acuity`, `nil_by_mouth`, `fluid_limit`, `catheter`, in both reads
