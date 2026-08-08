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


def transcribe(audio: bytes, filename: str) -> tuple[str, str]:
    """Returns (transcript_text, source_tag)."""
    provider = os.environ.get("ASR_PROVIDER", "mock")
    if provider == "deepgram":
        return _transcribe_deepgram(audio), "asr:deepgram"
    text = (
        f"[mock transcript of {filename}] This is a placeholder transcript produced by the "
        "mock ASR adapter. Configure ASR_PROVIDER=deepgram with a DEEPGRAM_API_KEY to "
        "transcribe real audio."
    )
    return text, "asr:mock"


def _transcribe_deepgram(audio: bytes) -> str:
    req = urllib.request.Request(
        "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true",
        data=audio,
        headers={
            "Authorization": f"Token {os.environ['DEEPGRAM_API_KEY']}",
            "Content-Type": "application/octet-stream",
        },
    )
    with urllib.request.urlopen(req, timeout=300, context=_ssl_context()) as res:
        payload = json.load(res)
    return payload["results"]["channels"][0]["alternatives"][0]["transcript"]


# --------------------------------------------------------------- fact extraction

_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")


def extract_facts(unit_text: str) -> list[dict]:
    """Returns [{statement, char_start, char_end, confidence}] for one story unit."""
    provider = os.environ.get("LLM_PROVIDER", "mock")
    if provider == "anthropic":
        return _extract_anthropic(unit_text)
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
                "char_start": start,
                "char_end": start + len(sentence),
                "confidence": 0.5,
            }
        )
    return facts[:5]


_EXTRACT_SYSTEM = (
    "Extract discrete, verifiable factual claims from this first-person memory. "
    'Reply with JSON only: {"facts": [{"statement": "...", "evidence": "<exact substring '
    'of the input that supports it>"}]}. Statements are third-person, faithful, no invention. '
    "At most 5."
)


def _extract_anthropic(unit_text: str) -> list[dict]:
    body = json.dumps(
        {
            "model": os.environ.get("VERIFY_MODEL", "claude-haiku-4-5-20251001"),
            "max_tokens": 1024,
            "system": _EXTRACT_SYSTEM,
            "messages": [{"role": "user", "content": unit_text}],
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
        facts.append(
            {
                "statement": item["statement"],
                "char_start": max(start, 0),
                "char_end": (start + len(evidence)) if start >= 0 else 0,
                "confidence": 0.7,
            }
        )
    return facts[:5]
