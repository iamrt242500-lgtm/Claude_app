# Hindsight — decision journal with calibration analytics

Log a decision, your prediction, and how confident you are. When the review date arrives, record what actually happened. Hindsight then shows whether you are **over- or under-confident** (calibration chart + Brier score) so your future judgment improves.

**Repository:** https://github.com/iamrt242500-lgtm/Claude_app · **Live URL:** none — not deployed yet (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)).

> This repository holds several small apps. **Hindsight** (this README) lives at the repo root; others live in `apps/`:
> - [`apps/recall`](apps/recall) — spaced-repetition flashcards (SM-2)
> - [`apps/tabula`](apps/tabula) — CSV profiler & aggregate charts
> - [`apps/cronwise`](apps/cronwise) — cron expression explainer & schedule keeper
> - [`apps/invoicely`](apps/invoicely) — invoices & clients for freelancers
> - [`apps/boardwalk`](apps/boardwalk) — kanban boards with drag and drop
> - [`apps/streakline`](apps/streakline) — habit tracker with schedule-aware streaks
> - [`apps/snipbox`](apps/snipbox) — code snippet library with full-text search
> - [`apps/evenly`](apps/evenly) — group expense splitting & settle-up
> - [`apps/linkpad`](apps/linkpad) — Markdown notes with wikilinks & backlinks
> - [`apps/shortly`](apps/shortly) — link shortener with click analytics
> - [`apps/focusly`](apps/focusly) — Pomodoro timer with server-side state & stats
> - [`apps/pennywise`](apps/pennywise) — monthly budget tracker with bank-CSV import
> - [`apps/quizzly`](apps/quizzly) — quiz maker & taker with server-side grading
> - [`apps/overlap`](apps/overlap) — DST-aware meeting-time finder across time zones
> - [`apps/pollbox`](apps/pollbox) — shareable polls with admin links and results policies
> - [`apps/sketchbook`](apps/sketchbook) — vector sketchpad with undo/redo and PNG/SVG export
> - [`apps/diffly`](apps/diffly) — text diff (Myers) with word highlights and unified patches
> - [`apps/pantry`](apps/pantry) — recipes, weekly meal plan and merged shopping list
> - [`apps/typo`](apps/typo) — typing practice with server-verified WPM stats
> - [`apps/followup`](apps/followup) — paste meeting notes, get owners + resolved due dates as a task board
> - [`apps/contrastly`](apps/contrastly) — WCAG contrast checker with nearest-accessible-colour suggestions and palette matrices
> - [`apps/pacer`](apps/pacer) — running pace/time/distance calculator with splits, negative splits, Riegel predictions and goals
> - [`apps/lexi`](apps/lexi) — daily five-letter word game; the server scores guesses and never exposes the answer
>
> Run every app's checks and unit/API tests at once with `scripts/test-all.sh` (add `--e2e` for the browser tests).

## Features
- Create / edit / delete decisions (title, context, choice, prediction, confidence 50–99%, dates, tags)
- "Due for review" queue; review as hit / partly / miss with notes; reopen
- Journal with search, status and tag filters; CSV / JSON export (CSV is formula-injection safe)
- Calibration page: avg confidence vs hit rate, Brier score, per-bucket table and SVG chart, verdict (≥ 5 reviews)
- Responsive, keyboard accessible, light/dark; validation, network and server error handling
- Optional password protection (HTTP Basic) via `ACCESS_PASSWORD`

## Stack
Node 22 (built-in `node:http` + `node:sqlite`, **zero runtime dependencies**) · SQLite (WAL) · vanilla JS SPA · `node:test` · Playwright (dev only).

## Run
```bash
npm install        # only dev dependency: playwright
npm start          # http://localhost:3000
```
| Env var | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | HTTP port |
| `DB_PATH` | `./data/hindsight.db` | SQLite file (mount a persistent volume) |
| `ACCESS_PASSWORD` | empty | if set, Basic auth, user `hindsight` |

## Test
```bash
npm run check      # syntax check
npm test           # unit + API integration (13 tests)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e   # browser E2E (omit CHROMIUM_PATH if `npx playwright install chromium` was run)
```

## Docs
[Ideation](docs/IDEATION.md) · [PRD](docs/PRD.md) · [Architecture, API & DB](docs/ARCHITECTURE.md) · [Test report](docs/TEST_REPORT.md) · [Deployment](docs/DEPLOYMENT.md) · [Roadmap](docs/ROADMAP.md)
