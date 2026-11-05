import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { COOKIE, cookieOptions, createSession, verifyPassword } from "@/lib/auth";
import { err, readJson } from "@/lib/http";

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return err("이메일과 비밀번호를 확인하세요");
  const db = getDb();
  const u = db.prepare("SELECT id, password_hash FROM users WHERE email=?").get(parsed.data.email) as { id: number; password_hash: string } | undefined;
  if (!u || !verifyPassword(parsed.data.password, u.password_hash)) return err("이메일 또는 비밀번호가 올바르지 않습니다", 401);
  const res = NextResponse.json({ email: parsed.data.email });
  res.cookies.set(COOKIE, createSession(db, u.id), cookieOptions());
  return res;
}
