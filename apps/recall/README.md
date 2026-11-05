# Recall — spaced-repetition flashcards (SM-2)

Decks of cards scheduled with the SM-2 algorithm (Again / Hard / Good / Easy). Cards come due automatically; review them in a keyboard-driven session (Space = reveal, 1–4 = grade).

**Features:** deck/card CRUD, bulk import (`front :: back` per line, ≤ 500), study queue (≤ 50 cards per session), stats (cards, due, reviewed today, retention, 14-day chart). Data persists in SQLite.
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS SPA, zero runtime dependencies.

```bash
cd apps/recall && npm start      # http://localhost:3000  (PORT, DB_PATH=./data/recall.db)
npm test                          # 8 unit + API tests
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e   # needs playwright installed at repo root (npm install)
```
**API:** `GET/POST /api/decks`, `GET/DELETE /api/decks/:id`, `POST /api/decks/:id/cards` (single or `{bulk}`), `GET /api/decks/:id/study`, `PUT/DELETE /api/cards/:id`, `POST /api/cards/:id/grade {grade:1-4}`, `GET /api/stats`, `GET /api/health`.
**Limits:** single user, no auth, "today" is the UTC date, not deployed.
**Tested:** unit (SM-2 math), API (incl. time travel via injected clock), E2E (10 steps incl. keyboard study, forced 500, network abort, XSS, mobile overflow). E2E found and I fixed: CSP blocked the favicon; "disabled" Study link was still clickable.
