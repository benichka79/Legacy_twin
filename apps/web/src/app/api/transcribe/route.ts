import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/server/auth";

// Voice input: transcribe a spoken question so the asker can review and send it.
// The transcript is shown for confirmation, never submitted blind — ASR errors
// stay the human's to correct, same principle as the review queue.

export const maxDuration = 60;

const AUDIO_TYPES: Record<string, string> = {
  webm: "audio/webm",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
};

export async function POST(req: NextRequest) {
  const user = await requireRole();
  if (!user) return NextResponse.json({ error: "sign in" }, { status: 401 });
  if (!process.env.DEEPGRAM_API_KEY) {
    return NextResponse.json({ error: "voice input not configured (DEEPGRAM_API_KEY)" }, { status: 501 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no audio" }, { status: 400 });
  const language = String(form.get("language") ?? "ru");

  // Same routing as the worker: nova for Russian/English, Whisper for Hebrew/mixed.
  let model: string, params: string;
  if (language === "ru") [model, params] = ["nova-2", "language=ru"];
  else if (language === "en") [model, params] = [process.env.ASR_MODEL ?? "nova-3", "language=en"];
  else [model, params] = ["whisper-large", "detect_language=true"];

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "webm";
  const res = await fetch(
    `https://api.deepgram.com/v1/listen?model=${model}&smart_format=true&${params}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        "Content-Type": AUDIO_TYPES[ext] ?? "application/octet-stream",
      },
      body: Buffer.from(await file.arrayBuffer()),
    }
  );
  if (!res.ok) {
    return NextResponse.json({ error: `transcription failed (${res.status})` }, { status: 502 });
  }
  const data = (await res.json()) as {
    results: { channels: Array<{ alternatives: Array<{ transcript: string }> }> };
  };
  const text = data.results.channels[0]?.alternatives[0]?.transcript ?? "";
  return NextResponse.json({ text });
}
