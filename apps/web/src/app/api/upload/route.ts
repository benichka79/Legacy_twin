import { NextRequest, NextResponse } from "next/server";
import { q, DEMO_PROFILE_ID } from "@/server/db";
import { putOriginal } from "@/server/vault";
import { checkPolicy, audit } from "@/server/pdp";
import { requireRole } from "@/server/auth";

export async function POST(req: NextRequest) {
  // Only the subject records into their own archive (stewards arrive in Phase 2).
  const user = await requireRole("subject");
  if (!user) return NextResponse.json({ error: "sign in as the subject to upload" }, { status: 401 });

  const policy = await checkPolicy(DEMO_PROFILE_ID, user.actor, "text", "capture");
  if (!policy.allowed) return NextResponse.json({ error: policy.reason }, { status: 403 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const kind = /\.(txt|md)$/i.test(file.name) || file.type.startsWith("text/") ? "text" : "audio";
  const { sha256, vaultPath } = putOriginal(buf, file.name);

  const media = await q<{ id: string }>(
    `insert into media_objects (profile_id, kind, filename, sha256, vault_path)
     values ($1, $2, $3, $4, $5) returning id`,
    [DEMO_PROFILE_ID, kind, file.name, sha256, vaultPath]
  );
  await q("insert into jobs (kind, payload) values ('process_media', $1)", [
    JSON.stringify({ media_id: media[0].id }),
  ]);
  await audit(user.actor, "media.ingested", media[0].id, { filename: file.name, kind, sha256 });

  return NextResponse.json({ media_id: media[0].id, kind, sha256 });
}
