import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { COOKIE, cookieOptions, createSession, hashPassword } from "@/lib/auth";
import { err, readJson } from "@/lib/http";

const schema = z.object({ email: z.string().trim().toLowerCase().email("올바른 이메일이 아닙니다"), password: z.string().min(8, "비밀번호는 8자 이상이어야 합니다").max(200) });

export async function POST(req: Request) {
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return err(parsed.error.issues[0].message);
  const db = getDb();
  try {
    const r = db.prepare("INSERT INTO users (email, password_hash) VALUES (?,?)").run(parsed.data.email, hashPassword(parsed.data.password));
    const token = createSession(db, Number(r.lastInsertRowid));
    const res = NextResponse.json({ email: parsed.data.email }, { status: 201 });
    res.cookies.set(COOKIE, token, cookieOptions());
    return res;
  } catch (e) {
    if (String(e).includes("UNIQUE")) return err("이미 가입된 이메일입니다", 409);
    console.error(e);
    return err("서버 오류가 발생했습니다", 500);
  }
}
