import { NextResponse } from "next/server";
import { currentUser } from "./auth";

export const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function readJson(req: Request): Promise<unknown | null> {
  try { return await req.json(); } catch { return null; }
}
export async function withUser(fn: (user: { id: number; email: string }) => Promise<Response> | Response): Promise<Response> {
  try {
    const user = await currentUser();
    if (!user) return err("로그인이 필요합니다", 401);
    return await fn(user);
  } catch (e) {
    console.error(e);
    return err("서버 오류가 발생했습니다", 500);
  }
}
