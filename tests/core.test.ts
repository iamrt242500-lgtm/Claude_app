import { describe, expect, it } from "vitest";
import { openDb } from "@/lib/db";
import { brierScore, calibration, overconfidence } from "@/lib/scoring";
import { createDecision, createSchema, deleteDecision, getDecision, listDecisions, statsFor, updateDecision } from "@/lib/decisions";
import { createSession, hashPassword, userForToken, verifyPassword } from "@/lib/auth";


function setup() {
  const db = openDb(":memory:");
  const mk = (e: string) => Number(db.prepare("INSERT INTO users (email,password_hash) VALUES (?,?)").run(e, hashPassword("password1")).lastInsertRowid);
  return { db, a: mk("a@x.com"), b: mk("b@x.com") };
}
const base = { title: "이직", context: "", prediction: "1년 내 연봉 상승", confidence: 70, review_date: "2026-01-01" };

describe("scoring", () => {
  it("brier perfect and worst", () => {
    expect(brierScore([{ confidence: 99, outcome: 1 }])).toBeCloseTo(0.0001);
    expect(brierScore([{ confidence: 90, outcome: 0 }])).toBeCloseTo(0.81);
    expect(brierScore([])).toBeNull();
  });
  it("calibration buckets and overconfidence", () => {
    const items = [{ confidence: 90, outcome: 0 as const }, { confidence: 90, outcome: 1 as const }, { confidence: 30, outcome: 0 as const }];
    const c = calibration(items);
    expect(c[4].count).toBe(2); expect(c[4].hitRate).toBe(50); expect(c[1].count).toBe(1); expect(c[0].hitRate).toBeNull();
    expect(overconfidence(items)).toBeCloseTo(70 - 100 / 3);
  });
});

describe("decisions repo", () => {
  it("CRUD and resolve", () => {
    const { db, a } = setup();
    const d = createDecision(db, a, createSchema.parse(base));
    expect(d.outcome).toBeNull();
    const r = updateDecision(db, a, d.id, { outcome: 1, lessons: "맞았다" })!;
    expect(r.outcome).toBe(1); expect(r.resolved_at).not.toBeNull();
    expect(updateDecision(db, a, d.id, { outcome: null })!.resolved_at).toBeNull();
    expect(deleteDecision(db, a, d.id)).toBe(true);
    expect(listDecisions(db, a)).toHaveLength(0);
  });
  it("isolates users", () => {
    const { db, a, b } = setup();
    const d = createDecision(db, a, createSchema.parse(base));
    expect(getDecision(db, b, d.id)).toBeUndefined();
    expect(updateDecision(db, b, d.id, { title: "hack" })).toBeUndefined();
    expect(deleteDecision(db, b, d.id)).toBe(false);
    expect(listDecisions(db, b)).toHaveLength(0);
  });
  it("validates input", () => {
    expect(createSchema.safeParse({ ...base, confidence: 100 }).success).toBe(false);
    expect(createSchema.safeParse({ ...base, confidence: 0 }).success).toBe(false);
    expect(createSchema.safeParse({ ...base, title: "  " }).success).toBe(false);
    expect(createSchema.safeParse({ ...base, review_date: "내일" }).success).toBe(false);
  });
  it("stats", () => {
    const { db, a } = setup();
    const d1 = createDecision(db, a, createSchema.parse(base));
    createDecision(db, a, createSchema.parse(base));
    updateDecision(db, a, d1.id, { outcome: 0 });
    const s = statsFor(db, a);
    expect(s).toMatchObject({ total: 2, open: 1, resolved: 1, hitRate: 0, dueForReview: 1 });
    expect(s.brier).toBeCloseTo(0.49);
  });
});

describe("auth", () => {
  it("passwords and sessions", () => {
    const h = hashPassword("secret123");
    expect(verifyPassword("secret123", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
    const { db, a } = setup();
    const t = createSession(db, a);
    expect(userForToken(db, t)?.id).toBe(a);
    expect(userForToken(db, "bogus")).toBeNull();
    expect(userForToken(db, undefined)).toBeNull();
  });
});
