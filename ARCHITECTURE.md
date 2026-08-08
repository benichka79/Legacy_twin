# Legacy Twin — System Architecture v0.1

Derived from the business plan (Aug 2026), especially §3 (product definition), §8 (technology and
data architecture), §9 (trust & safety), and §11 (roadmap). This maps the plan's nine named
components into a concrete, buildable system sized for the planned team (CTO + 2 full-stack +
1 applied AI engineer at start).

---

## 1. Architecture principles

These restate the plan's non-negotiables as engineering rules. Every design decision below traces
to one of them.

- **P1 — Consent is a runtime check, not a signup step.** Every read of memory data and every
  generation passes through a single policy decision point (PDP) that evaluates the current,
  versioned consent state. No code path reaches the memory graph or the vault around it.
- **P2 — Retrieval-first, generation-constrained.** The model never answers from parametric
  knowledge. Facts come only from approved memories; anything else is marked inference or refused
  ("I never recorded that"). A post-generation verifier enforces claim↔source entailment.
- **P3 — Originals are immutable.** Raw media is write-once (object-lock), checksummed, and
  survives every downstream failure. Everything else is derivable.
- **P4 — Freeze is real.** At verified death/incapacity the persona (graph snapshot + style +
  voice + model/prompt versions) is pinned. Post-death family material becomes labeled
  annotation in a separate corpus — it is never blended into the persona.
- **P5 — No arbitrary synthesis surface.** TTS accepts only signed, policy-approved response
  tokens minted by the response engine. There is no free-text voice endpoint anywhere in the API,
  including internal/admin tooling. Output audio is watermarked.
- **P6 — Vendors are replaceable; the moat is ours.** ASR/LLM/TTS/embedding/identity sit behind
  adapters with zero-retention contracts and two qualified providers each. Internal investment
  goes to consent, provenance, evaluation, and orchestration.
- **P7 — Exportable = restorable.** The open Legacy Archive Format (LAF) is a first-class output,
  and the system must be reconstructible from a LAF export. Restore is tested continuously.
- **P8 — Everything is audited.** Access to media, graph, and conversations writes an append-only
  audit event. Consent and lifecycle changes are event-sourced and hash-chained.
- **P9 — Region is a property of the profile.** Each profile has a home region that pins storage
  and processing location (US-only at launch; EU/Israel later per the legal plan).
- **P10 — No engagement machinery.** Nothing in the architecture optimizes for session length:
  no notification fan-out "from" the persona, no streak state, no recommendation loops.

## 2. Shape of the system

**Modular monolith + async workers.** One deployable core application (API + web), one worker
fleet for media/AI processing, one durable-workflow engine for long-running processes
(death verification waiting periods, disputes, exports, consent expiry). Microservices are
explicitly deferred; module boundaries below are enforced in code so extraction stays possible.

Modules (≈ the plan's nine components):

| # | Plan component (§8) | Module here |
|---|---------------------|-------------|
| 1 | Consent ledger | `consent` — ledger + PDP |
| 2 | Encrypted media vault | `vault` |
| 3 | Processing pipeline | `pipeline` (workers) |
| 4 | Memory graph | `graph` |
| 5 | Response engine | `respond` |
| 6 | Style layer | `persona.style` |
| 7 | Voice layer | `persona.voice` |
| 8 | Memorial control plane | `lifecycle` |
| 9 | Evaluation & monitoring | `evals` + `audit` |

Plus cross-cutting: `identity` (users, roles, age gate, liveness), `billing` (Stripe; activation,
subscription, voice-minute metering), `export` (LAF), `partner` (Phase 3 portal).

## 3. Data stores

- **Postgres** (single primary store, RLS tenant isolation by `profile_id`):
  relational data, the memory graph (typed node/edge tables — a dedicated graph DB is deferred
  until scale demands), embeddings via pgvector, consent/audit event tables (append-only,
  hash-chained).
- **Object storage (S3)**: media vault. Per-profile envelope encryption (KMS data keys),
  object-lock on the `originals/` prefix, lifecycle tiers (hot → IA → deep archive for redundant
  copies), SHA-256 checksums recorded at ingest. Bucket selection by profile home region.
- **Redis / queue**: job queues, rate limits, session state.
- **Durable workflows (Temporal or equivalent, from Phase 2)**: death verification, disputes,
  exports, escrow snapshots, retention timers.

### Core tables (abridged)

`profiles`, `users`, `grants(role: subject|steward|contributor|interactant|support)` ·
`consent_events` (ledger) + `consent_state` (projection) ·
`media_objects`, `transcripts`, `story_units` ·
`graph_nodes(person|event|place|story|value|preference|quote|artifact)`, `graph_edges`,
`provenance_spans(media_id, t_start, t_end | doc_range)`, `approvals` ·
`conversations`, `messages`, `retrieval_logs`, `responses(citations[], runtime_version)` ·
`lifecycle_events`, `verification_cases`, `disputes`, `annotations` (post-death corpus) ·
`audit_log` · `eval_suites`, `eval_runs` · `exports`, `escrow_snapshots`.

## 4. Consent ledger and policy decision point

- The ledger is an append-only, hash-chained event stream per profile: identity proof, liveness
  attestation, modality grants (text / voice / likeness), audience grants (named people, roles),
  purposes, temporal scope (living vs. memorial), successor designations, expiries, revocations.
  Each event is signed (subject's session key + server key) and versioned.
- `consent_state` is a rebuildable projection; the PDP evaluates it on every request:
  *(actor, profile, modality, purpose, lifecycle_state) → allow | deny | require_opt_in*.
- Revocation is immediate: PDP reads current state; media/voice-model deactivation jobs enqueue
  on revocation events.
- Family interactants each have their own opt-in record (mutual-consent requirement from §9);
  Memorial Mode adds an 18+ age gate.

## 5. Capture and processing pipeline

Ingest (guided interview audio, uploads, family question submissions) →
virus scan → checksum + vault write (immutable original) → transcription (ASR adapter) →
speaker separation → segmentation into **story units** → entity/event extraction (LLM adapter) →
sensitive-data classification (health, beliefs, finances, third parties — flags routed to the
subject's review queue with stricter default visibility) → **candidate facts**.

Nothing becomes part of the persona without explicit subject approval in the review UI
(facts, names, dates, pronunciations, sensitive-topic boundaries). Approval writes provenance:
every graph node/edge links to source spans, an approval record, and a confidence score.
Third-party submissions (family questions, annotations) are stored in a separate corpus and
never silently merged (P4).

## 6. Memory graph

Typed nodes and edges with full provenance, stored relationally:

- Node status: `candidate → approved → disputed → retracted`; all mutations are events.
- Every node/edge carries ≥1 provenance span pointing into transcripts/media.
- Per-audience visibility rules (the subject can restrict topics per person/role).
- Embeddings maintained per story unit and per approved fact for hybrid retrieval; raw text is
  the source of truth so embeddings can be regenerated on vendor swap.
- At freeze, the graph gets an immutable snapshot tag; Memorial Mode serves only that snapshot.

## 7. Response engine — the answer path

The differentiating pipeline. Steps 2–7 are the moat; each writes to the trace log.

1. **AuthN/AuthZ** — session scoped to profile; role + age gate.
2. **PDP consent gate** (P1).
3. **Query understanding** — entity resolution against the graph (names, nicknames, dates).
4. **Hybrid retrieval** (BM25 + vector) over *approved* memories only, filtered by audience
   visibility.
5. **Sufficiency gate** — coverage/confidence score. High-stakes domains (health, money, family
   conflict, legal) require direct quotation/playback or refusal (§8 rule). Below threshold →
   honest refusal: "I never recorded that."
6. **Grounded generation** — constrained prompt with retrieved spans; no facts beyond spans;
   inferences must be explicitly marked as such.
7. **Verification pass** — claim extraction, then entailment check of each claim against its
   spans (small fast model). Fail → one regeneration → else refusal. Sampled results feed the
   unsupported-claim metric (§14).
8. **Style pass** — persona style layer rewrites tone/cadence only; a diff check ensures no
   factual drift. Style parameters derive exclusively from approved first-party samples.
9. **Citations attached** — every factual sentence links to its span with original-audio
   playback deep-links.
10. **Optional voice** — response engine mints a signed approved-response token; the TTS adapter
    accepts only such tokens (P5); audio is watermarked and minute-metered.
11. **Safety** — distress/self-harm classifier on user messages with an escalation flow
    (human review, resources); boundary behaviors ("are you really him?") answered per the
    product constitution: it says it is an AI representation.

## 8. Persona: style and voice

- **Style layer**: lexicon, cadence, formality, humor markers, pronunciation dictionary — derived
  only from approved first-party samples; versioned; frozen at memorial transition.
- **Voice layer**: voice model created only after the subject approves similarity and permitted
  use; keys stored per profile; deactivated on revocation; no downloadable voice model; no
  telephone/outbound calling integration, ever (plan exclusion).

## 9. Lifecycle and memorial control plane

State machine (durable workflows):

`Onboarding → Living ⟲ (capture/review/converse) → Verification → Frozen → Memorial → Retired`

- **Verification protocol** (subject-selected at onboarding): M-of-N designated verifiers attest,
  plus a waiting period, plus optional documentary evidence (death certificate). Incapacity uses
  the same machinery with different evidence.
- **Dispute freeze**: any contributor can open a dispute; memorial access halts until resolution
  per the subject's prior instructions. No single steward can alter the persona (governance rule).
- **Freeze semantics** (P4): graph snapshot pinned, style/voice/model/prompt versions pinned, no
  new approvals possible, "learning from descendants" structurally impossible — post-death input
  lands in the labeled annotation corpus only.
- **Memorial Mode**: per-interactant opt-in, 18+, clearly labeled simulation, no autonomous
  outreach (no notification path exists from persona to humans).
- **Retirement**: export, respectful archive, or deletion with certificate; individual opt-out
  never blocks others' access.

## 10. Evaluation, monitoring, release management

- **Persona regression suite**: per-profile golden Q&A with expected citations; the 500-question
  global set including adversarial prompts (impersonation, boundary probing, high-stakes topics,
  consciousness claims).
- **Runtime version pinning**: a persona runtime = (LLM version, prompt set, retrieval config,
  style version, voice model). Memorial profiles pin their runtime and migrate only after the
  regression suite passes on the new tuple — this is the plan's "model changes require regression
  tests against archived personas" rule made mechanical.
- **CI gates**: any change to prompts/models/retrieval must pass grounding ≥98% and
  critical-hallucination <0.5% on the eval set (Phase 3 gate values).
- **Canary rollout** by profile cohort for vendor/model changes.
- **Runtime monitors**: sampled claim-grading, refusal precision/recall, distress reports,
  synthetic-media leakage attempts, consent verification failures — feeding the §14 metrics.

## 11. Security, tenancy, compliance

- Postgres RLS on `profile_id` everywhere; no cross-tenant queries by construction.
- Per-profile KMS data keys (envelope encryption); originals object-locked (P3).
- Staff access: SSO + hardware keys; break-glass access requires dual control and writes
  prominent audit events; support tooling shows metadata, not memory content, by default.
- Append-only audit log for every media/graph/conversation access (P8).
- SOC 2 controls mapped from Phase 2 (readiness), Type I at Phase 3, Type II at Phase 4.
- Pen test before paid beta (Phase 2 per roadmap). Biometric handling (voiceprints, face
  geometry) built to the strictest applicable standard (BIPA-style written consent, retention
  and destruction schedules) regardless of jurisdiction.

## 12. Export, continuity, escrow

- **Legacy Archive Format (LAF)**: documented, open: raw media + transcripts (JSON/VTT) +
  memory graph (JSON-LD) + consent ledger extract + audit summary + a self-contained
  human-readable HTML index. No proprietary lock.
- Export is a one-click async job; time-to-export is a tracked trust metric (§14).
- **Escrow**: quarterly LAF snapshots per profile + code escrow with an independent agent;
  continuity reserve reporting hooks (annual transparency report).
- **Restore test**: CI continuously rebuilds a working archive from a LAF export (P7).

## 13. Vendor abstraction

Adapters with contract tests and per-call routing config; zero-retention agreements; two
qualified providers per capability:

| Capability | Adapter | Launch candidates (replaceable) |
|---|---|---|
| ASR + diarization | `asr` | Deepgram / AssemblyAI |
| Generation | `llm` | Claude Sonnet 5-class primary; second qualified provider |
| Classification/verification | `llm.small` | Haiku 4.5-class fast models |
| Embeddings | `embed` | provider-agnostic; raw text retained for re-embedding |
| TTS / voice cloning | `tts` | ElevenLabs / alternative; watermarking required |
| Identity + liveness | `idv` | Stripe Identity / Persona |
| Payments | `pay` | Stripe |

No internal model training (plan §12); engineering investment goes to evaluation, provenance,
consent, security, orchestration.

## 14. Deployment and suggested stack

- **App**: TypeScript; Next.js web (capture, review, conversation, steward console); API in the
  same deployable; React Native mobile at Phase 4.
- **Workers**: Python (AI glue) consuming queues; Temporal (or equivalent) for durable workflows
  from Phase 2.
- **Infra**: AWS single region (us-east-1) with region abstraction from day one (P9); Terraform;
  CloudFront; OpenTelemetry + error tracking with PII scrubbing in log pipelines.

## 15. Build order (maps to roadmap §11)

| Phase | Architecture scope |
|---|---|
| **1 — Concierge (m2–4)** | Monolith + Postgres + S3 vault; capture app; ASR adapter; review UI; memory graph v1; text-only response engine with citations + refusal; export v1 (LAF draft); manual consent records + IDV vendor; eval set v1 in CI. Human-in-the-loop everywhere. |
| **2 — Paid beta (m5–9)** | Consent ledger hardening + PDP everywhere; voice layer with signed-token gate; payments + metering; audit log UI; successor roles; death-verification pilot (workflow engine); pen test, SOC 2 readiness. |
| **3 — US launch (m10–15)** | Full memorial control plane (disputes, opt-in, freeze); self-service gift flow; partner portal beta; liveness/consent automation; abuse monitoring; SOC 2 Type I. |
| **4 — Scale (m16–24)** | Mobile apps; multilingual ASR; regional hosting (EU/IL); partner billing; advanced provenance (C2PA-style content credentials); SOC 2 Type II; isolated visual-avatar research track (separate consent, separate infra). |

## 16. Risks → architectural mitigations (from plan §15)

| Risk | Architectural answer |
|---|---|
| Hallucinated memories | Retrieval-only + verifier pass + refusal threshold + frozen memorial snapshot (P2, P4) |
| Impersonation / voice fraud | Signed-token TTS only, watermarking, rate limits, liveness at enrollment (P5) |
| Company failure | LAF export, escrow snapshots, restore tests (P7) |
| Vendor dependence | Adapter layer, two qualified vendors, raw-text re-embedding (P6) |
| Family conflict | Event-sourced consent, prior-instruction precedence, dispute-freeze workflow, immutable originals |
| Regulation fragments | Region pinned per profile; jurisdiction gating at signup (P9) |
| Emotional harm | No engagement machinery in the data model (P10); distress classifier + escalation flow |

## 17. Open decisions

1. Workflow engine at Phase 1: plain queues suffice; adopt Temporal when death-verification
   workflows land (Phase 2) — revisit if consent-expiry timers get complex earlier.
2. Dedicated graph store: only if relational graph traversals become a bottleneck (unlikely
   below ~10⁵ profiles).
3. Embedding/model second vendors: qualify during Phase 1 vendor bake-off (plan: "select two
   model/voice vendors and design for replacement", days 31–60).
4. Content credentials standard (C2PA) for synthetic-media labeling: adopt when tooling matures;
   metadata labeling ships from day one regardless.
5. EU/Israel region build-out timing: gate on legal memo (plan §10) and demand, not architecture.
