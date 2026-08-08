# Legacy Twin — walking skeleton

A consent-first legacy archive: capture a living person's stories, verify them into
provenanced facts, answer questions only from what was approved — or refuse honestly.
This repo is the Phase 1 walking skeleton of [ARCHITECTURE.md](ARCHITECTURE.md), derived
from the business plan PDF.

Everything runs locally with **zero API keys** (mock adapters). One demo profile
("Miriam") is seeded so the whole loop works immediately.

## Quickstart

```bash
docker compose up -d          # Postgres 16 + pgvector on :5434  (or: docker-compose up -d)
cp .env.example .env
npm install
npm run db:migrate && npm run db:seed
npm run dev                   # → http://localhost:3000
```

Pipeline worker (processes uploads → story units → candidate facts):

```bash
python3 -m venv .venv && .venv/bin/pip install -e workers/pipeline
.venv/bin/python -m pipeline.main --once
```

Evals (the seed of the 98%-grounding CI gate):

```bash
npm run eval
```

## The loop

| Page | What it proves |
|---|---|
| `/capture` | Originals are immutable: checksummed, content-addressed, write-once (P3) |
| worker | Transcribe → segment → **candidate** facts with char-span provenance |
| `/review` | Nothing enters the memory graph without subject approval (P1) |
| `/ask` | Retrieval-first over approved facts only; citations or honest refusal (P2) |
| `/api/export` | Legacy Archive Format draft 0 — the whole archive as open JSON (P7) |

Every API route passes the consent PDP (`apps/web/src/server/pdp.ts`), consent is an
append-only event ledger, and every action writes to `audit_log` (P8).

## Switching from mocks to real providers

Set in `.env`:

- `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` — grounded generation
  (`claude-sonnet-5`) and claim-by-claim verification (`claude-haiku-4-5`).
- `ASR_PROVIDER=deepgram` + `DEEPGRAM_API_KEY` — real audio transcription.

The mock LLM composes answers verbatim from approved statements, so it cannot invent
facts by construction — useful as a deterministic eval baseline forever.

## What's deliberately missing (Phase 1 is concierge)

Auth (actors are hardcoded `subject:miriam` / `family:demo`), payments, voice, embeddings
(FTS retrieval for now; pgvector is installed and waiting), Memorial Mode, death
verification, S3 (local-disk vault behind the same interface). See ARCHITECTURE.md §15
for what lands in which phase.

## Layout

```
apps/web/              Next.js UI + API + the answer path (respond.ts is the core)
workers/pipeline/      Python worker: ingest → transcribe → segment → extract
db/                    SQL migrations + demo seed
evals/                 Grounding eval suite (runs in CI against the seeded db)
scripts/db.mjs         Migration/seed runner
```
