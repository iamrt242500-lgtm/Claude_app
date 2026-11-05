# Boardwalk — kanban boards for one

Multiple boards, each with columns (default To do / Doing / Done; add, rename, delete up to 12) and cards (title, description, due date, labels). Reorder and move cards by **drag and drop**, or with the **Move ← / →** buttons and column select in the card dialog (keyboard- and touch-friendly alternative). Filter by text or label; cards past their due date are flagged unless they sit in the last column. Everything persists in SQLite; ordering is stored as dense positions renumbered inside a transaction on every move/delete.

```bash
cd apps/boardwalk && npm start    # http://localhost:3000 (PORT, DB_PATH=./data/boardwalk.db)
npm test                           # 7 unit + API tests
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e   # includes real drag-and-drop
```
**API:** `GET/POST /api/boards`, `GET/PUT/DELETE /api/boards/:id`, `POST /api/boards/:id/columns`, `PUT/DELETE /api/columns/:id`, `POST /api/columns/:id/cards`, `PUT/DELETE /api/cards/:id`, `POST /api/cards/:id/move {columnId,index}`, `GET /api/health`. Moves across boards are rejected (422); the last column of a board cannot be deleted (409).
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS, zero runtime dependencies.
**Limitations:** single user, no auth; native HTML5 drag-and-drop does not work on touch screens (use the dialog's Move buttons); no card ordering while a filter is active beyond drop position among visible cards; due dates use the browser's UTC date; not deployed.
