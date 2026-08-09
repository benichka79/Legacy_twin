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


def derive_style(conn: psycopg.Connection, profile_id: str) -> str:
    """Build a new style-profile version from approved first-party samples only:
    story units the subject has endorsed by approving at least one fact in them."""
    with conn.cursor() as cur:
        cur.execute(
            """select distinct s.id, s.body, s.created_at, s.seq
               from story_units s
               join facts f on f.story_unit_id = s.id and f.status = 'approved'
               where s.profile_id = %s
               order by s.created_at, s.seq""",
            (profile_id,),
        )
        bodies = [row[1] for row in cur.fetchall()]
        if not bodies:
            raise RuntimeError("no approved first-party samples to derive a style from")
        samples = "\n\n".join(bodies)[:20000]

        params, derived_by = adapters.derive_style(samples)

        cur.execute(
            "select coalesce(max(version), 0) + 1 from style_profiles where profile_id = %s",
            (profile_id,),
        )
        version = cur.fetchone()[0]
        cur.execute(
            """insert into style_profiles (profile_id, version, params, sample_chars, derived_by)
               values (%s, %s, %s, %s, %s)""",
            (profile_id, version, psycopg.types.json.Json(params), len(samples), derived_by),
        )
        cur.execute(
            "insert into audit_log (actor, action, subject, detail) values ('worker:pipeline', 'style.derived', %s, %s)",
            (profile_id, psycopg.types.json.Json({"version": version, "derived_by": derived_by, "sample_chars": len(samples)})),
        )
        conn.commit()
        return f"style profile v{version} derived from {len(samples)} chars ({derived_by})"


def process_media(conn: psycopg.Connection, media_id: str) -> str:
    with conn.cursor() as cur:
        cur.execute(
            "select profile_id, kind, filename, vault_path, prompt, language from media_objects where id = %s",
            (media_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise RuntimeError(f"media {media_id} not found")
        profile_id, kind, filename, vault_path, prompt, language = row

        cur.execute("update media_objects set status = 'processing' where id = %s", (media_id,))
        conn.commit()

        if vault_path.startswith("db://"):
            cur.execute("select bytes from vault_blobs where sha256 = %s", (vault_path[5:],))
            blob = cur.fetchone()
            if blob is None:
                raise RuntimeError(f"vault blob {vault_path} not found")
            raw = bytes(blob[0])
        else:
            # rows written before the DB-backed vault keep their filesystem paths
            raw = pathlib.Path(vault_path).read_bytes()
        if kind == "text":
            body, source = raw.decode("utf-8", errors="replace"), "verbatim"
        else:
            body, source = adapters.transcribe(raw, filename, language)

        cur.execute(
            "insert into transcripts (profile_id, media_id, body, source) values (%s, %s, %s, %s) returning id",
            (profile_id, media_id, body, source),
        )
        transcript_id = cur.fetchone()[0]

        # FTS configuration per unit: stemmers exist for Russian and English;
        # Hebrew and mixed-language text index as 'simple' (embeddings carry them).
        fts_lang = {"ru": "russian", "en": "english"}.get(language or "en", "simple")

        n_facts = 0
        for unit in segment(body):
            cur.execute(
                """insert into story_units (profile_id, transcript_id, seq, body, char_start, char_end, lang)
                   values (%s, %s, %s, %s, %s, %s, %s) returning id""",
                (profile_id, transcript_id, unit["seq"], unit["body"], unit["char_start"], unit["char_end"], fts_lang),
            )
            unit_id = cur.fetchone()[0]
            for fact in adapters.extract_facts(unit["body"], prompt):
                cur.execute(
                    """insert into facts (profile_id, story_unit_id, statement, kind, char_start, char_end, confidence)
                       values (%s, %s, %s, %s, %s, %s, %s)""",
                    (profile_id, unit_id, fact["statement"], fact.get("kind", "fact"), fact["char_start"], fact["char_end"], fact["confidence"]),
                )
                n_facts += 1

        cur.execute("update media_objects set status = 'processed' where id = %s", (media_id,))
        cur.execute(
            "insert into audit_log (actor, action, subject, detail) values ('worker:pipeline', 'media.processed', %s, %s)",
            (media_id, psycopg.types.json.Json({"facts_proposed": n_facts, "source": source})),
        )
        conn.commit()
        return f"media {media_id}: {n_facts} candidate facts proposed"
