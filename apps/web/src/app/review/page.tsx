import { redirect } from "next/navigation";
import { q, DEMO_PROFILE_ID } from "@/server/db";
import { requireUser } from "@/server/auth";
import { ReviewButtons } from "./buttons";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const user = await requireUser();
  if (user.role !== "subject") redirect("/");
  const candidates = await q<{
    id: string;
    statement: string;
    confidence: number;
    context: string;
  }>(
    `select f.id, f.statement, f.confidence, s.body as context
     from facts f join story_units s on s.id = f.story_unit_id
     where f.profile_id = $1 and f.status = 'candidate'
     order by f.created_at`,
    [DEMO_PROFILE_ID]
  );

  return (
    <>
      <h1>Review queue</h1>
      <p className="sub">
        Nothing enters the memory graph without the subject&apos;s approval. Approve only what&apos;s
        accurate — rejected candidates never surface in answers.
      </p>
      {candidates.length === 0 && (
        <p className="muted">No candidates waiting. Upload a story in Capture and run the worker.</p>
      )}
      {candidates.map((f) => (
        <div className="card" key={f.id}>
          <p style={{ marginTop: 0 }}>{f.statement}</p>
          <p className="provenance">
            source: &ldquo;{f.context.slice(0, 140)}…&rdquo; · confidence {f.confidence}
          </p>
          <ReviewButtons factId={f.id} />
        </div>
      ))}
    </>
  );
}
