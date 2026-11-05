# Gridlock

Sudoku with a from-scratch engine: MRV backtracking solver that counts solutions, and a seeded generator that removes cells only while the solution stays **unique** (easy ≈40, medium ≈32, hard ≈26 clues). Same seed → same puzzle; a daily puzzle is seeded from the date.

- UI: keyboard (digits, arrows, N for notes) and keypad, live conflict highlighting, pencil notes, undo, server-side Check (marks wrong digits) and Hint (counted — a hinted solve is not a "clean" best time), timer, resume unfinished games
- The solution is never sent to the browser; the server regenerates it from the puzzle id and validates that givens are untouched
- Zero runtime dependencies (Node ≥ 22.13)

```bash
npm start            # http://localhost:3000, DB at ./data/gridlock.db (DB_PATH)
npm test             # solver/generator + API tests
npm run test:e2e     # Playwright (needs chromium; CHROMIUM_PATH)
```

Not deployed (no credentials available). Notes (pencil marks) are kept in the page only.
