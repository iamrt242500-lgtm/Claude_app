# Quizzly — make and take quizzes with server-side grading

Create quizzes with **single-choice**, **multiple-choice** (partial credit) and **short-answer** questions (accepted answers matched case-, accent- and punctuation-insensitively), optional explanations, reordering, and 2–8 options. Take a quiz one question at a time with shuffled question and option order, go back without losing answers, get a graded result with a full review (your answer, the correct answer, explanation), retake it, and see attempt history and best/last scores.

**Answer secrecy:** the `play` endpoint never sends the answer key, accepted short answers or explanations. Options carry their original ids, so grading is done on the server from whatever order the learner saw — an API test and an E2E test inspect the actual network payload to prove nothing leaks. **Scoring:** single = all-or-nothing; multi = (right picks − wrong picks) / correct count, floored at 0; short = normalized equality; percent = mean question score.

```bash
cd apps/quizzly && npm start     # http://localhost:3000 (PORT, DB_PATH=./data/quizzly.db)
npm test                          # 13 unit + API tests (seeded RNG, shuffle fairness check)
CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e
```
**API:** `GET/POST /api/quizzes`, `GET/PUT/DELETE /api/quizzes/:id` (author view with answers), `GET /api/quizzes/:id/play` (no key), `GET/POST /api/quizzes/:id/attempts` (POST grades and returns the review), `GET /api/health`.
**Stack:** Node 22 `node:http` + `node:sqlite`, vanilla JS, zero runtime dependencies.
**Limitations:** single user / no auth, **anyone who can reach `/api/quizzes/:id` can read the answer key** (author view) — it protects against casual inspection of the quiz-taking page, not against someone calling the API; attempts are stored by answer, not timed; no images/rich text/question banks/sharing links; not deployed.
**Found by E2E and fixed:** the result page's "Retake" link pointed at the current hash and did nothing; accepted-answer de-duplication kept the last spelling instead of the first.
