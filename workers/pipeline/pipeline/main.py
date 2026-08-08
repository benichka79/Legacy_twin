"""Job worker: claims queued jobs from Postgres (skip-locked) and runs them.

Usage:
    python -m pipeline.main --once    # drain the queue and exit (CI, demos)
    python -m pipeline.main           # poll forever
"""

import argparse
import sys
import time
import traceback

from . import db, process


def claim_and_run(conn) -> bool:
    """Claim one queued job. Returns False when the queue is empty."""
    with conn.cursor() as cur:
        cur.execute(
            """update jobs set status = 'running', attempts = attempts + 1, updated_at = now()
               where id = (select id from jobs
                           where status = 'queued' and run_after <= now()
                           order by id limit 1
                           for update skip locked)
               returning id, kind, payload"""
        )
        row = cur.fetchone()
        conn.commit()
    if row is None:
        return False

    job_id, kind, payload = row
    try:
        if kind == "process_media":
            message = process.process_media(conn, payload["media_id"])
        elif kind == "derive_style":
            message = process.derive_style(conn, payload["profile_id"])
        else:
            raise RuntimeError(f"unknown job kind: {kind}")
        with conn.cursor() as cur:
            cur.execute("update jobs set status = 'done', updated_at = now() where id = %s", (job_id,))
        conn.commit()
        print(f"job {job_id} done: {message}")
    except Exception:
        conn.rollback()
        err = traceback.format_exc(limit=3)
        with conn.cursor() as cur:
            cur.execute(
                "update jobs set status = 'error', error = %s, updated_at = now() where id = %s",
                (err, job_id),
            )
        conn.commit()
        print(f"job {job_id} failed:\n{err}", file=sys.stderr)
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="drain the queue and exit")
    args = parser.parse_args()

    conn = db.connect()
    print("pipeline worker connected")
    try:
        while True:
            worked = claim_and_run(conn)
            if not worked:
                if args.once:
                    print("queue empty, exiting")
                    return
                time.sleep(2)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
