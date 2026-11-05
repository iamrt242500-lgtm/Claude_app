import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { statsFor } from "@/lib/decisions";
import { withUser } from "@/lib/http";

export const GET = () => withUser((u) => NextResponse.json(statsFor(getDb(), u.id)));
