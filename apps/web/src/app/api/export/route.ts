import { NextResponse } from "next/server";
import { q, DEMO_PROFILE_ID } from "@/server/db";
import { checkPolicy, audit } from "@/server/pdp";
import { requireRole } from "@/server/auth";

// Legacy Archive Format, draft 0 (P7): everything needed to rebuild the archive,
// in one open JSON bundle. Raw media files ride alongside (vault paths included).
export async function GET() {
  const user = await requireRole("subject", "steward");
  if (!user) return NextResponse.json({ error: "sign in as the subject to export" }, { status: 401 });

  const policy = await checkPolicy(DEMO_PROFILE_ID, user.actor, "text", "export");
  if (!policy.allowed) return NextResponse.json({ error: policy.reason }, { status: 403 });

  const [profile] = await q("select * from profiles where id = $1", [DEMO_PROFILE_ID]);
  const bundle = {
    laf_version: "0.0.1",
    exported_at: new Date().toISOString(),
    profile,
    consent_events: await q(
      "select * from consent_events where profile_id = $1 order by id",
      [DEMO_PROFILE_ID]
    ),
    media_objects: await q(
      "select id, kind, filename, sha256, vault_path, status, created_at from media_objects where profile_id = $1 order by created_at",
      [DEMO_PROFILE_ID]
    ),
    transcripts: await q(
      "select id, media_id, body, source, created_at from transcripts where profile_id = $1 order by created_at",
      [DEMO_PROFILE_ID]
    ),
    story_units: await q(
      "select id, transcript_id, seq, body, char_start, char_end from story_units where profile_id = $1 order by transcript_id, seq",
      [DEMO_PROFILE_ID]
    ),
    facts: await q(
      "select id, story_unit_id, statement, char_start, char_end, confidence, status, reviewed_at from facts where profile_id = $1 order by created_at",
      [DEMO_PROFILE_ID]
    ),
    audit_summary: await q(
      "select action, count(*)::int as count from audit_log group by action order by count desc"
    ),
  };
  await audit(user.actor, "archive.exported", DEMO_PROFILE_ID);

  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "content-type": "application/json",
      "content-disposition": 'attachment; filename="legacy-archive.json"',
    },
  });
}
