import { q, DEMO_PROFILE_ID } from "./db";
import { checkPolicy, audit } from "./pdp";
import { getLLM, type SpanRef } from "./adapters/llm";

// The answer path (ARCHITECTURE.md §7 / fig 2):
// consent gate → retrieve approved-only → sufficiency gate → generate → verify → cite.
// Every failure lands on the same honest refusal.

export interface Citation {
  n: number;
  fact_id: string;
  story_unit_id: string;
  quote: string;
}

export interface AnswerResult {
  kind: "grounded" | "refusal" | "disclosure" | "denied";
  text: string;
  citations: Citation[];
  trace: Record<string, unknown>;
}

const REFUSAL_TEXT =
  "I never recorded anything about that, so I can't answer — I only speak from what was approved.";

const DISCLOSURE_RE =
  /\b(are you (really|actually) (him|her|them|alive|conscious)|is (this|that) really|are you a (real )?person|are you an ai)\b/i;

const DISCLOSURE_TEXT =
  "I'm an AI representation built only from stories this person recorded and approved. I'm not the person, and I don't have memories beyond what they chose to keep here.";

// Sufficiency gate: at least this fraction of the question's content words must be
// supported by a retrieved span. Embeddings replace this heuristic later; the gate stays.
const MIN_COVERAGE = 0.34;

const STOPWORDS = new Set(
  ("a an the is was were are be been did do does has had have how what who where when why " +
    "which tell me about her his their she he they it in at on of to for with and or my your " +
    "you i we us our them this that these those").split(" ")
);

function contentTokens(text: string, exclude: Set<string>): string[] {
  return [...new Set(
    text.toLowerCase().split(/[^a-z0-9']+/).filter(
      (t) => t.length >= 3 && !STOPWORDS.has(t) && !exclude.has(t)
    )
  )];
}

// met≈meet, work≈working — cheap morphological tolerance until embeddings land.
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l.length >= 4 && s.length >= 4 && l.startsWith(s)) return true;
  if (l.length - s.length > 1 || l.length < 4) return false;
  // edit distance <= 1
  let i = 0, j = 0, edits = 0;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (s.length === l.length) { i++; j++; } else j++;
  }
  return edits + (l.length - j) + (s.length - i) <= 1;
}

function coverage(queryTokens: string[], haystack: string): number {
  if (queryTokens.length === 0) return 0;
  const hay = contentTokens(haystack, new Set());
  const hit = queryTokens.filter((qt) => hay.some((ht) => tokensMatch(qt, ht)));
  return hit.length / queryTokens.length;
}

export async function respond(
  question: string,
  actor: string,
  profileId: string = DEMO_PROFILE_ID
): Promise<AnswerResult> {
  const trace: Record<string, unknown> = { actor, profileId };

  // 1. Consent gate (P1)
  const policy = await checkPolicy(profileId, actor, "text", "conversation");
  trace.policy = policy;
  if (!policy.allowed) {
    await persist(profileId, actor, question, { kind: "denied", text: policy.reason, citations: [], trace });
    return { kind: "denied", text: `Access denied: ${policy.reason}`, citations: [], trace };
  }

  // 2. Constitution boundary: the persona says what it is when asked.
  if (DISCLOSURE_RE.test(question)) {
    const result: AnswerResult = { kind: "disclosure", text: DISCLOSURE_TEXT, citations: [], trace };
    await persist(profileId, actor, question, result);
    return result;
  }

  // 3. Entity resolution (skeleton version): the subject's own name is implicit in
  // every question about them — first-person recordings rarely contain it.
  const [profile] = await q<{ display_name: string }>(
    "select display_name from profiles where id = $1",
    [profileId]
  );
  const nameTokens = new Set(contentTokens(profile?.display_name ?? "", new Set()));
  const qTokens = contentTokens(question, nameTokens);

  // 4a. Broad recall: OR-query over approved facts + their story units (P2).
  // plainto_tsquery ANDs terms; rewriting to OR keeps recall high — precision
  // comes from the coverage gate below. Embeddings replace this later.
  const rows = await q<{
    fact_id: string;
    story_unit_id: string;
    statement: string;
    context: string;
  }>(
    `with tq as (
       select nullif(replace(plainto_tsquery('english', $2)::text, ' & ', ' | '), '')::tsquery as v
     )
     select f.id as fact_id, s.id as story_unit_id, f.statement, s.body as context
     from facts f
     join story_units s on s.id = f.story_unit_id, tq
     where f.profile_id = $1
       and f.status = 'approved'
       and tq.v is not null
       and ( s.tsv @@ tq.v or to_tsvector('english', f.statement) @@ tq.v )
     limit 24`,
    [profileId, question]
  );

  // 4b. Sufficiency gate: order by how much of the question each span actually supports.
  const scored = rows
    .map((r) => ({ ...r, score: coverage(qTokens, `${r.statement} ${r.context}`) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  trace.retrieved = scored.map((r) => ({ fact: r.fact_id, score: r.score }));

  if (scored.length === 0 || scored[0].score < MIN_COVERAGE) {
    trace.gate = "insufficient_evidence";
    const result: AnswerResult = { kind: "refusal", text: REFUSAL_TEXT, citations: [], trace };
    await persist(profileId, actor, question, result);
    await audit(actor, "answer.refused", profileId, { question });
    return result;
  }

  const spans: SpanRef[] = scored
    .filter((r) => r.score >= MIN_COVERAGE)
    .map((r, i) => ({
      n: i + 1,
      factId: r.fact_id,
      storyUnitId: r.story_unit_id,
      statement: r.statement,
      context: r.context,
    }));

  // 5–6. Grounded generation + verification, one retry, then refusal.
  const llm = getLLM();
  trace.llm = llm.name;
  let text = "";
  let verified = false;
  for (let attempt = 1; attempt <= 2 && !verified; attempt++) {
    const draft = await llm.generate(question, spans);
    if (draft.notRecorded) break;
    const check = await llm.verify(draft.text, spans);
    trace[`verify_attempt_${attempt}`] = check;
    if (check.ok) {
      text = draft.text;
      verified = true;
    }
  }

  if (!verified) {
    trace.gate = "verification_failed_or_not_recorded";
    const result: AnswerResult = { kind: "refusal", text: REFUSAL_TEXT, citations: [], trace };
    await persist(profileId, actor, question, result);
    await audit(actor, "answer.refused", profileId, { question });
    return result;
  }

  // 6b. Style pass (§8): rewrite in the subject's voice — tone only. Two gates
  // enforce "never facts": every citation marker must survive, and the styled
  // text must re-pass claim-to-source verification. Otherwise fall back.
  const [styleProfile] = await q<{ version: number; params: Record<string, unknown> }>(
    "select version, params from style_profiles where profile_id = $1 order by version desc limit 1",
    [profileId]
  );
  if (styleProfile) {
    const markers = [...new Set([...text.matchAll(/\[\d+\]/g)].map((m) => m[0]))];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const styled = await llm.style(text, question, styleProfile.params);
      if (!(styled.length > 0 && markers.every((m) => styled.includes(m)))) {
        trace.style = { version: styleProfile.version, applied: false, reason: "citations_dropped" };
        continue;
      }
      const diff = await llm.styleDiff(text, styled, spans);
      if (diff.ok) {
        text = styled;
        trace.style = { version: styleProfile.version, applied: true, attempt };
        break;
      }
      trace.style = {
        version: styleProfile.version,
        applied: false,
        reason: "factual_drift",
        failures: diff.failures,
      };
    }
  }

  // 7. Citations: only markers that actually appear in the verified answer.
  const used = new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const citations: Citation[] = spans
    .filter((s) => used.has(s.n))
    .map((s) => ({ n: s.n, fact_id: s.factId, story_unit_id: s.storyUnitId, quote: s.statement }));

  const result: AnswerResult = { kind: "grounded", text, citations, trace };
  await persist(profileId, actor, question, result);
  await audit(actor, "answer.grounded", profileId, { question, citations: citations.length });
  return result;
}

async function persist(
  profileId: string,
  actor: string,
  question: string,
  result: Pick<AnswerResult, "kind" | "text" | "citations" | "trace">
): Promise<void> {
  const conv = await q<{ id: string }>(
    "insert into conversations (profile_id, actor) values ($1, $2) returning id",
    [profileId, actor]
  );
  await q("insert into messages (conversation_id, role, body) values ($1, 'user', $2)", [
    conv[0].id,
    question,
  ]);
  await q(
    `insert into messages (conversation_id, role, body, refusal, citations, trace)
     values ($1, 'assistant', $2, $3, $4, $5)`,
    [
      conv[0].id,
      result.text,
      result.kind === "refusal" || result.kind === "denied",
      JSON.stringify(result.citations),
      JSON.stringify(result.trace),
    ]
  );
}
