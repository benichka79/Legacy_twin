-- Legacy Twin walking skeleton — initial schema.
-- Maps ARCHITECTURE.md §3 (data plane) in miniature. Single-profile scale;
-- RLS and per-profile encryption arrive with real auth (Phase 2).

create extension if not exists vector;

create table profiles (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null,
  lifecycle    text not null default 'living'
               check (lifecycle in ('onboarding','living','frozen','memorial','retired')),
  created_at   timestamptz not null default now()
);

-- Append-only consent ledger (ARCHITECTURE.md §4). State is derived, never stored.
create table consent_events (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references profiles(id),
  actor      text not null,            -- who granted/revoked (subject, or interactant opting in)
  modality   text not null check (modality in ('text','voice','likeness')),
  purpose    text not null check (purpose in ('capture','conversation','export','research')),
  audience   text not null,            -- role or principal the grant covers, e.g. 'family'
  action     text not null check (action in ('grant','revoke')),
  created_at timestamptz not null default now()
);

create table media_objects (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  kind       text not null check (kind in ('text','audio')),
  filename   text not null,
  sha256     text not null,
  vault_path text not null,            -- immutable original (P3)
  status     text not null default 'ingested'
             check (status in ('ingested','processing','processed','error')),
  error      text,
  created_at timestamptz not null default now()
);

create table transcripts (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  media_id   uuid not null references media_objects(id),
  body       text not null,
  source     text not null default 'verbatim',   -- verbatim (text upload) | asr:<provider>
  created_at timestamptz not null default now()
);

create table story_units (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id),
  transcript_id uuid not null references transcripts(id),
  seq           int  not null,
  body          text not null,
  char_start    int  not null,         -- span within transcript body
  char_end      int  not null,
  tsv           tsvector generated always as (to_tsvector('english', body)) stored,
  created_at    timestamptz not null default now()
);
create index story_units_tsv_idx on story_units using gin (tsv);

-- Facts carry provenance (a span within their story unit) and the approval gate:
-- nothing is retrievable until the subject approves it (P1/P2).
create table facts (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id),
  story_unit_id uuid not null references story_units(id),
  statement     text not null,
  char_start    int  not null default 0,   -- span within story unit body
  char_end      int  not null default 0,
  confidence    real not null default 0.5,
  status        text not null default 'candidate'
                check (status in ('candidate','approved','rejected','retracted')),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index facts_status_idx on facts (profile_id, status);

create table conversations (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id),
  actor      text not null,
  created_at timestamptz not null default now()
);

create table messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id),
  role            text not null check (role in ('user','assistant')),
  body            text not null,
  refusal         boolean not null default false,
  citations       jsonb,               -- [{n, fact_id, story_unit_id, quote}]
  trace           jsonb,               -- retrieval set, adapter, models, gate decisions
  created_at      timestamptz not null default now()
);

-- Minimal Postgres-backed job queue (plain queues suffice for Phase 1 — §16 open decision 1).
create table jobs (
  id         bigint generated always as identity primary key,
  kind       text not null,
  payload    jsonb not null default '{}',
  status     text not null default 'queued'
             check (status in ('queued','running','done','error')),
  attempts   int not null default 0,
  error      text,
  run_after  timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_claim_idx on jobs (status, run_after, id);

-- Append-only audit (P8). No updates, no deletes.
create table audit_log (
  id         bigint generated always as identity primary key,
  actor      text not null,
  action     text not null,
  subject    text,                     -- e.g. profile/media/fact id
  detail     jsonb,
  created_at timestamptz not null default now()
);
