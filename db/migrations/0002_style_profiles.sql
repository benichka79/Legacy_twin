-- Style layer (ARCHITECTURE.md §8): the persona's voice, derived exclusively from
-- approved first-party samples. Versioned and append-only; the highest version is
-- active. Frozen at memorial transition (freeze pins the version — Phase 3).

create table style_profiles (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id),
  version      int  not null,
  params       jsonb not null,          -- tone, cadence, signature phrases, habits, themes
  sample_chars int  not null default 0, -- how much approved material fed the derivation
  derived_by   text not null,           -- adapter: mock | anthropic:<model>
  created_at   timestamptz not null default now(),
  unique (profile_id, version)
);
