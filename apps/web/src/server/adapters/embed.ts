// Embedding adapter (P6). "mock" is a deterministic hashing vectorizer — no
// network, stable across runs, so CI behaves identically forever; its cosine
// similarity reflects token overlap only. "voyage" (Voyage AI) provides real
// semantic similarity: paraphrases land close even with zero shared words.

export interface EmbedAdapter {
  name: string;
  embed(texts: string[], kind: "query" | "document"): Promise<number[][]>;
}

export const EMBED_DIM = 1024;

/* ------------------------------- mock ------------------------------- */

function fnv1a(token: string): number {
  let hash = 0x811c9dc5;
  const bytes = new TextEncoder().encode(token);
  for (const b of bytes) {
    hash ^= b;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function hashEmbed(text: string): number[] {
  const vec = new Array<number>(EMBED_DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const token of tokens) {
    if (token.length < 2) continue;
    const h = fnv1a(token);
    const idx = h & (EMBED_DIM - 1);
    const sign = (h >>> 15) & 1 ? -1 : 1;
    vec[idx] += sign;
  }
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? vec : vec.map((x) => x / norm);
}

const MockEmbed: EmbedAdapter = {
  name: "mock",
  async embed(texts) {
    return texts.map(hashEmbed);
  },
};

/* ------------------------------ voyage ------------------------------ */

const VoyageEmbed: EmbedAdapter = {
  name: "voyage",
  async embed(texts, kind) {
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.VOYAGE_API_KEY ?? ""}`,
      },
      body: JSON.stringify({
        model: process.env.EMBED_MODEL ?? "voyage-3.5",
        input: texts,
        input_type: kind,
        output_dimension: EMBED_DIM,
      }),
    });
    if (!res.ok) throw new Error(`voyage ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { data: Array<{ embedding: number[] }> };
    return data.data.map((d) => d.embedding);
  },
};

export function getEmbed(): EmbedAdapter {
  return (process.env.EMBED_PROVIDER ?? "mock") === "voyage" ? VoyageEmbed : MockEmbed;
}

/** pgvector literal: '[0.1,-0.2,...]' — pass as a string param with a ::vector cast. */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.map((x) => x.toFixed(6)).join(",")}]`;
}

export function isZeroVector(vec: number[]): boolean {
  return vec.every((x) => x === 0);
}
