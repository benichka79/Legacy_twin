-- Semantic retrieval: embedding columns for facts (retrieval targets) and
-- story units (future use: unit-level search, clustering). 1024 dims matches
-- the default Voyage model; the mock adapter emits the same dimension.
-- No ANN index yet — sequential scan is fine below ~10^5 rows; add HNSW later.

alter table story_units add column embedding vector(1024);
alter table facts add column embedding vector(1024);
