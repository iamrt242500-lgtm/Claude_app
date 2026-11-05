import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { brierScore, calibration, overconfidence, type Resolved } from "./scoring";

export const createSchema = z.object({
  title: z.string().trim().min(1, "제목을 입력하세요").max(200),
  context: z.string().trim().max(5000).default(""),
  prediction: z.string().trim().min(1, "예측을 입력하세요").max(1000),
  confidence: z.number().int().min(1).max(99),
  review_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식이 올바르지 않습니다"),
});
export const patchSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  context: z.string().trim().max(5000).optional(),
  prediction: z.string().trim().min(1).max(1000).optional(),
  confidence: z.number().int().min(1).max(99).optional(),
  review_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  outcome: z.union([z.literal(0), z.literal(1), z.null()]).optional(),
  lessons: z.string().trim().max(5000).optional(),
});

export interface Decision {
  id: number; title: string; context: string; prediction: string; confidence: number;
  review_date: string; outcome: 0 | 1 | null; lessons: string; created_at: string; resolved_at: string | null;
}
const COLS = "id,title,context,prediction,confidence,review_date,outcome,lessons,created_at,resolved_at";

export function listDecisions(db: DatabaseSync, userId: number): Decision[] {
  return db.prepare(`SELECT ${COLS} FROM decisions WHERE user_id=? ORDER BY (outcome IS NOT NULL), review_date ASC, id DESC`).all(userId) as unknown as Decision[];
}
export function getDecision(db: DatabaseSync, userId: number, id: number): Decision | undefined {
  return db.prepare(`SELECT ${COLS} FROM decisions WHERE id=? AND user_id=?`).get(id, userId) as unknown as Decision | undefined;
}
export function createDecision(db: DatabaseSync, userId: number, d: z.infer<typeof createSchema>): Decision {
  const r = db.prepare("INSERT INTO decisions (user_id,title,context,prediction,confidence,review_date) VALUES (?,?,?,?,?,?)")
    .run(userId, d.title, d.context, d.prediction, d.confidence, d.review_date);
  return getDecision(db, userId, Number(r.lastInsertRowid))!;
}
export function updateDecision(db: DatabaseSync, userId: number, id: number, p: z.infer<typeof patchSchema>): Decision | undefined {
  const cur = getDecision(db, userId, id);
  if (!cur) return undefined;
  const next = { ...cur, ...p };
  const resolvedAt = next.outcome === null || next.outcome === undefined ? null : cur.resolved_at ?? new Date().toISOString();
  db.prepare("UPDATE decisions SET title=?,context=?,prediction=?,confidence=?,review_date=?,outcome=?,lessons=?,resolved_at=? WHERE id=? AND user_id=?")
    .run(next.title, next.context, next.prediction, next.confidence, next.review_date, next.outcome, next.lessons, resolvedAt, id, userId);
  return getDecision(db, userId, id);
}
export function deleteDecision(db: DatabaseSync, userId: number, id: number): boolean {
  return Number(db.prepare("DELETE FROM decisions WHERE id=? AND user_id=?").run(id, userId).changes) > 0;
}
export function statsFor(db: DatabaseSync, userId: number) {
  const all = listDecisions(db, userId);
  const resolved = all.filter((d) => d.outcome !== null) as (Decision & Resolved)[];
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: all.length,
    open: all.length - resolved.length,
    dueForReview: all.filter((d) => d.outcome === null && d.review_date <= today).length,
    resolved: resolved.length,
    hitRate: resolved.length ? (resolved.filter((d) => d.outcome === 1).length / resolved.length) * 100 : null,
    brier: brierScore(resolved),
    overconfidence: overconfidence(resolved),
    calibration: calibration(resolved),
  };
}
