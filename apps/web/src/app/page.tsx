import { q, DEMO_PROFILE_ID } from "@/server/db";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [profile] = await q<{ display_name: string; lifecycle: string }>(
    "select display_name, lifecycle from profiles where id = $1",
    [DEMO_PROFILE_ID]
  );
  const [counts] = await q<Record<string, string>>(
    `select
       (select count(*) from media_objects where profile_id = $1)                       as media,
       (select count(*) from story_units  where profile_id = $1)                        as units,
       (select count(*) from facts where profile_id = $1 and status = 'approved')       as approved,
       (select count(*) from facts where profile_id = $1 and status = 'candidate')      as candidates,
       (select count(*) from jobs where status in ('queued','running'))                 as jobs_open,
       (select count(*) from jobs where status = 'error')                               as jobs_error,
       (select count(*) from audit_log)                                                 as audit,
       (select coalesce(max(version), 0) from style_profiles where profile_id = $1)     as style_version`,
    [DEMO_PROFILE_ID]
  );

  return (
    <>
      <h1>{profile?.display_name ?? "No profile"}</h1>
      <p className="sub">
        lifecycle: <span className="mono">{profile?.lifecycle}</span> · walking skeleton of the
        Phase 1 concierge build
      </p>
      <div className="grid">
        <div className="card stat"><div className="n">{counts.media}</div><div className="l">media objects</div></div>
        <div className="card stat"><div className="n">{counts.units}</div><div className="l">story units</div></div>
        <div className="card stat"><div className="n">{counts.approved}</div><div className="l">approved facts</div></div>
        <div className="card stat"><div className="n">{counts.candidates}</div><div className="l">awaiting review</div></div>
        <div className="card stat"><div className="n">{counts.jobs_open}</div><div className="l">open jobs</div></div>
        <div className="card stat"><div className="n">{counts.audit}</div><div className="l">audit events</div></div>
        <div className="card stat"><div className="n">v{counts.style_version}</div><div className="l">style profile</div></div>
      </div>
      {Number(counts.jobs_error) > 0 && (
        <p className="mono" style={{ color: "var(--oxide)" }}>
          {counts.jobs_error} pipeline job(s) errored — check the worker logs.
        </p>
      )}
      <div className="card">
        <p style={{ margin: 0 }}>
          Flow: <b>Capture</b> uploads a story → the Python worker transcribes, segments, and
          proposes candidate facts → the subject approves them in <b>Review</b> → <b>Ask</b>{" "}
          answers only from approved facts, with citations — or refuses honestly.
        </p>
      </div>
    </>
  );
}
