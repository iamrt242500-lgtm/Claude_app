import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";

export const COOKIE = "hindsight_session";
const TTL_MS = 1000 * 60 * 60 * 24 * 30;

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [s, k] = stored.split(":");
  if (!s || !k) return false;
  const expected = Buffer.from(k, "hex");
  const key = crypto.scryptSync(pw, Buffer.from(s, "hex"), expected.length);
  return crypto.timingSafeEqual(key, expected);
}
const sha = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export function createSession(db: DatabaseSync, userId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)").run(sha(token), userId, Date.now() + TTL_MS);
  return token;
}
export function userForToken(db: DatabaseSync, token: string | undefined): { id: number; email: string } | null {
  if (!token) return null;
  const row = db.prepare("SELECT u.id, u.email, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?").get(sha(token)) as
    | { id: number; email: string; expires_at: number } | undefined;
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, email: row.email };
}
export function destroySession(db: DatabaseSync, token: string) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha(token));
}
export async function currentUser() {
  const jar = await cookies();
  return userForToken(getDb(), jar.get(COOKIE)?.value);
}
export const cookieOptions = () => ({
  httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL_MS / 1000,
});
