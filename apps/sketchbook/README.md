# Sketchbook — draw, save and export vector sketches

A canvas sketchpad built on **vector strokes**: pen and eraser, 8-colour palette + custom colour, size slider, mouse/touch/pen input (pointer events), **undo / redo** (buttons and Ctrl/⌘+Z, Ctrl/⌘+Shift+Z — "Clear" is a single undoable step), autosave (1.5 s after the last change, and always before leaving the editor), a thumbnail gallery, **PNG export** (from the canvas) and **SVG export** (generated on the server).

**Engineering notes (tested):** strokes are simplified with an iterative Ramer–Douglas–Peucker pass before saving (a unit test checks the error stays within ε, and that 5 000 points are fast and never overflow the stack); the server validates and normalizes every stroke (tool, `#rrggbb` colour, size 1–60, finite points clamped to the 800×600 canvas, ≤ 2 000 strokes / 200 000 points / 8 MB); SVG output can only ever contain numbers and `#rrggbb` colours even for unvalidated input (injection test), is served with `default-src 'none'`, and the eraser is rendered in the background colour so an exported SVG looks like the canvas; the browser and server share one module (`src/draw.js`).

```bash
cd apps/sketchbook && npm start     # http://localhost:3000 (PORT, DB_PATH=./data/sketchbook.db)
npm test                             # 10 unit + API tests
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e   # draws with the real mouse and inspects canvas pixels
```
**API:** `GET/POST /api/drawings`, `GET/PUT/DELETE /api/drawings/:id`, `GET /api/drawings/:id/svg[?download=1]`, `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS + Canvas 2D, zero runtime dependencies.
**Limitations:** fixed 800×600 canvas, no layers/shapes/text/zoom, the eraser is a background-coloured stroke (not transparent), no pressure sensitivity, single user, no auth, not deployed.
**Found by E2E and fixed:** "Clear — you can undo this" disabled Undo (it only filled the redo stack) → history is now a stack of actions; the very first autosave could rewrite the URL after navigating away; colour swatches were invisible because the CSP blocks inline `style` attributes (now set through the CSSOM); oversize uploads left a half-read connection (now `Connection: close`).
