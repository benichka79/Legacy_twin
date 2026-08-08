-- Demo seed: one subject ("Miriam"), consented, with three approved memories,
-- two candidates awaiting review, and one queued text upload for the worker demo.
-- Fixed UUIDs so evals and docs can reference them.

insert into profiles (id, display_name, lifecycle)
values ('00000000-0000-0000-0000-000000000001', 'Miriam (demo subject)', 'living')
on conflict (id) do nothing;

-- Consent: subject grants text capture + conversation for family; demo family member opts in.
insert into consent_events (profile_id, actor, modality, purpose, audience, action) values
  ('00000000-0000-0000-0000-000000000001', 'subject:miriam', 'text', 'capture',      'family', 'grant'),
  ('00000000-0000-0000-0000-000000000001', 'subject:miriam', 'text', 'conversation', 'family', 'grant'),
  ('00000000-0000-0000-0000-000000000001', 'subject:miriam', 'text', 'export',       'family', 'grant'),
  ('00000000-0000-0000-0000-000000000001', 'family:demo',    'text', 'conversation', 'self',   'grant');

insert into media_objects (id, profile_id, kind, filename, sha256, vault_path, status)
values ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001',
        'text', 'miriam-stories-session-1.txt', 'seed', 'seed://miriam-stories-session-1', 'processed')
on conflict (id) do nothing;

insert into transcripts (id, profile_id, media_id, body, source)
values ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000010',
        'I started working at my uncle''s bakery on Herzl Street in Haifa in 1962. I was sixteen, and my job was to carry the flour sacks up from the cellar before dawn. The smell of the first loaves is still the smell of morning to me.

I met my husband David at a wedding in the spring of 1965. He stepped on my foot during the dancing and then apologized for five whole minutes. I married him because a man who apologizes properly is rarer than you think.

If you want bread to rise, you cannot rush it. People are the same. Patience is the whole secret — with dough, with children, with grief. Everything good I have made in my life, I made slowly.',
        'verbatim')
on conflict (id) do nothing;

insert into story_units (id, profile_id, transcript_id, seq, body, char_start, char_end) values
  ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000020', 1,
   'I started working at my uncle''s bakery on Herzl Street in Haifa in 1962. I was sixteen, and my job was to carry the flour sacks up from the cellar before dawn. The smell of the first loaves is still the smell of morning to me.',
   0, 226),
  ('00000000-0000-0000-0000-000000000032', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000020', 2,
   'I met my husband David at a wedding in the spring of 1965. He stepped on my foot during the dancing and then apologized for five whole minutes. I married him because a man who apologizes properly is rarer than you think.',
   228, 447),
  ('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000020', 3,
   'If you want bread to rise, you cannot rush it. People are the same. Patience is the whole secret — with dough, with children, with grief. Everything good I have made in my life, I made slowly.',
   449, 640)
on conflict (id) do nothing;

-- Approved facts (the subject reviewed these).
insert into facts (id, profile_id, story_unit_id, statement, confidence, status, reviewed_at) values
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000031',
   'Miriam began working at her uncle''s bakery on Herzl Street in Haifa in 1962.',
   0.95, 'approved', now()),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000032',
   'Miriam met her husband David at a wedding in the spring of 1965.',
   0.95, 'approved', now()),
  ('00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000033',
   'Miriam''s advice is that patience is the whole secret — with dough, with children, and with grief.',
   0.9, 'approved', now())
on conflict (id) do nothing;

-- Candidates awaiting review (visible in /review for the demo).
insert into facts (id, profile_id, story_unit_id, statement, confidence, status) values
  ('00000000-0000-0000-0000-000000000044', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000031',
   'Miriam was sixteen when she started at the bakery, carrying flour sacks up from the cellar before dawn.',
   0.7, 'candidate'),
  ('00000000-0000-0000-0000-000000000045', '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000032',
   'David apologized for five minutes after stepping on Miriam''s foot while dancing.',
   0.7, 'candidate')
on conflict (id) do nothing;
