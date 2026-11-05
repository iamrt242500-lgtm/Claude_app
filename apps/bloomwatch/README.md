# Bloomwatch

Plant care scheduler. Each plant has a base watering interval; with "seasonal" on, the interval stretches in winter (×1.75), shrinks in summer (×0.75) and eases in autumn (×1.25). The next date uses the interval of the season the **due date** falls in (so a plant watered in late autumn gets the winter interval), and a southern-hemisphere switch flips the seasons. The Today board groups plants as overdue / water today / coming up (≤ 2 days) / all good, with "N days late" wording, and each plant tracks its recent rhythm against the plan.

- Never-watered plants are due on the day they were added; waterings can be back-dated (not before the plant was added, not in the future) and undone
- Zero runtime dependencies (Node ≥ 22.13); pure shared module `src/plants.js`

```bash
npm start            # http://localhost:3000, DB at ./data/bloomwatch.db (DB_PATH)
npm test             # scheduling + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available). Single household, no login.
