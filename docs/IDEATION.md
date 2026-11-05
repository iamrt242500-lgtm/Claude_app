# Ideation
Scores (0–10) weighted: value 25, feasibility 25, completeness 20, differentiation 15, maintainability 10, cost 5. Scores are my own judgment, not measured data.

| # | Idea | Val | Feas | Compl | Diff | Maint | Cost | Total |
|---|---|---|---|---|---|---|---|---|
| 1 | **Decision journal + calibration analytics (Hindsight)** | 8 | 10 | 9 | 8 | 9 | 10 | **8.95** |
| 2 | Meeting-notes action-item extractor (needs LLM) | 8 | 6 | 7 | 5 | 6 | 3 | 6.3 |
| 3 | Dev "TIL" snippet manager | 6 | 9 | 8 | 4 | 8 | 10 | 7.1 |
| 4 | CSV quick-profiler / chart tool | 7 | 8 | 7 | 4 | 7 | 9 | 6.9 |
| 5 | Habit tracker with streaks | 6 | 9 | 9 | 2 | 8 | 10 | 7.0 |
| 6 | Reading list + spaced-review notes | 6 | 9 | 8 | 4 | 8 | 10 | 7.1 |
| 7 | Kanban board for solo projects | 6 | 8 | 8 | 2 | 7 | 10 | 6.6 |
| 8 | Cron expression explainer/tester | 5 | 9 | 7 | 3 | 8 | 10 | 6.5 |
| 9 | Flashcards with SM-2 scheduling | 7 | 8 | 8 | 3 | 8 | 10 | 7.3 |
| 10 | Invoice generator for freelancers | 6 | 7 | 7 | 3 | 6 | 10 | 6.2 |

**Choice: #1.** Clear scenario (record → review → learn), fully implementable without external APIs, free to run (single SQLite file), and a distinctive analytic core (Brier score and calibration buckets) rather than a plain CRUD list. AI was deliberately not used: it adds no value to the core loop and would add cost and a dependency.
Market research was not performed (no web research in this run); no competitor claims are made.
