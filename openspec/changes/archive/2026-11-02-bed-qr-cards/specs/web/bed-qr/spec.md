## Purpose
Printable bed cards whose QR code opens that bed's capture screen in the phone's browser, without showing the patient's name.

## ADDED Requirements

### Requirement: Bed card link
Each bed card's QR code SHALL encode the URL `<origin>/a/bed/<token>` for that bed's QR token, and the card SHALL show the bed number but not the patient's name.

#### Scenario: Bed 4 card
- **WHEN** the card for bed 4 with token `abc_DEF-123` is rendered on origin `https://ward.example`
- **THEN** its QR encodes `https://ward.example/a/bed/abc_DEF-123`, the card text contains `Bed 4` and not the patient's name
