# Sprintly

Sprint burndown for small teams. Create a sprint (Mon–Fri working days only), add pointed tasks, tick them off. You get a burndown chart with the **ideal line** (from the committed scope down to zero) against the **actual** remaining points per working day, a velocity (points per elapsed working day), a **finish forecast** that skips weekends and says whether the work lands inside the sprint, and an ahead / on track / behind status.

- Honest history: tasks added after the start count as *scope added mid-sprint* and move the actual line from their day onward, without rewriting earlier days; the committed scope (and ideal line) stays what it was on day one
- Before the sprint starts it reports "not started" instead of "complete" (a bug the tests caught); days after the end don't inflate elapsed time
- Zero runtime dependencies (Node ≥ 22.13); pure shared module `src/sprint.js`

```bash
npm start            # http://localhost:3000, DB at ./data/sprintly.db (DB_PATH)
npm test             # burndown maths + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available). One team, no login.
