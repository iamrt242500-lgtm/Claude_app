# PRD — Hindsight
## Overview & problem
People rarely check whether past decisions went as predicted, so they cannot tell if their confidence is justified. Notes apps store decisions but do not force a prediction, a review date, or measure accuracy.
## Users
Knowledge workers, founders, and engineers who make recurring judgment calls (hiring, scope, estimates). Persona: *Mina*, a tech lead who wants to know if her "80% sure" actually means 80%.
## Value
Prediction + confidence at decision time → scheduled review → calibration feedback.
## Journey
Log decision → (later) Overview shows "due" → record outcome → Calibration page shows bias.
## Functional requirements / acceptance criteria
| ID | Requirement | Acceptance |
|---|---|---|
| F1 | CRUD decisions | Created data persists across reload and server restart; invalid input shows field errors (422) |
| F2 | Review queue | Open decisions with review date ≤ today flagged "Review due" |
| F3 | Review / reopen | Outcome hit/partial/miss + note; reopen clears outcome |
| F4 | Search/filter | By text, status (open/due/reviewed), tag |
| F5 | Calibration | Brier score, hit rate, 5 confidence buckets; verdict only when ≥ 5 reviews |
| F6 | Export | CSV and JSON |
| F7 | Access control | If `ACCESS_PASSWORD` set, all but `/api/health` need Basic auth |
## Non-functional
Responsive (≥ 375 px, no horizontal scroll), keyboard accessible, CSP without inline scripts/styles, no runtime deps, body limit 100 KB.
## MVP scope
Everything above (single-user). **Out of scope:** multi-user accounts, notifications, AI.
