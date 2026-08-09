import { q, DEMO_PROFILE_ID } from "./db";
import { checkPolicy, audit } from "./pdp";
import { getLLM, type SpanRef, type ChatTurn } from "./adapters/llm";
import {
  getEmbed,
  toVectorLiteral,
  isZeroVector,
  type EmbedAdapter,
} from "./adapters/embed";

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
  kind: "grounded" | "extrapolation" | "refusal" | "disclosure" | "denied";
  text: string;
  citations: Citation[];
  trace: Record<string, unknown>;
  conversation_id?: string;
  message_id?: string;
}

const REFUSAL_TEXT =
  "I never recorded anything about that, so I can't answer — I only speak from what was approved.";

const DISCLOSURE_RE =
  /\b(are you (really|actually) (him|her|them|alive|conscious)|is (this|that) really|are you a (real )?person|are you an ai)\b/i;

const DISCLOSURE_TEXT =
  "I'm an AI representation built only from stories this person recorded and approved. I'm not the person, and I don't have memories beyond what they chose to keep here.";

// Sufficiency gates: a span qualifies when EITHER bar clears. Coverage is lexical
// (fraction of the question's content words supported); semantic is embedding
// cosine similarity. With the mock embedder similarity mirrors token overlap and
// rarely crosses the bar, so CI behavior is unchanged; a real embedder (Voyage)
// lets paraphrases through. Both stay strict: weak matches still refuse.
const MIN_COVERAGE = 0.34;
// Measured with voyage-3.5 on this corpus: true cross-language matches score
// ~0.51-0.62, topically-adjacent false matches peak ~0.47. The 0.50 bar admits
// truth with a thin margin; generation + claim verification backstop the rest.
const SEMANTIC_MIN = 0.5;

// Lazy self-heal: embed any rows still missing vectors. Production moves this
// into the worker; at skeleton scale, embedding stragglers at ask time keeps
// ingestion vendor-free and the archive always retrievable.
async function ensureEmbeddings(profileId: string, embedder: EmbedAdapter): Promise<void> {
  for (const table of ["story_units", "facts"] as const) {
    const col = table === "facts" ? "statement" : "body";
    const rows = await q<{ id: string; text: string }>(
      `select id, ${col} as text from ${table}
       where profile_id = $1 and embedding is null
       order by created_at limit 128`,
      [profileId]
    );
    if (rows.length === 0) continue;
    const vecs = await embedder.embed(rows.map((r) => r.text), "document");
    for (let i = 0; i < rows.length; i++) {
      await q(`update ${table} set embedding = $1::vector where id = $2`, [
        toVectorLiteral(vecs[i]),
        rows[i].id,
      ]);
    }
  }
}

// English, Russian, and Hebrew function words — the archive is multilingual.
const STOPWORDS = new Set(
  ("a an the is was were are be been did do does has had have how what who where when why " +
    "which tell me about her his their she he they it in at on of to for with and or my your " +
    "you i we us our them this that these those " +
    "и в во не на я он она оно мы вы они что это как где когда почему зачем был была было были " +
    "быть есть у о об с со к ко по за из от до для мой моя моё мои его её их твой ваш наш а но " +
    "да нет ли же бы то ты вам нам мне тебя меня себя чем кто какой какая какое какие расскажи " +
    "של את על עם הוא היא אני אתה אנחנו אתם הם הן מה מי איפה מתי למה איך זה זאת יש אין היה הייתה " +
    "היו כן לא גם או אבל אז כי אל כל עוד רק ספר ספרי לי לו לה שלו שלה שלי שלהם").split(/\s+/)
);

function contentTokens(text: string, exclude: Set<string>): string[] {
  return [...new Set(
    (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter(
      (t) => t.length >= 3 && !STOPWORDS.has(t) && !exclude.has(t)
    )
  )];
}

// met≈meet, work≈working — cheap morphological tolerance for lexical coverage.
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l.length >= 4 && s.length >= 4 && l.startsWith(s)) return true;
  if (l.length - s.length > 1 || l.length < 4) return false;
  // Short prefixes reaching the edit-distance path (car→care, cat→cats) are
  // false matches the prefix rule already rejected — keep them rejected.
  if (l.startsWith(s)) return false;
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
  profileId: string = DEMO_PROFILE_ID,
  conversationId?: string | null
): Promise<AnswerResult> {
  const trace: Record<string, unknown> = { actor, profileId };

  // 0. Conversation continuity: load recent turns of the caller's own thread.
  let history: ChatTurn[] = [];
  if (conversationId) {
    const rows = await q<{ role: "user" | "assistant"; body: string }>(
      `select m.role, m.body from messages m
       join conversations c on c.id = m.conversation_id
       where c.id = $1 and c.profile_id = $2 and c.actor = $3
       order by m.created_at desc limit 8`,
      [conversationId, profileId, actor]
    );
    history = rows.reverse().map((r) => ({ role: r.role, content: r.body }));
    if (history.length === 0) conversationId = null; // not theirs / unknown → fresh thread
    trace.conversation_turns = history.length;
  }

  // 1. Consent gate (P1)
  const policy = await checkPolicy(profileId, actor, "text", "conversation");
  trace.policy = policy;
  if (!policy.allowed) {
    await persist(profileId, actor, question, { kind: "denied", text: policy.reason, citations: [], trace }, conversationId);
    return { kind: "denied", text: `Access denied: ${policy.reason}`, citations: [], trace };
  }

  // 2. Constitution boundary: the persona says what it is when asked.
  if (DISCLOSURE_RE.test(question)) {
    const result: AnswerResult = { kind: "disclosure", text: DISCLOSURE_TEXT, citations: [], trace };
    const ids = await persist(profileId, actor, question, result, conversationId);
    return { ...result, ...ids };
  }

  // 3. Entity resolution (skeleton version): the subject's own name is implicit in
  // every question about them — first-person recordings rarely contain it.
  const [profile] = await q<{ display_name: string }>(
    "select display_name from profiles where id = $1",
    [profileId]
  );
  const nameTokens = new Set(contentTokens(profile?.display_name ?? "", new Set()));
  // Follow-ups lean on pronouns ("what did she do there?") — fold the previous
  // user question into the retrieval text so its referents stay searchable.
  const prevUserTurn = [...history].reverse().find((h) => h.role === "user")?.content ?? "";
  const retrievalText = prevUserTurn ? `${prevUserTurn}\n${question}` : question;
  const qTokens = contentTokens(retrievalText, nameTokens);

  // 4a. Broad recall, two channels over approved facts only (P2):
  // lexical (FTS OR-query — plainto_tsquery ANDs terms, so rewrite to OR)
  // and semantic (pgvector cosine over fact embeddings).
  const embedder = getEmbed();
  trace.embed = embedder.name;

  // Embedding-provider failures (rate limits, outages) degrade to lexical-only
  // retrieval — an ask must never 500 because the semantic channel is down.
  let qvec: number[] = [];
  try {
    await ensureEmbeddings(profileId, embedder);
    [qvec] = await embedder.embed([retrievalText], "query");
  } catch (err) {
    trace.embed_degraded = String(err).slice(0, 200);
  }

  interface Candidate {
    fact_id: string;
    story_unit_id: string;
    statement: string;
    context: string;
    semantic: number;
  }

  // Each row is parsed and queried in its own language configuration ('russian'
  // and 'english' stem; Hebrew/mixed use 'simple'). OR-semantics via websearch
  // rewrite keeps recall high; the coverage/semantic gates supply precision.
  const ftsRows = await q<Omit<Candidate, "semantic">>(
    `select f.id as fact_id, s.id as story_unit_id, f.statement, s.body as context
     from facts f
     join story_units s on s.id = f.story_unit_id
     where f.profile_id = $1
       and f.status = 'approved'
       and ( s.tsv @@ replace(plainto_tsquery(s.lang, $2)::text, ' & ', ' | ')::tsquery
          or to_tsvector(s.lang, f.statement) @@ replace(plainto_tsquery(s.lang, $2)::text, ' & ', ' | ')::tsquery )
     limit 24`,
    [profileId, retrievalText]
  );

  const vecRows = qvec.length === 0 || isZeroVector(qvec)
    ? []
    : await q<Candidate>(
        `select f.id as fact_id, s.id as story_unit_id, f.statement, s.body as context,
                1 - (f.embedding <=> $2::vector) as semantic
         from facts f
         join story_units s on s.id = f.story_unit_id
         where f.profile_id = $1 and f.status = 'approved' and f.embedding is not null
         order by f.embedding <=> $2::vector
         limit 12`,
        [profileId, toVectorLiteral(qvec)]
      );

  const byFact = new Map<string, Candidate>();
  for (const r of ftsRows) byFact.set(r.fact_id, { ...r, semantic: 0 });
  for (const r of vecRows) {
    const existing = byFact.get(r.fact_id);
    if (existing) existing.semantic = Number(r.semantic);
    else byFact.set(r.fact_id, { ...r, semantic: Number(r.semantic) });
  }

  // 4b. Sufficiency gate: a span qualifies via lexical coverage OR semantic
  // similarity; rank by the stronger of the two signals.
  const scored = [...byFact.values()]
    .map((r) => {
      const cov = coverage(qTokens, `${r.statement} ${r.context}`);
      return { ...r, coverage: cov, score: Math.max(cov, r.semantic) };
    })
    .filter((r) => r.coverage >= MIN_COVERAGE || r.semantic >= SEMANTIC_MIN)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  trace.retrieved = scored.map((r) => ({
    fact: r.fact_id,
    coverage: Number(r.coverage.toFixed(2)),
    semantic: Number(r.semantic.toFixed(2)),
  }));

  if (scored.length === 0) {
    trace.gate = "insufficient_evidence";
    return await extrapolateOrRefuse(profileId, actor, question, qvec, history, trace, conversationId);
  }

  const spans: SpanRef[] = scored.map((r, i) => ({
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
    const draft = await llm.generate(question, spans, history);
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
    return await extrapolateOrRefuse(profileId, actor, question, qvec, history, trace, conversationId);
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
  const ids = await persist(profileId, actor, question, result, conversationId);
  await audit(actor, "answer.grounded", profileId, { question, citations: citations.length });
  return { ...result, ...ids };
}

// Worldview mode (the third answer kind): nothing direct was recorded, but the
// person's values and opinions may still speak to the question. Retrieve them,
// let the model extrapolate — explicitly framed, values cited — and verify that
// no memories were invented. Factual questions and unrelated topics still refuse.
async function extrapolateOrRefuse(
  profileId: string,
  actor: string,
  question: string,
  qvec: number[],
  history: ChatTurn[],
  trace: Record<string, unknown>,
  conversationId?: string | null
): Promise<AnswerResult> {
  const llm = getLLM();
  const refuse = async (): Promise<AnswerResult> => {
    const result: AnswerResult = { kind: "refusal", text: REFUSAL_TEXT, citations: [], trace };
    const ids = await persist(profileId, actor, question, result, conversationId);
    await audit(actor, "answer.refused", profileId, { question });
    return { ...result, ...ids };
  };

  const valueRows =
    qvec.length === 0 || isZeroVector(qvec)
      ? []
      : await q<{
          fact_id: string;
          story_unit_id: string;
          statement: string;
          context: string;
          semantic: number;
        }>(
          `select f.id as fact_id, s.id as story_unit_id, f.statement, s.body as context,
                  1 - (f.embedding <=> $2::vector) as semantic
           from facts f
           join story_units s on s.id = f.story_unit_id
           where f.profile_id = $1 and f.status = 'approved'
             and f.kind in ('value','opinion') and f.embedding is not null
           order by f.embedding <=> $2::vector
           limit 8`,
          [profileId, toVectorLiteral(qvec)]
        );
  // Values need only be loosely related — the model decides if they truly bear
  // on the question; totally unrelated corpora never reach it.
  const relevant = valueRows.filter((r) => Number(r.semantic) >= 0.25);
  if (relevant.length === 0) return refuse();

  const spans: SpanRef[] = relevant.map((r, i) => ({
    n: i + 1,
    factId: r.fact_id,
    storyUnitId: r.story_unit_id,
    statement: r.statement,
    context: r.context,
  }));
  trace.worldview = spans.map((s) => s.factId);

  const draft = await llm.extrapolate(question, spans, history);
  if (draft.notRecorded) return refuse();
  const check = await llm.verifyExtrapolation(draft.text, spans);
  if (!check.ok) {
    trace.extrapolation_rejected = check.failures;
    return refuse();
  }

  let text = draft.text;
  const [styleProfile] = await q<{ version: number; params: Record<string, unknown> }>(
    "select version, params from style_profiles where profile_id = $1 order by version desc limit 1",
    [profileId]
  );
  if (styleProfile) {
    const markers = [...new Set([...text.matchAll(/\[\d+\]/g)].map((m) => m[0]))];
    const styled = await llm.style(text, question, styleProfile.params);
    if (styled.length > 0 && markers.every((m) => styled.includes(m))) {
      const diff = await llm.styleDiff(text, styled, spans);
      if (diff.ok) {
        text = styled;
        trace.style = { version: styleProfile.version, applied: true };
      }
    }
  }

  const used = new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  const citations: Citation[] = spans
    .filter((s) => used.has(s.n))
    .map((s) => ({ n: s.n, fact_id: s.factId, story_unit_id: s.storyUnitId, quote: s.statement }));

  const result: AnswerResult = { kind: "extrapolation", text, citations, trace };
  const ids = await persist(profileId, actor, question, result, conversationId);
  await audit(actor, "answer.extrapolated", profileId, { question, values: citations.length });
  return { ...result, ...ids };
}

async function persist(
  profileId: string,
  actor: string,
  question: string,
  result: Pick<AnswerResult, "kind" | "text" | "citations" | "trace">,
  conversationId?: string | null
): Promise<{ conversation_id: string; message_id: string }> {
  let convId = conversationId ?? null;
  if (!convId) {
    const conv = await q<{ id: string }>(
      "insert into conversations (profile_id, actor) values ($1, $2) returning id",
      [profileId, actor]
    );
    convId = conv[0].id;
  }
  await q("insert into messages (conversation_id, role, body) values ($1, 'user', $2)", [
    convId,
    question,
  ]);
  const [msg] = await q<{ id: string }>(
    `insert into messages (conversation_id, role, body, refusal, citations, trace)
     values ($1, 'assistant', $2, $3, $4, $5) returning id`,
    [
      convId,
      result.text,
      result.kind === "refusal" || result.kind === "denied",
      JSON.stringify(result.citations),
      JSON.stringify(result.trace),
    ]
  );
  return { conversation_id: convId, message_id: msg.id };
}
