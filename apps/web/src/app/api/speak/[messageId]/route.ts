import { NextRequest, NextResponse } from "next/server";
import { q } from "@/server/db";
import { checkPolicy, audit } from "@/server/pdp";
import { requireRole } from "@/server/auth";

// Voice output — the architecture's signed-token TTS in skeleton form (P5):
// this endpoint speaks ONLY persisted assistant messages from the caller's own
// conversation, addressed by id. There is no path anywhere that turns arbitrary
// text into the voice. Returns 501 when no TTS vendor is configured; the client
// falls back to a clearly-generic browser voice.

export const maxDuration = 60;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const user = await requireRole();
  if (!user) return NextResponse.json({ error: "sign in" }, { status: 401 });

  const { messageId } = await params;
  const [msg] = await q<{ body: string; profile_id: string }>(
    `select m.body, c.profile_id from messages m
     join conversations c on c.id = m.conversation_id
     where m.id = $1 and m.role = 'assistant' and c.actor = $2`,
    [messageId, user.actor]
  );
  if (!msg) return NextResponse.json({ error: "message not found" }, { status: 404 });

  const policy = await checkPolicy(msg.profile_id, user.actor, "voice", "conversation");
  if (!policy.allowed) return NextResponse.json({ error: policy.reason }, { status: 403 });

  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    // Not configured — client uses a generic browser voice instead.
    return NextResponse.json({ fallback: true }, { status: 501 });
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        // Citation markers are visual apparatus — never spoken.
        text: msg.body.replace(/\s*\[\d+\]/g, ""),
        model_id: "eleven_multilingual_v2",
      }),
    }
  );
  if (!res.ok) {
    return NextResponse.json({ error: `tts failed (${res.status})` }, { status: 502 });
  }
  await audit(user.actor, "voice.spoken", messageId);
  return new NextResponse(res.body, {
    headers: { "content-type": "audio/mpeg", "cache-control": "private, max-age=3600" },
  });
}
