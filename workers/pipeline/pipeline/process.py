"""process_media job: vault file → transcript → story units → candidate facts.

Nothing here approves anything: facts land as candidates and wait for the
subject's review (P1/P2). Spans are recorded at every step (provenance)."""

import pathlib
import re

import psycopg

from . import adapters

_PARA_RE = re.compile(r"\n\s*\n")


def segment(body: str) -> list[dict]:
    """Split a transcript into story units (paragraphs), keeping char spans."""
    units, cursor, seq = [], 0, 1
    for para in _PARA_RE.split(body):
        para_stripped = para.strip()
        if not para_stripped:
            continue
        start = body.find(para_stripped, cursor)
        end = start + len(para_stripped)
        units.append({"seq": seq, "body": para_stripped, "char_start": start, "char_end": end})
        cursor = end
        seq += 1
    return units


def process_media(conn: psycopg.Connection, media_id: str) -> str:
    with conn.cursor() as cur:
        cur.execute(
            "select profile_id, kind, filename, vault_path from media_objects where id = %s",
            (media_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError(f"media {media_id} not found")
        profile_id, kind, filename, vault_path = row

        cur.execute("update media_objects set status = 'processing' where id = %s", (media_id,))
        conn.commit()

        raw = pathlib.Path(vault_path).read_bytes()
        if kind == "text":
            body, source = raw.decode("utf-8", errors="replace"), "verbatim"
        else:
            body, source = adapters.transcribe(raw, filename)

        cur.execute(
            "insert into transcripts (profile_id, media_id, body, source) values (%s, %s, %s, %s) returning id",
            (profile_id, media_id, body, source),
        )
        transcript_id = cur.fetchone()[0]

        n_facts = 0
        for unit in segment(body):
            cur.execute(
                """insert into story_units (profile_id, transcript_id, seq, body, char_start, char_end)
                   values (%s, %s, %s, %s, %s, %s) returning id""",
                (profile_id, transcript_id, unit["seq"], unit["body"], unit["char_start"], unit["char_end"]),
            )
            unit_id = cur.fetchone()[0]
            for fact in adapters.extract_facts(unit["body"]):
                cur.execute(
                    """insert into facts (profile_id, story_unit_id, statement, char_start, char_end, confidence)
                       values (%s, %s, %s, %s, %s, %s)""",
                    (profile_id, unit_id, fact["statement"], fact["char_start"], fact["char_end"], fact["confidence"]),
                )
                n_facts += 1

        cur.execute("update media_objects set status = 'processed' where id = %s", (media_id,))
        cur.execute(
            "insert into audit_log (actor, action, subject, detail) values ('worker:pipeline', 'media.processed', %s, %s)",
            (media_id, psycopg.types.json.Json({"facts_proposed": n_facts, "source": source})),
        )
        conn.commit()
        return f"media {media_id}: {n_facts} candidate facts proposed"
