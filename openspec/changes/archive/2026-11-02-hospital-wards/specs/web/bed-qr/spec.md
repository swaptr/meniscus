# Spec Delta

## MODIFIED Requirements

### Requirement: Bed card link
Each bed card's QR code SHALL encode the URL `<origin>/a/bed/<token>` for that bed's QR token, and the card SHALL show the ward code, ward name and bed number but not the patient's name.

#### Scenario: Bed 4 card
- **WHEN** the card for ward 5B (Neurology Ward 5B) bed 4 with token `abc_DEF-123` is rendered on origin `https://ward.example`
- **THEN** its QR encodes `https://ward.example/a/bed/abc_DEF-123`, the card text contains `5B · Bed 4` and `Neurology Ward 5B`, and not the patient's name
