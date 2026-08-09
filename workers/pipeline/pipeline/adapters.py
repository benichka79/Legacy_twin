"""Vendor adapters (P6). Mock implementations need no keys; real providers are
selected via ASR_PROVIDER / LLM_PROVIDER env vars and use plain HTTP (no SDKs)."""

import json
import os
import re
import ssl
import urllib.request


def _ssl_context() -> ssl.SSLContext:
    # macOS python.org builds don't see system certs; prefer certifi's bundle.
    try:
        import certifi

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()

# --------------------------------------------------------------------------- ASR


_AUDIO_CONTENT_TYPES = {
    ".webm": "audio/webm",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
}


def transcribe(audio: bytes, filename: str, language: str | None = None) -> tuple[str, str]:
    """Returns (transcript_text, source_tag). `language` is the capture-time
    choice (ru/he/en/mixed) and routes to the right Deepgram model: nova handles
    English and Russian well; Hebrew and mixed-language speech go to Whisper."""
    provider = os.environ.get("ASR_PROVIDER", "mock")
    if provider == "deepgram":
        if language == "ru":
            model, params = "nova-2", "language=ru"
        elif language in ("he", "mixed"):
            model, params = "whisper-large", "detect_language=true"
        else:
            model = os.environ.get("ASR_MODEL", "nova-3")
            params = "language=en"
        text = _transcribe_deepgram(audio, filename, model, params)
        return text, f"asr:deepgram:{model}:{language or 'en'}"
    text = (
        f"[mock transcript of {filename}] This is a placeholder transcript produced by the "
        "mock ASR adapter. Configure ASR_PROVIDER=deepgram with a DEEPGRAM_API_KEY to "
        "transcribe real audio."
    )
    return text, "asr:mock"


def _transcribe_deepgram(audio: bytes, filename: str, model: str, params: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    content_type = _AUDIO_CONTENT_TYPES.get(ext, "application/octet-stream")
    req = urllib.request.Request(
        f"https://api.deepgram.com/v1/listen?model={model}&smart_format=true&{params}",
        data=audio,
        headers={
            "Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}",
            "Content-Type": content_type,
        },
    )
    with urllib.request.urlopen(req, timeout=300, context=_ssl_context()) as res:
        payload = json.load(res)
    transcript = payload["results"]["channels"][0]["alternatives"][0]["transcript"]
    if not transcript.strip():
        raise RuntimeError("deepgram returned an empty transcript (silent or unreadable audio)")
    return transcript


# -------------------------------------------------------------- style derivation

_STYLE_DERIVE_SYSTEM = (
    "You analyze first-person memoir recordings and produce a style profile of the "
    "speaker's authentic voice, for use in rendering answers the way they would say "
    'them. Reply with JSON only: {"tone": "...", "cadence": "...", '
    '"signature_phrases": ["..."], "speech_habits": ["..."], "themes": ["..."], '
    '"example_lines": ["..."]}. Strict grounding rules: signature_phrases and '
    "example_lines must be VERBATIM sentences or phrases copied exactly from the "
    "samples — never composed, merged, or paraphrased. A downstream checker rejects "
    "any styled answer containing words the speaker never recorded, so an invented "
    "line poisons the whole profile. tone/cadence/speech_habits are your analytical "
    "descriptions and may be in your own words."
)


def derive_style(samples: str) -> tuple[dict, str]:
    """Returns (style_params, derived_by_tag) from approved first-party samples."""
    provider = os.environ.get("LLM_PROVIDER", "mock")
    if provider != "anthropic":
        return (
            {
                "tone": "warm, plain-spoken (mock profile)",
                "cadence": "short declarative sentences",
                "signature_phrases": [],
                "speech_habits": ["first person", "concrete detail"],
                "themes": [],
                "example_lines": [],
            },
            "mock",
        )
    model = os.environ.get("GEN_MODEL", "claude-sonnet-5")
    body = json.dumps(
        {
            "model": model,
            "max_tokens": 4096,
            "system": _STYLE_DERIVE_SYSTEM,
            "messages": [{"role": "user", "content": samples}],
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "content-type": "application/json",
            "x-api-key": os.environ["ANTHROPIC_API_KEY"],
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(req, timeout=120, context=_ssl_context()) as res:
        payload = json.load(res)
    raw = "".join(block.get("text", "") for block in payload["content"])
    raw = raw[raw.find("{") : raw.rfind("}") + 1]
    return json.loads(raw), f"anthropic:{model}"


# --------------------------------------------------------------- fact extraction

_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


def extract_facts(unit_text: str, prompt: str | None = None) -> list[dict]:
    """Returns [{statement, char_start, char_end, confidence}] for one story unit.
    `prompt` is the guided-interview question that elicited this answer, if any —
    context that resolves pronouns and implied subjects ("she" = the person asked about)."""
    provider = os.environ.get("LLM_PROVIDER", "mock")
    if provider == "anthropic":
        return _extract_anthropic(unit_text, prompt)
    return _extract_mock(unit_text)


def _extract_mock(unit_text: str) -> list[dict]:
    """Heuristic: substantial sentences become candidate facts, spans are exact."""
    facts = []
    for sentence in _SENTENCE_RE.split(unit_text):
        sentence = sentence.strip()
        if len(sentence.split()) < 6:
            continue
        start = unit_text.find(sentence)
        facts.append(
            {
                "statement": sentence,
                "kind": "fact",
                "char_start": start,
                "char_end": start + len(sentence),
                "confidence": 0.5,
            }
        )
    return facts[:5]


_EXTRACT_SYSTEM = (
    "Extract discrete claims from this first-person memory. Classify each as: "
    '"fact" (a biographical event, place, person, date), "value" (a principle or '
    'belief they live by), or "opinion" (a view, taste, or judgment). '
    'Reply with JSON only: {"facts": [{"statement": "...", "kind": "fact|value|opinion", '
    '"evidence": "<exact substring of the person\'s answer that supports it>"}]}. '
    "Statements are third-person, faithful, no invention, and written in the same "
    "language as the person's answer (Russian, Hebrew, English, or a mix — never "
    "translate). Evidence must be quoted from the person's own words, never from the "
    "interviewer's question. At most 5."
)


def _extract_anthropic(unit_text: str, prompt: str | None = None) -> list[dict]:
    content = (
        f"The interviewer asked: {prompt}\n\nThe person answered:\n{unit_text}"
        if prompt
        else unit_text
    )
    body = json.dumps(
        {
            "model": os.environ.get("VERIFY_MODEL", "claude-haiku-4-5-20251001"),
            "max_tokens": 1024,
            "system": _EXTRACT_SYSTEM,
            "messages": [{"role": "user", "content": content}],
        }
    ).encode()
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "content-type": "application/json",
            "x-api-key": os.environ["ANTHROPIC_API_KEY"],
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(req, timeout=120, context=_ssl_context()) as res:
        payload = json.load(res)
    raw = "".join(block.get("text", "") for block in payload["content"])
    raw = raw[raw.find("{") : raw.rfind("}") + 1]
    facts = []
    for item in json.loads(raw).get("facts", []):
        evidence = item.get("evidence", "")
        start = unit_text.find(evidence) if evidence else -1
        kind = item.get("kind", "fact")
        facts.append(
            {
                "statement": item["statement"],
                "kind": kind if kind in ("fact", "value", "opinion") else "fact",
                "char_start": max(start, 0),
                "char_end": (start + len(evidence)) if start >= 0 else 0,
                "confidence": 0.7,
            }
        )
    return facts[:5]
