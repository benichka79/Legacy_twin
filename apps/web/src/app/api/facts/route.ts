import { NextRequest, NextResponse } from "next/server";
import { q, DEMO_PROFILE_ID } from "@/server/db";
import { audit } from "@/server/pdp";
import { requireRole } from "@/server/auth";

// Review queue actions — the only path from candidate to approved (P1/P2).
// Only the subject decides what enters their memory graph.
export async function PATCH(req: NextRequest) {
  const user = await requireRole("subject");
  if (!user) return NextResponse.json({ error: "only the subject can review facts" }, { status: 401 });

  const { fact_id, action } = (await req.json()) as { fact_id?: string; action?: string };
  if (!fact_id || !["approve", "reject"].includes(action ?? "")) {
    return NextResponse.json({ error: "expected {fact_id, action: approve|reject}" }, { status: 400 });
  }
  const status = action === "approve" ? "approved" : "rejected";
  const rows = await q<{ id: string }>(
    `update facts set status = $1, reviewed_at = now()
     where id = $2 and profile_id = $3 and status = 'candidate'
     returning id`,
    [status, fact_id, DEMO_PROFILE_ID]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "fact not found or not a candidate" }, { status: 404 });
  }
  await audit(user.actor, `fact.${status}`, fact_id);
  return NextResponse.json({ fact_id, status });
}
