# Linkpad — Markdown notes connected by [[wikilinks]]

Write notes in Markdown, link them with `[[Title]]` or `[[Title|label]]`, and see **backlinks** on every note. Links to notes that don't exist yet show as dashed "ghost" links — click one to create it (title prefilled). Renaming a note **rewrites `[[old]]` links in all other notes** (labels preserved, code spans/blocks untouched). Full-text search (SQLite FTS5, stemming, prefix, title-weighted ranking), live side-by-side preview, titles unique case-insensitively.

**Markdown:** headings, paragraphs, **bold**, *italic*, `inline code`, fenced code blocks, blockquotes, bullet/numbered/task lists, rules, links (`http(s)`/`mailto`/`#` only). The parser produces an AST that the UI turns into DOM nodes — **no HTML strings, no `innerHTML`**; raw HTML in notes is shown as text and `javascript:`/`data:` links are never rendered as links (unit-tested, plus a pathological-input performance test).

```bash
cd apps/linkpad && npm start     # http://localhost:3000 (PORT, DB_PATH=./data/linkpad.db)
npm test                          # 15 unit + API tests (parser, link extraction/rename, FTS, backlinks)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```
**API:** `GET/POST /api/notes[?q=]`, `GET/PUT/DELETE /api/notes/:id` (GET returns `backlinks` and resolved `links`), `GET /api/resolve?title=`, `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite` (FTS5), vanilla JS ES modules, zero runtime dependencies.
**Limitations:** single user, no auth, no nested lists/tables/images/footnotes, no graph view, search shows at most 100 results, not deployed.
**Found while testing and fixed:** a `WITHOUT ROWID` table used with `ORDER BY rowid` (500 on create); `[[a|b|c]]` semantics clarified (labels may contain `|`).
