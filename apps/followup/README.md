# Followup

Paste meeting notes → get a task board. Followup finds action items (`TODO:`, `Action:`, checkboxes, `@name`, "Sam will…", "We need to…"), assigns owners, and resolves relative due dates ("by Friday", "end of next week", "in a couple of days", "Mar 20th") against the meeting date.

- Live preview in the browser (same `extract.js` runs client and server), tasks grouped Overdue / Today / This week / Later / No date / Done
- Re-saving notes re-syncs: completed state and hand-edited owner/due are kept, removed lines drop their tasks, manual tasks survive
- Zero runtime dependencies (Node ≥ 22.13, `node:sqlite`)

```bash
npm start            # http://localhost:3000, DB at ./data/followup.db (DB_PATH)
npm test             # extractor + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available); run via `npm start` or the repo's Docker setup.
