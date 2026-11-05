# Rosterly

Weekly shift scheduler for small teams. People, a Monday–Sunday grid with open shifts, and rule checks on every assignment: **overlap**, **minimum rest** between shifts, **weekly hour cap**, **approved time off** and **weekday unavailability**. Overnight shifts (end earlier than start) are handled everywhere, including the time-off/availability spill into the next day and early-morning coverage.

- A conflicting assignment returns HTTP 409 with machine-readable reasons; the UI lists them and offers "Assign anyway" (`force: true`), after which the shift stays flagged
- Shifts are limited to 16 h; deleting a person turns their shifts into open shifts
- Per-day coverage chart and hours per person for the week
- Zero runtime dependencies (Node ≥ 22.13); pure shared module `src/roster.js`

```bash
npm start            # http://localhost:3000, DB at ./data/rosterly.db (DB_PATH)
npm test             # rules + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available). Single organisation, no login.
