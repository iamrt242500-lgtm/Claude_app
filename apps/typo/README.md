# Typo — typing practice with honest stats

Type real passages (easy / medium / hard — the hard set has code, numbers and punctuation). Characters turn green/red as you type, backspace fixes mistakes, the timer starts with your first key, and you get **net WPM** (5 characters = 1 word, only correct characters count), **raw WPM**, **accuracy** (keystroke-level: corrected mistakes still cost accuracy), time, and the characters you missed most. The **Progress** page shows your average of the last 10 runs, best per level, practice streak, a WPM-over-time chart, your weakest keys and history. `Esc` restarts, `Tab` loads the next passage, pasting is blocked.

**Integrity (tested):** the server **recomputes WPM/accuracy from the raw numbers** (duration, typed, correct, keystrokes, wrong keystrokes) and ignores any client-claimed WPM; results are rejected when inconsistent (`correct > typed`, `typed > passage length`, fewer keystrokes than characters) or faster than 1 500 characters/minute (≈ 300 WPM — not humanly possible). Personal-best detection is server-side; the practice day uses the browser's date (validated to ±1 day of UTC).

```bash
cd apps/typo && npm start     # http://localhost:3000 (PORT, DB_PATH=./data/typo.db)
npm test                       # 12 unit + API tests
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e   # a fake browser clock makes WPM exact: 77 chars in 30 s = 30.8 WPM
```
**API:** `GET /api/passages[?level]`, `POST /api/results`, `GET /api/results`, `DELETE /api/results[/:id]`, `GET /api/stats`, `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS (hidden-input capture, SVG chart), `src/typing.js` shared by server/browser/tests, zero runtime dependencies.
**Limitations:** English passages only (12 built-in, original text); results are self-reported, so the plausibility check stops absurd numbers but not a determined cheater (a script can type 250 WPM); no IME/composition handling; no custom text, timed mode or multiplayer; single user, no auth; not deployed.
**Notes from testing:** E2E drives `Date.now()` with Playwright's fake clock, so the assertions on WPM and accuracy are exact rather than "within a range".
