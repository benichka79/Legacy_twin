import { NextRequest, NextResponse } from "next/server";
import { respond } from "@/server/respond";

// The interactant is a demo family member who has opted in (see db/seed.sql).
const ACTOR = "family:demo";

export async function POST(req: NextRequest) {
  const { question } = (await req.json()) as { question?: string };
  if (!question?.trim()) return NextResponse.json({ error: "question required" }, { status: 400 });
  const result = await respond(question.trim(), ACTOR);
  return NextResponse.json(result);
}
