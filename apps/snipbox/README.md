# Snipbox — your personal code snippet library

Save snippets with title, language, tags and notes; find them instantly with **SQLite FTS5 full-text search** (title/code/notes/tags, Porter stemming, prefix matching, BM25 ranking with title weighted highest, matched text highlighted). Filter by tag or language, pin favourites, one-click copy, export/import as JSON.

**Search safety:** user input is reduced to words and turned into quoted prefix terms, so FTS operators / SQL can't be injected (`"; DROP TABLE …`, `NEAR(`, `*`). The FTS index is updated in the same transaction as every create/update/delete/import. Control characters (including the highlight markers) are stripped on write.

```bash
cd apps/snipbox && npm start     # http://localhost:3000 (PORT, DB_PATH=./data/snipbox.db)
npm test                          # 8 unit + API tests (ranking, stemming, re-indexing, import)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```
**API:** `GET /api/snippets?q&tag&language&pinned=1` · `POST/GET/PUT/DELETE /api/snippets[/:id]` · `POST /api/snippets/:id/pin {pinned}` · `GET /api/tags` · `GET /api/export` · `POST /api/import {snippets:[…]}` (≤ 500, partial failures reported per index) · `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite` (FTS5), vanilla JS, zero runtime dependencies.
**Limitations:** no syntax highlighting (plain monospace), single user, no auth, search returns at most 200 results, not deployed.
**Found by E2E and fixed (applied to all apps in this repo):** concurrent `route()` calls could let a slow earlier render overwrite a later one — navigation is now serialized.
