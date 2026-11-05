# Diffly — compare two texts line by line and word by word

Paste an original and a changed text; Diffly shows an **instant diff** (side-by-side or unified) with line numbers, +/− stats, and **word-level highlights** inside changed lines. Options: ignore whitespace, ignore case, swap sides, show only changes (long unchanged runs collapse to "N unchanged lines"), **copy a unified patch** (`diff -u` format). Save comparisons with a title and reload them later.

**Algorithm (tested hard):** a from-scratch **Myers O(ND)** implementation. Tests prove: the textbook example has the minimal script (D = 5); **400 random pairs reconstruct both sides exactly and are minimal** (`edits = n + m − 2·LCS`, checked against an independent dynamic-programming LCS); edited copies of a 300-line document never diff to more edits than were made; the **unified output agrees with GNU `diff -u`** on +/− counts and hunk count; CRLF/CR and a trailing newline are not differences; 4 000-line inputs with few edits take milliseconds. When two texts are completely different (edit distance > 6 000) it degrades to a full replacement instead of exhausting memory, and inputs over 400 000 characters / 8 000 lines per side are rejected with a clear message. The same module runs in the browser (instant, no round trip) and on the server (`POST /api/diff`).

```bash
cd apps/diffly && npm start     # http://localhost:3000 (PORT, DB_PATH=./data/diffly.db)
npm test                         # 15 tests incl. property tests and the GNU diff cross-check (skipped if `diff` is absent)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```
**API:** `POST /api/diff {left, right, ignoreWhitespace?, ignoreCase?}` → rows + stats + unified text; `GET/POST /api/comparisons`, `GET/DELETE /api/comparisons/:id`; `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS ES module shared by server/browser/tests, zero runtime dependencies.
**Limitations:** line pairing inside a changed block is positional (the n-th removed line is paired with the n-th added line, so moved lines show as delete + add; no move detection); word diff is token-based, not character-based; no syntax highlighting or file upload; single user, no auth; not deployed.
**Found by E2E and fixed:** the "N lines" counters never updated while typing. (Playwright's `fill()` takes ~15 s for a 3 000-line textarea even on a bare `<textarea>`; the app itself diffs + renders 3 000 lines in well under a second, so the large-input test sets the value directly, like a paste.)
