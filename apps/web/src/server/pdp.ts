import { q } from "./db";

// Policy decision point (P1): every API route calls this before touching memory data.
// Consent state is derived from the append-only ledger — latest event per scope wins.

export type Modality = "text" | "voice" | "likeness";
export type Purpose = "capture" | "conversation" | "export" | "research";

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
}

function roleOf(actor: string): string {
  return actor.split(":")[0] ?? actor;
}

export async function checkPolicy(
  profileId: string,
  actor: string,
  modality: Modality,
  purpose: Purpose
): Promise<PolicyDecision> {
  // 0. The subject has inherent agency over their own archive (capture, edit, export,
  // revoke — plan §3). Identity verification, not consent, is what gates this; auth
  // is stubbed in the skeleton. Research use is the exception: always needs a grant.
  if (roleOf(actor) === "subject" && purpose !== "research") {
    return { allowed: true, reason: "subject acting on own archive" };
  }

  // 1. Subject must have granted this modality+purpose to the actor's role (audience).
  const subjectGrant = await q<{ action: string }>(
    `select action from consent_events
     where profile_id = $1 and modality = $2 and purpose = $3
       and actor like 'subject:%' and audience = $4
     order by id desc limit 1`,
    [profileId, modality, purpose, roleOf(actor)]
  );
  if (subjectGrant[0]?.action !== "grant") {
    return { allowed: false, reason: `no subject grant for ${roleOf(actor)}/${modality}/${purpose}` };
  }

  // 2. Mutual consent: for conversation, the interactant must have opted in themselves.
  if (purpose === "conversation" && roleOf(actor) !== "subject") {
    const optIn = await q<{ action: string }>(
      `select action from consent_events
       where profile_id = $1 and actor = $2 and purpose = 'conversation' and audience = 'self'
       order by id desc limit 1`,
      [profileId, actor]
    );
    if (optIn[0]?.action !== "grant") {
      return { allowed: false, reason: `interactant ${actor} has not opted in` };
    }
  }

  return { allowed: true, reason: "ok" };
}

export async function audit(
  actor: string,
  action: string,
  subject?: string,
  detail?: Record<string, unknown>
): Promise<void> {
  await q(
    "insert into audit_log (actor, action, subject, detail) values ($1, $2, $3, $4)",
    [actor, action, subject ?? null, detail ? JSON.stringify(detail) : null]
  );
}
