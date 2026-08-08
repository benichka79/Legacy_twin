-- Multilingual archive: recordings carry their language (ru/he/en/mixed), and
-- each story unit carries the FTS configuration to index and query it with —
-- 'russian' and 'english' stem, Hebrew and mixed text use 'simple' (Postgres
-- has no Hebrew stemmer; multilingual embeddings are the semantic backbone).

alter table media_objects add column language text
  check (language in ('ru','he','en','mixed'));

alter table story_units add column lang regconfig not null default 'simple';

-- Rebuild the FTS column to use the per-row configuration.
drop index if exists story_units_tsv_idx;
alter table story_units drop column tsv;
alter table story_units add column tsv tsvector
  generated always as (to_tsvector(lang, body)) stored;
create index story_units_tsv_idx on story_units using gin (tsv);

-- Everything ingested before this migration was English.
update story_units set lang = 'english';
