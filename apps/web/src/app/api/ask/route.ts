import { NextRequest, NextResponse } from "next/server";
import { respond } from "@/server/respond";
import { requireRole } from "@/server/auth";

// The answer path chains several model calls (generate, verify, style, diff);
// on serverless hosts this route needs more than the default function budget.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Any granted role may ask; the PDP enforces consent (incl. per-person opt-in).
  const user = await requireRole();
  if (!user) return NextResponse.json({ error: "sign in to ask" }, { status: 401 });

  const { question, conversation_id } = (await req.json()) as {
    question?: string;
    conversation_id?: string;
  };
  if (!question?.trim()) return NextResponse.json({ error: "question required" }, { status: 400 });
  const result = await respond(question.trim(), user.actor, undefined, conversation_id ?? null);
  return NextResponse.json(result);
}
