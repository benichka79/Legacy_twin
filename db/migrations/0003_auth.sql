-- Auth: users, per-profile role grants, and cookie sessions.
-- Replaces the skeleton's hardcoded actors. Real identity verification (IDV
-- vendor, liveness) arrives with Phase 2; this is the session/role substrate.

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  display_name  text not null,
  password_hash text not null,            -- scrypt: <salt-hex>:<hash-hex>
  created_at    timestamptz not null default now()
);

-- A user's role on a profile. Actor strings are derived as "<role>:<email>",
-- so the PDP's role/audience matching keeps working unchanged.
create table grants (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id),
  profile_id uuid not null references profiles(id),
  role       text not null check (role in ('subject','steward','contributor','family','support')),
  created_at timestamptz not null default now(),
  unique (user_id, profile_id)
);

create table auth_sessions (
  token      text primary key,            -- random 256-bit hex, HttpOnly cookie
  user_id    uuid not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index auth_sessions_user_idx on auth_sessions (user_id);
