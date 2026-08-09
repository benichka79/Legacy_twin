-- Worldview layer: facts carry a kind. 'fact' = biographical memory;
-- 'value' = principle/belief; 'opinion' = view/taste/judgment. Values and
-- opinions power the extrapolation answer mode ("what would they say") —
-- answers grounded in recorded character when no direct memory exists.

alter table facts add column kind text not null default 'fact'
  check (kind in ('fact','value','opinion'));

-- Seeded/known values: Miriam's patience principle is a value, not a memory.
update facts set kind = 'value'
  where id = '00000000-0000-0000-0000-000000000043';
