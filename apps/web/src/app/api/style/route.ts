import { NextResponse } from "next/server";
import { q, DEMO_PROFILE_ID } from "@/server/db";
import { checkPolicy, audit } from "@/server/pdp";

// Style layer control: POST enqueues a derivation job (worker builds a new
// profile version from approved first-party samples); GET returns the latest.
// Only the subject shapes their own voice; auth stubbed in the skeleton.
const ACTOR = "subject:miriam";

export async function POST() {
  const policy = await checkPolicy(DEMO_PROFILE_ID, ACTOR, "text", "capture");
  if (!policy.allowed) return NextResponse.json({ error: policy.reason }, { status: 403 });

  await q("insert into jobs (kind, payload) values ('derive_style', $1)", [
    JSON.stringify({ profile_id: DEMO_PROFILE_ID }),
  ]);
  await audit(ACTOR, "style.derive_requested", DEMO_PROFILE_ID);
  return NextResponse.json({ queued: true, note: "run the worker: npm run worker" });
}

export async function GET() {
  const [profile] = await q(
    `select version, params, sample_chars, derived_by, created_at
     from style_profiles where profile_id = $1 order by version desc limit 1`,
    [DEMO_PROFILE_ID]
  );
  return NextResponse.json(profile ?? { version: 0, note: "no style profile derived yet" });
}
