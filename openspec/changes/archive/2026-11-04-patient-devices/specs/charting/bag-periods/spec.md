## ADDED Requirements

### Requirement: Bag reading without the device
An admission SHALL raise one `bag_without_device` per bag with a reading charted in the last 24 h at a time no order for that bag was in force (a catheter for the urine bag, a stoma or drain order for theirs), while no such order is active. The reading is saved and charted as any other. The message names the bag, the newest such reading's time and the missing order, and ends `Review.`. It joins the alerts as the bag prompts do and makes no model request.

#### Scenario: Urine bag on a bed with no catheter
- **WHEN** 3A bed 5 has no catheter order, and at 10:30 Ravi Kumar (id 1) posts `{ container: "urine_bag", event: "check", volume_ml: 300, source: "photo", media_id: <a photo of 3A bed 5> }`
- **THEN** the response is 201 with the reading and a pending 300 mL urine entry
- **AND** the alerts include `bag_without_device` with the message `Urine bag reading at 10:30, but no catheter is on the care plan. Review.`
- **AND** the upstream received no request

#### Scenario: Catheter added
- **WHEN** at 11:00 Anita Thomas (id 4) sets a catheter order on 3A bed 5
- **THEN** the alerts no longer include `bag_without_device`, and the 10:30 reading and its entry are unchanged

#### Scenario: Readings while the catheter was in
- **WHEN** 3A bed 3's urine bag was read at 08:00 and 12:00 under a catheter order ended at 13:00, and the alerts are read at 14:00
- **THEN** they do not include `bag_without_device`
- **AND** after a urine-bag check posted at 15:00 they include it, with the message `Urine bag reading at 15:00, but no catheter is on the care plan. Review.`

#### Scenario: Stoma and drain
- **WHEN** 2C bed 2 has a catheter and no other order, and its stoma bag is checked at 09:00 and its drain bag at 10:00
- **THEN** the alerts include two `bag_without_device`, in the order stoma then drain, with the messages `Stoma bag reading at 09:00, but no stoma is on the care plan. Review.` and `Drain bag reading at 10:00, but no drain is on the care plan. Review.`

#### Scenario: A day later
- **WHEN** 3A bed 5's only urine-bag reading with no catheter was charted 24 hours and 1 minute ago
- **THEN** the alerts do not include `bag_without_device`

#### Scenario: Explained
- **WHEN** 3A bed 5's only prompt is `bag_without_device`
- **THEN** `GET /api/wards` shows 3A with `beds_with_alerts: 1`
- **AND** `POST /api/ai/explain` for that bed is 200, and the upstream received exactly one request, whose input contains `bag_without_device` and not `Joseph Mwangi`
