"use client";

import { useState } from "react";

interface Citation {
  n: number;
  quote: string;
  story_unit_id: string;
}
interface Answer {
  kind: "grounded" | "refusal" | "disclosure" | "denied";
  text: string;
  citations: Citation[];
}

export function AskChat() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Array<{ q: string; a: Answer }>>([]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const a = (await res.json()) as Answer;
      setHistory((h) => [{ q: question, a }, ...h]);
      setQuestion("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={ask} className="card" style={{ display: "flex", gap: 10 }}>
        <input
          dir="auto"
          type="text"
          value={question}
          placeholder="Where did Miriam work in 1962?"
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" disabled={busy}>{busy ? "…" : "Ask"}</button>
      </form>
      {history.map((h, i) => (
        <div key={i} className={`card answer ${h.a.kind === "grounded" ? "" : "refusal"}`}>
          <p dir="auto" className="mono muted" style={{ marginTop: 0 }}>Q: {h.q}</p>
          <p dir="auto">{h.a.text}</p>
          {h.a.citations.map((c) => (
            <div className="citation" key={c.n}>
              <span className="n">[{c.n}]</span>
              {c.quote}
              <div className="provenance">story unit {c.story_unit_id.slice(-4)} · approved by subject</div>
            </div>
          ))}
          {h.a.kind !== "grounded" && (
            <p className="provenance" style={{ marginBottom: 0 }}>outcome: {h.a.kind}</p>
          )}
        </div>
      ))}
    </>
  );
}
