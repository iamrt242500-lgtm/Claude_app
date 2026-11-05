import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { COOKIE, destroySession } from "@/lib/auth";

export async function POST() {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (t) destroySession(getDb(), t);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
