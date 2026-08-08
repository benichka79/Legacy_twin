"use client";

import { useRef, useState } from "react";

interface Citation {
  n: number;
  quote: string;
  story_unit_id: string;
}
interface Answer {
  kind: "grounded" | "refusal" | "disclosure" | "denied";
  text: string;
  citations: Citation[];
  conversation_id?: string;
  message_id?: string;
}

function guessLang(text: string): string {
  if (/[Ѐ-ӿ]/.test(text)) return "ru-RU";
  if (/[֐-׿]/.test(text)) return "he-IL";
  return "en-US";
}

export function AskChat() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Array<{ q: string; a: Answer }>>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [voiceLang, setVoiceLang] = useState("ru");
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState("");
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, conversation_id: conversationId }),
      });
      const a = (await res.json()) as Answer;
      if (a.conversation_id) setConversationId(a.conversation_id);
      setHistory((h) => [{ q: question, a }, ...h]);
      setQuestion("");
    } finally {
      setBusy(false);
    }
  }

  function newConversation() {
    setConversationId(null);
    setHistory([]);
    setStatus("");
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setStatus("Transcribing…");
        const ext = mime === "audio/mp4" ? "m4a" : "webm";
        const body = new FormData();
        body.append("file", new File(chunksRef.current, `question.${ext}`, { type: mime }));
        body.append("language", voiceLang);
        try {
          const res = await fetch("/api/transcribe", { method: "POST", body });
          const data = await res.json();
          if (res.ok && data.text) {
            setQuestion(data.text);
            setStatus("Check the transcript, then send.");
          } else {
            setStatus(data.error ?? "transcription failed");
          }
        } catch (err) {
          setStatus(String(err));
        }
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setStatus("Listening — click ■ when done.");
    } catch (err) {
      setStatus(`Microphone unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function speak(answer: Answer) {
    const id = answer.message_id;
    if (!id || speakingId) return;
    setSpeakingId(id);
    try {
      const res = await fetch(`/api/speak/${id}`);
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          setSpeakingId(null);
        };
        await audio.play();
      } else {
        // No cloned voice configured — clearly-generic browser voice fallback.
        const clean = answer.text.replace(/\s*\[\d+\]/g, "");
        const utterance = new SpeechSynthesisUtterance(clean);
        utterance.lang = guessLang(clean);
        utterance.onend = () => setSpeakingId(null);
        speechSynthesis.speak(utterance);
      }
    } catch {
      setSpeakingId(null);
    }
  }

  return (
    <>
      <form onSubmit={ask} className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          dir="auto"
          type="text"
          value={question}
          placeholder="Where did Miriam work in 1962?"
          onChange={(e) => setQuestion(e.target.value)}
          style={{ flex: "1 1 300px" }}
        />
        <button type="button" onClick={toggleRecording} disabled={busy} className={recording ? "reject" : ""}>
          {recording ? "■" : "🎙"}
        </button>
        <select
          value={voiceLang}
          onChange={(e) => setVoiceLang(e.target.value)}
          aria-label="Spoken language"
          style={{ fontFamily: "var(--mono)", fontSize: 12, padding: "4px 8px" }}
        >
          <option value="ru">RU</option>
          <option value="he">HE</option>
          <option value="en">EN</option>
          <option value="mixed">MIX</option>
        </select>
        <button type="submit" disabled={busy}>{busy ? "…" : "Ask"}</button>
        {history.length > 0 && (
          <button type="button" onClick={newConversation} disabled={busy}>
            New conversation
          </button>
        )}
      </form>
      {status && <p className="mono muted">{status}</p>}

      {history.map((h, i) => (
        <div key={i} className={`card answer ${h.a.kind === "grounded" ? "" : "refusal"}`}>
          <p dir="auto" className="mono muted" style={{ marginTop: 0 }}>Q: {h.q}</p>
          <p dir="auto">
            {h.a.text}{" "}
            {h.a.message_id && (
              <button
                onClick={() => speak(h.a)}
                disabled={speakingId !== null}
                aria-label="Play answer aloud"
                style={{ padding: "2px 10px" }}
              >
                {speakingId === h.a.message_id ? "…" : "🔊"}
              </button>
            )}
          </p>
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
