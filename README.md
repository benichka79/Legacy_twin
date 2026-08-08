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
| `/api/style` | Style layer: POST derives a voice profile from approved samples (worker job); answers are then restyled in the subject's first-person voice — re-verified after styling, falling back if any fact or citation drifts (§8) |

Every API route passes the consent PDP (`apps/web/src/server/pdp.ts`), consent is an
append-only event ledger, and every action writes to `audit_log` (P8).

## Switching from mocks to real providers

Set in `.env`:

- `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` — grounded generation
  (`claude-sonnet-5`) and claim-by-claim verification (`claude-haiku-4-5`).
- `ASR_PROVIDER=deepgram` + `DEEPGRAM_API_KEY` — real audio transcription for the
  in-browser recorder and audio uploads (key from console.deepgram.com; new accounts
  include free credit; `ASR_MODEL=nova-2` if `nova-3` is unavailable).
- `EMBED_PROVIDER=voyage` + `VOYAGE_API_KEY` — semantic retrieval via pgvector
  (key from dash.voyageai.com; free tier available). Retrieval is hybrid: lexical
  FTS and embedding cosine, and a span qualifies via either gate — with the mock
  embedder (deterministic hashing) behavior matches plain FTS, so CI is stable.
  Embeddings backfill lazily at ask time; new content is embedded on the next ask.

The capture page runs a **guided interview**: curated questions across life domains
(`apps/web/src/app/capture/prompts.ts`); the question travels with the recording and
gives the extraction pipeline conversational context.

The mock LLM composes answers verbatim from approved statements, so it cannot invent
facts by construction — useful as a deterministic eval baseline forever.

## Auth

Session auth with per-profile roles (no external services): scrypt passwords, HttpOnly
cookie sessions, and a `grants` table mapping users to roles. Actors are
`<role>:<email>`, which the consent PDP consumes directly. Demo accounts:

- subject — `miriam@demo.local` / `miriam-demo` (capture, review, export, style)
- family — `family@demo.local` / `family-demo` (ask only, own opt-in required)

## What's deliberately missing (Phase 1 is concierge)

Identity verification (IDV/liveness — Phase 2; passwords are the skeleton stand-in),
payments, voice, Memorial Mode, death verification, S3 (local-disk vault behind the
same interface). See ARCHITECTURE.md §15 for what lands in which phase.

## Layout

```
apps/web/              Next.js UI + API + the answer path (respond.ts is the core)
workers/pipeline/      Python worker: ingest → transcribe → segment → extract
db/                    SQL migrations + demo seed
evals/                 Grounding eval suite (runs in CI against the seeded db)
scripts/db.mjs         Migration/seed runner
```
