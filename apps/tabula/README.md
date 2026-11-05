# Tabula — CSV profiler & aggregate charts

Paste or upload a CSV and get an instant profile: inferred column types (number / date / boolean / text), missing values, unique counts, min/median/mean/max/std, histograms and top values. Browse the data (search, sort, paging) and chart any group-by aggregate (count / sum / avg / min / max). Datasets persist in SQLite.

**Stack:** Node 22 `node:http` + `node:sqlite`, own RFC-4180 CSV parser (quotes, escaped quotes, embedded newlines, CRLF, BOM, `, ; \t |` auto-detect), vanilla JS SPA with SVG charts. Zero runtime dependencies.

```bash
cd apps/tabula && npm start     # http://localhost:3000 (PORT, DB_PATH=./data/tabula.db)
npm test                         # 12 unit + API tests
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```
**API:** `GET/POST /api/datasets {name,csv,delimiter?}`, `GET/DELETE /api/datasets/:id`, `GET /api/datasets/:id/rows?offset&limit&q&sort&dir`, `GET /api/datasets/:id/aggregate?group&metric&fn`, `GET /api/health`.
**Limits:** 5 MB / 50 000 rows / 100 columns per upload; ragged rows are padded/truncated to the header width; row search/sort/aggregate load the dataset's rows in memory (fine at these limits). Single user, no auth, not deployed.
**Tested bugs fixed:** parser dropped a quoted-empty final row (found by unit test); tiny unreadable labels in profile bar charts (found by screenshot review).
