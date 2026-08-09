"use client";

import { useRef, useState } from "react";
import { INTERVIEW_PROMPTS, LANGUAGE_OPTIONS, type PromptLanguage } from "./prompts";

type RecState = "idle" | "recording" | "recorded";
type CaptureLanguage = "ru" | "he" | "en" | "mixed";

export function CaptureForm() {
  const [promptIndex, setPromptIndex] = useState(0);
  const [language, setLanguage] = useState<CaptureLanguage>("ru");
  const [recState, setRecState] = useState<RecState>("idle");
  const [seconds, setSeconds] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const mimeRef = useRef("audio/webm");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const prompt = INTERVIEW_PROMPTS[promptIndex];
  const displayLang: PromptLanguage = language === "mixed" ? "ru" : language;
  const promptText = prompt.question[displayLang];

  function nextPrompt() {
    setPromptIndex((i) => (i + 1) % INTERVIEW_PROMPTS.length);
    discardRecording();
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      mimeRef.current = mime;
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        blobRef.current = blob;
        setAudioUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
        setRecState("recorded");
      };
      rec.start();
      recorderRef.current = rec;
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setRecState("recording");
      setStatus("");
    } catch (err) {
      setStatus(`Microphone unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
  }

  function discardRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    blobRef.current = null;
    setAudioUrl(null);
    setSeconds(0);
    setRecState("idle");
  }

  async function upload(file: File, withPrompt: boolean): Promise<boolean> {
    setBusy(true);
    setStatus("Uploading…");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("language", language);
      if (withPrompt) body.append("prompt", promptText);
      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();
      if (res.ok) {
        setStatus(
          `Stored immutably (${data.kind}, sha256 ${data.sha256.slice(0, 12)}…). The worker will process it — run: npm run worker`
        );
        return true;
      }
      setStatus(`Error: ${data.error}`);
      return false;
    } catch (err) {
      setStatus(`Error: ${String(err)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitRecording() {
    if (!blobRef.current) return;
    const ext = mimeRef.current === "audio/mp4" ? "m4a" : "webm";
    const file = new File([blobRef.current], `interview-${Date.now()}.${ext}`, {
      type: mimeRef.current,
    });
    if (await upload(file, true)) nextPrompt(); // saved — move the interview forward
  }

  async function submitTyped() {
    if (!typed.trim()) return;
    const file = new File([typed.trim()], `interview-${Date.now()}.txt`, { type: "text/plain" });
    if (await upload(file, true)) {
      setTyped("");
      nextPrompt();
    }
  }

  async function onFileSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = input.files?.[0];
    if (file) await upload(file, false);
  }

  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <>
      <div className="card">
        <p className="provenance" style={{ marginTop: 0, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span>
            Guided interview · {prompt.domain} · question {promptIndex + 1} of {INTERVIEW_PROMPTS.length}
          </span>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as CaptureLanguage)}
            style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 12, padding: "4px 8px" }}
            aria-label="Recording language"
          >
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </p>
        <p dir="auto" style={{ fontSize: 19, marginTop: 6 }}>{promptText}</p>

        <p style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {recState === "idle" && (
            <button onClick={startRecording} disabled={busy}>● Record an answer</button>
          )}
          {recState === "recording" && (
            <>
              <button onClick={stopRecording} className="reject">■ Stop</button>
              <span className="mono" style={{ color: "var(--oxide)" }}>recording {mmss}</span>
            </>
          )}
          {recState === "recorded" && audioUrl && (
            <>
              <audio controls src={audioUrl} />
              <button onClick={submitRecording} disabled={busy}>Save this answer</button>
              <button onClick={discardRecording} className="reject" disabled={busy}>Discard</button>
            </>
          )}
          <button onClick={nextPrompt} disabled={busy || recState === "recording"}>
            Skip to next question →
          </button>
        </p>

        <details>
          <summary className="mono muted" style={{ cursor: "pointer" }}>…or write the answer instead</summary>
          <p>
            <textarea
              dir="auto"
              rows={4}
              value={typed}
              placeholder="Write the answer in the subject's own words…"
              onChange={(e) => setTyped(e.target.value)}
            />
          </p>
          <button onClick={submitTyped} disabled={busy || !typed.trim()}>Save written answer</button>
        </details>
      </div>

      <form onSubmit={onFileSubmit} className="card">
        <p className="provenance" style={{ marginTop: 0 }}>
          Or upload existing material — a .txt/.md written memory, or an audio file
        </p>
        <input type="file" name="file" accept=".txt,.md,audio/*" required />
        <p style={{ marginBottom: 0 }}>
          <button type="submit" disabled={busy}>Upload to vault</button>
        </p>
      </form>

      {status && <p className="mono">{status}</p>}
    </>
  );
}
