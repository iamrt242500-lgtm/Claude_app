import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createDecision, createSchema, listDecisions } from "@/lib/decisions";
import { err, readJson, withUser } from "@/lib/http";

export const GET = () => withUser((u) => NextResponse.json(listDecisions(getDb(), u.id)));

export const POST = (req: Request) => withUser(async (u) => {
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return err(parsed.error.issues[0].message);
  return NextResponse.json(createDecision(getDb(), u.id, parsed.data), { status: 201 });
});
