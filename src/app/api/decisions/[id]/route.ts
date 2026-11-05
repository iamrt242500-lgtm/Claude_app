import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { deleteDecision, getDecision, patchSchema, updateDecision } from "@/lib/decisions";
import { err, readJson, withUser } from "@/lib/http";

type Ctx = { params: Promise<{ id: string }> };
const parseId = (s: string) => (/^\d+$/.test(s) ? Number(s) : null);

export const GET = (_r: Request, { params }: Ctx) => withUser(async (u) => {
  const id = parseId((await params).id);
  const d = id && getDecision(getDb(), u.id, id);
  return d ? NextResponse.json(d) : err("찾을 수 없습니다", 404);
});
export const PATCH = (req: Request, { params }: Ctx) => withUser(async (u) => {
  const id = parseId((await params).id);
  if (!id) return err("잘못된 ID", 400);
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return err(parsed.error.issues[0].message);
  const d = updateDecision(getDb(), u.id, id, parsed.data);
  return d ? NextResponse.json(d) : err("찾을 수 없습니다", 404);
});
export const DELETE = (_r: Request, { params }: Ctx) => withUser(async (u) => {
  const id = parseId((await params).id);
  return id && deleteDecision(getDb(), u.id, id) ? NextResponse.json({ ok: true }) : err("찾을 수 없습니다", 404);
});
