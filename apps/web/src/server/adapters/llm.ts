// LLM adapter (P6): mock needs no keys and cannot invent facts by construction;
// anthropic uses the real API for grounded generation + entailment verification.

export interface SpanRef {
  n: number;
  factId: string;
  storyUnitId: string;
  statement: string;
  context: string;
}

export interface Draft {
  text: string;
  notRecorded: boolean;
}

export interface Verification {
  ok: boolean;
  failures: string[];
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface LLMAdapter {
  name: string;
  generate(question: string, spans: SpanRef[], history?: ChatTurn[]): Promise<Draft>;
  verify(text: string, spans: SpanRef[]): Promise<Verification>;
  /** Rewrite a verified answer in the subject's voice. Tone only — facts and
   *  citation markers must survive; respond.ts enforces both and falls back. */
  style(text: string, question: string, profile: Record<string, unknown>): Promise<string>;
  /** The §8 diff check: is the styled text a faithful restyling of the verified
   *  original? Person/tone shift allowed; the subject's own recorded phrases from
   *  the cited spans allowed; anything found in neither is drift. */
  styleDiff(original: string, styled: string, spans: SpanRef[]): Promise<Verification>;
  /** Worldview mode: when nothing was recorded on the topic, answer as the person
   *  plausibly would — reasoning ONLY from their recorded values/opinions/stories,
   *  framed as extrapolation, never as memory. notPossible when the question wants
   *  a specific fact, or the values genuinely don't speak to it. */
  extrapolate(question: string, valueSpans: SpanRef[], history?: ChatTurn[]): Promise<Draft>;
  /** Verifier for extrapolations: no invented memories/events; predictions must
   *  trace to the cited values; the extrapolated framing must be explicit. */
  verifyExtrapolation(text: string, valueSpans: SpanRef[]): Promise<Verification>;
}

/* ------------------------------ mock ------------------------------ */

const MockLLM: LLMAdapter = {
  name: "mock",
  async generate(_question, spans) {
    if (spans.length === 0) return { text: "", notRecorded: true };
    // Verbatim approved statements with citation markers — no generation, no invention.
    const lines = spans.slice(0, 3).map((s) => `${s.statement} [${s.n}]`);
    return { text: `Here is what was recorded about that: ${lines.join(" ")}`, notRecorded: false };
  },
  async verify(text, spans) {
    // Every sentence must carry a citation marker that resolves to a supplied span.
    const failures: string[] = [];
    const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
    for (const sentence of sentences) {
      const markers = [...sentence.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
      if (markers.length === 0 && sentences.length > 1 && sentence === sentences[0]) continue; // lead-in
      if (markers.length === 0) {
        failures.push(`uncited sentence: "${sentence.slice(0, 60)}"`);
        continue;
      }
      for (const n of markers) {
        if (!spans.some((s) => s.n === n)) failures.push(`citation [${n}] has no source span`);
      }
    }
    return { ok: failures.length === 0, failures };
  },
  async style(text) {
    // Deterministic passthrough: the mock never rewrites, so evals stay stable.
    return text;
  },
  async styleDiff(original, styled, _spans) {
    return original === styled
      ? { ok: true, failures: [] }
      : { ok: false, failures: ["mock styleDiff only accepts identical text"] };
  },
  async extrapolate() {
    // Deterministic: the mock never speculates, so CI behavior is unchanged.
    return { text: "", notRecorded: true };
  },
  async verifyExtrapolation() {
    return { ok: true, failures: [] };
  },
};

/* ---------------------------- anthropic ---------------------------- */

async function anthropicChat(
  model: string,
  system: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: 4096, system, messages }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

function anthropicMessage(model: string, system: string, user: string): Promise<string> {
  return anthropicChat(model, system, [{ role: "user", content: user }]);
}

const STYLE_SYSTEM = `You rewrite an answer so it sounds like the person themselves speaking — their voice, cadence, and warmth — guided by the style profile provided.
Hard rules, non-negotiable:
- First person: the person is speaking about their own life.
- Preserve every fact exactly: no new details, names, dates, or events, and none dropped.
- Never invent content. You may weave in the person's own recorded phrases (the
  profile's signature phrases) when they belong to the memory being retold; beyond
  that, add no lessons, morals, feelings, or imagery — even if they fit the voice.
- Keep every citation marker like [1] attached to the statement it supports.
- Write in the same language as the original answer.
- Do not add greetings, sign-offs, or commentary. Similar length to the original.
- Output only the rewritten text.`;

const STYLE_DIFF_SYSTEM = `You check whether a stylistic rewrite of an answer stays faithful to it.

ALLOWED — never report these:
1. Person change (third person "Miriam…" → first person "I…"): the rewrite is the person themselves speaking.
2. Changes of tone, rhythm, word choice, or sentence order.
3. Phrases or details taken from the RECORDED SOURCES provided (the person's actual recordings).
4. Dropping attribution framing such as "Miriam believes that" or "she feels that".

VIOLATIONS — report only these:
A. Content in the rewrite that appears in neither the original answer nor the recorded sources.
B. A fact from the original answer that the rewrite omits or contradicts. Rephrasing and compressing are fine; losing the fact is not.

Texts may mix languages (Russian, Hebrew, English) — compare by meaning, not wording.

Reply with JSON only: {"failures": ["…"]} — one entry per violation, empty array when only allowed transformations occurred.`;

const EXTRAPOLATE_SYSTEM = `Nothing was recorded on this topic. You may answer only as a careful, honest extrapolation from the person's RECORDED values, opinions, and stories (the numbered spans provided) — the way someone who knew them deeply would say "knowing them, they'd probably tell you…".
Hard rules, non-negotiable:
- Reply with exactly NOT_POSSIBLE when the question asks for a specific fact, memory, event, person, or date (those are recorded or they are nothing), or when the provided values genuinely do not bear on the question.
- Never invent a memory, event, or biographical detail. You may ONLY reference recorded material from the spans, cited like [1].
- Frame the answer explicitly as extrapolation: open by acknowledging they never spoke about this directly, then reason from what they DID say.
- Every value, principle, or story you lean on must carry its citation marker [n].
- Answer in the language of the question. Write in third person about the subject.
- Be warm and brief; no lectures.`;

const VERIFY_EXTRAPOLATION_SYSTEM = `You check an extrapolated answer — a prediction of what a person would say, reasoned from their recorded values. Reply with JSON only: {"failures": ["…"]}. Report a failure for each of:
A. Any claim that the person said, did, or experienced something not present in the numbered spans (invented memories are the cardinal sin).
B. Any advice or predicted view that does not plausibly follow from the cited spans.
C. Missing extrapolation framing — the answer must be explicit that this is inference from their values, not a recorded memory.
The answer and spans may be in different languages; judge by meaning. Empty array if clean.`;

const GEN_SYSTEM = `You answer questions about a person using ONLY the numbered source spans provided.
ALWAYS reply in the language the question was asked in — if the question is in English and the spans are in Russian, answer in English (recorded phrases may be quoted in their original language).
Rules, non-negotiable:
- Every factual sentence must end with a citation marker like [1] pointing at the span that supports it.
- Never add facts, dates, names, or details that are not in the spans. Do not use outside knowledge.
- If the spans do not answer the question, reply with exactly: NOT_RECORDED
- If you must connect two spans with an inference, mark it: "(inference)".
- Write warmly but briefly, in third person about the subject.`;

const AnthropicLLM: LLMAdapter = {
  name: "anthropic",
  async generate(question, spans, history) {
    if (spans.length === 0) return { text: "", notRecorded: true };
    const sources = spans
      .map((s) => `[${s.n}] statement: ${s.statement}\n    recorded context: ${s.context}`)
      .join("\n");
    const model = process.env.GEN_MODEL ?? "claude-sonnet-5";
    // Recent turns give follow-up questions their referents ("what did she do
    // there?"); grounding rules still bind every new factual sentence to spans.
    const messages = [
      ...(history ?? []).slice(-6).map((h) => ({
        role: h.role,
        content: h.content.slice(0, 1500),
      })),
      { role: "user", content: `Question: ${question}\n\nSource spans:\n${sources}` },
    ];
    const text = (await anthropicChat(model, GEN_SYSTEM, messages)).trim();
    return { text, notRecorded: text.includes("NOT_RECORDED") };
  },
  async verify(text, spans) {
    const model = process.env.VERIFY_MODEL ?? "claude-haiku-4-5-20251001";
    const sources = spans.map((s) => `[${s.n}] ${s.statement} — context: ${s.context}`).join("\n");
    const raw = await anthropicMessage(
      model,
      `You are a strict fact checker. For the answer below, check every factual claim against the numbered sources. The answer and sources may be in different languages — judge entailment by meaning across languages. Reply with JSON only: {"failures": ["<claim> is not supported", ...]} — an empty array if every claim is entailed by its cited source.`,
      `Sources:\n${sources}\n\nAnswer to check:\n${text}`
    );
    try {
      const parsed = JSON.parse(raw.replace(/^[^{]*/, "").replace(/[^}]*$/, "")) as {
        failures: string[];
      };
      return { ok: parsed.failures.length === 0, failures: parsed.failures };
    } catch {
      return { ok: false, failures: ["verifier returned unparseable output"] };
    }
  },
  async style(text, question, profile) {
    const model = process.env.GEN_MODEL ?? "claude-sonnet-5";
    const styled = await anthropicMessage(
      model,
      STYLE_SYSTEM,
      `Style profile:\n${JSON.stringify(profile, null, 2)}\n\nQuestion being answered: ${question}\n\nOriginal answer:\n${text}`
    );
    return styled.trim();
  },
  async extrapolate(question, valueSpans, history) {
    if (valueSpans.length === 0) return { text: "", notRecorded: true };
    const sources = valueSpans
      .map((s) => `[${s.n}] (${s.statement})\n    recorded context: ${s.context}`)
      .join("\n");
    const model = process.env.GEN_MODEL ?? "claude-sonnet-5";
    const messages = [
      ...(history ?? []).slice(-6).map((h) => ({
        role: h.role,
        content: h.content.slice(0, 1500),
      })),
      {
        role: "user",
        content: `Question: ${question}\n\nRecorded values, opinions, and stories:\n${sources}`,
      },
    ];
    const text = (await anthropicChat(model, EXTRAPOLATE_SYSTEM, messages)).trim();
    return { text, notRecorded: text.includes("NOT_POSSIBLE") };
  },
  async verifyExtrapolation(text, valueSpans) {
    const model = process.env.GEN_MODEL ?? "claude-sonnet-5";
    const sources = valueSpans.map((s) => `[${s.n}] ${s.statement} — context: ${s.context}`).join("\n");
    const raw = await anthropicMessage(
      model,
      VERIFY_EXTRAPOLATION_SYSTEM,
      `Spans:\n${sources}\n\nExtrapolated answer to check:\n${text}`
    );
    try {
      const parsed = JSON.parse(raw.replace(/^[^{]*/, "").replace(/[^}]*$/, "")) as {
        failures: string[];
      };
      return { ok: parsed.failures.length === 0, failures: parsed.failures };
    } catch {
      return { ok: false, failures: ["extrapolation verifier returned unparseable output"] };
    }
  },
  async styleDiff(original, styled, spans) {
    // The nuanced allowed/violation contract needs strong instruction following;
    // this check runs once per answer, so the stronger model is worth it.
    const model = process.env.GEN_MODEL ?? "claude-sonnet-5";
    const sources = spans.map((s) => `[${s.n}] ${s.context}`).join("\n");
    const raw = await anthropicMessage(
      model,
      STYLE_DIFF_SYSTEM,
      `RECORDED SOURCES:\n${sources}\n\nOriginal:\n${original}\n\nRewrite:\n${styled}`
    );
    try {
      const parsed = JSON.parse(raw.replace(/^[^{]*/, "").replace(/[^}]*$/, "")) as {
        failures: string[];
      };
      return { ok: parsed.failures.length === 0, failures: parsed.failures };
    } catch {
      return { ok: false, failures: ["style diff returned unparseable output"] };
    }
  },
};

export function getLLM(): LLMAdapter {
  return (process.env.LLM_PROVIDER ?? "mock") === "anthropic" ? AnthropicLLM : MockLLM;
}
