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

export interface LLMAdapter {
  name: string;
  generate(question: string, spans: SpanRef[]): Promise<Draft>;
  verify(text: string, spans: SpanRef[]): Promise<Verification>;
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
};

/* ---------------------------- anthropic ---------------------------- */

async function anthropicMessage(model: string, system: string, user: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

const GEN_SYSTEM = `You answer questions about a person using ONLY the numbered source spans provided.
Rules, non-negotiable:
- Every factual sentence must end with a citation marker like [1] pointing at the span that supports it.
- Never add facts, dates, names, or details that are not in the spans. Do not use outside knowledge.
- If the spans do not answer the question, reply with exactly: NOT_RECORDED
- If you must connect two spans with an inference, mark it: "(inference)".
- Write warmly but briefly, in third person about the subject.`;

const AnthropicLLM: LLMAdapter = {
  name: "anthropic",
  async generate(question, spans) {
    if (spans.length === 0) return { text: "", notRecorded: true };
    const sources = spans
      .map((s) => `[${s.n}] statement: ${s.statement}\n    recorded context: ${s.context}`)
      .join("\n");
    const model = process.env.GEN_MODEL ?? "claude-sonnet-5";
    const text = (
      await anthropicMessage(model, GEN_SYSTEM, `Question: ${question}\n\nSource spans:\n${sources}`)
    ).trim();
    return { text, notRecorded: text.includes("NOT_RECORDED") };
  },
  async verify(text, spans) {
    const model = process.env.VERIFY_MODEL ?? "claude-haiku-4-5-20251001";
    const sources = spans.map((s) => `[${s.n}] ${s.statement} — context: ${s.context}`).join("\n");
    const raw = await anthropicMessage(
      model,
      `You are a strict fact checker. For the answer below, check every factual claim against the numbered sources. Reply with JSON only: {"failures": ["<claim> is not supported", ...]} — an empty array if every claim is entailed by its cited source.`,
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
};

export function getLLM(): LLMAdapter {
  return (process.env.LLM_PROVIDER ?? "mock") === "anthropic" ? AnthropicLLM : MockLLM;
}
