# Chorewheel

Fair household chores. Define people and recurring chores (points 1–10, every N days); the board plans a week ahead and assigns each instance with a transparent rule: **skip anyone away that day → lowest points in the last 28 days wins → ties go to whoever did this chore longest ago → then lowest id**. Heavier chores are placed first on a given day, so three chores due on one day go to three people.

- Tick chores off (undoable); overdue chores stay on the board until done
- Reassign by hand; mark someone away and their open chores in that window move to others (new instances skip them too); removing a person redistributes their open chores
- Fairness summary: points spread and each person's share over the window
- Zero runtime dependencies (Node ≥ 22.13); pure shared module `src/chores.js`

```bash
npm start            # http://localhost:3000, DB at ./data/chorewheel.db (DB_PATH)
npm test             # scheduling/fairness + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available). One household, no login.
