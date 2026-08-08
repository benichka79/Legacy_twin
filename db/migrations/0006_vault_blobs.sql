-- DB-backed media vault: content-addressed, append-only (P3). Media is backed
-- up with the database and reachable from both web and worker regardless of
-- host. S3/object-lock remains the scale answer (ARCHITECTURE.md, Phase 4);
-- existing rows with filesystem vault_paths keep working via a read fallback.

create table vault_blobs (
  sha256     text primary key,
  filename   text not null,
  bytes      bytea not null,
  created_at timestamptz not null default now()
);
