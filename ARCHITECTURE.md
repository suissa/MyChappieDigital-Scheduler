# Architecture

OpenMental modelled as a **governed semantic runtime**: semantics → contexts →
intents → flows → actors → atomic behaviours → invocation policies → events →
effects → event history → projections. Inspired by the AllasCode contract
(`Lucy-mae/AGENTS.md`) and the 2Flow notation (`Lucy-mae/docs/2Flow`).

## 1. Everything as Code

`config/` is the single source of every value that carries business meaning.
The rule is mechanical: **no money amount, model id, subject string, weight,
threshold, quota, endpoint, canonical label or semantic-type name appears
outside `config/`.**

| file | owns |
|---|---|
| `money.ts` | `Money` (centavos, branded), `PRICE_BOOK`, revenue split |
| `ai-models.ts` | model registry (medgemma, whisper-large-v3-turbo, elevenlabs, qwen) — every entry `authoritative: false` |
| `subjects.ts` | the NATS subject grammar `openmental.<ctx>.<agg>.<name>.<kind>.<ver>`, wildcard patterns |
| `clinical.ts` | condition taxonomy, keyword lexicons, urgency ladder, crisis lexicon, the gate urgency |
| `scheduling.ts` | slot geometry, fair-queue params, match weights/penalties (bps), affinity EMA |
| `identity.ts` | canonical labels for agents, contexts, behaviours; invocation policies |
| `semantic-types.ts` | the nominal port types the flow-graph checker compares |
| `projections.ts` · `broker.ts` · `plans.ts` · `integrations.ts` | projection namespaces · UbiQUIC connection · the three Camadas · WhatsApp/Groq endpoints + message templates |

## 2. Messaging — UbiQUIC only

```
TS agents ──(nats npm client)──▶  UbiQUIC sidecar (Zig 0.16, NATS wire subset)
                                    ├─ event sourcing → data/*.qmes
                                    ├─ DPoP proof per emission
                                    ├─ mTLS + Kyber envelope transcript per delivery
                                    ├─ fair redelivery ordering, ACK-TTL
                                    └─ DLQ → Outbox
```

`BrokerPort` has exactly one implementation, `UbiQuicNatsClient` — a thin
wrapper over the stock `nats` client. Publishing wraps the payload in an
`Envelope` (id, subject, kind, schema version, producer, context, `occurredAt`,
`correlationId`, `causationId`). Nothing broker-side is reimplemented in TS.

The sidecar speaks `INFO`/`CONNECT`/`PING`/`PONG`/`SUB`/`UNSUB`/`PUB`/`MSG`/
`+OK`/`-ERR`. Delivery is one `MSG` **per matching subscription** (NATS
semantics). Documented gaps: TLS, auth, headers/HPUB, JetStream, queue-group
load-balancing (every member receives), and the address-list ACK-TTL
redelivery loop (in NATS mode the live connections are the subscribers).

## 3. AtomicBehaviours

The fundamental executable unit. Each is **generic** and lives in its own
directory with a manifest:

```
src/behaviors/actions/<label>/index.ts
  manifest      canonical identity, semantic input/output types, invocation
                policy + allowed agents, HITL flag, listened/emitted subjects,
                execution (state / sandbox / idempotent)
  configSchema  zod — the binding contract
  inputSchema / outputSchema   zod — the execution contract
  execute(ctx, config, input): Result<output>
```

`ctx` gives only **capability ports** — `kv`, `locks`, `bus`, `http`, `clock`,
`logger`. A behaviour never imports a concrete store, broker or HTTP client, so
it is trivially sandboxable and swappable.

The ten actions: `classify-text`, `score-weighted`, `select-top-k`,
`assign-sequence-position`, `reserve-resource`, `release-resource`,
`request-human-approval`, `record-projection`, `dispatch-notification`,
`transcribe-audio`. None knows about mental health — the *bindings* make them
domain-specific.

## 4. Tools

```
Tool = AtomicBehaviour + bound config (from config/) + owning agent
```

`Tool.invoke(ctx, input, invoker)`:
1. `accepts(invoker)` — the target actor's own authorization (`B.Accepts(A)`).
   A restricted behaviour rejects an unauthorised agent with a typed
   `INVOCATION_DENIED` outcome.
2. validate input against `inputSchema`
3. `execute`
4. validate output against `outputSchema`

`src/tools/catalog.ts` declares every concrete Tool instance as code; the config
comes only from `config/`.

## 5. Agents & choreography

Nine actors (`src/agents/`):

| agent | flow node(s) | reacts to → emits |
|---|---|---|
| intake | ReceiveIntake | `intakeSubmitted` → `triageRequested` |
| triage | TriageComplaint | `triageRequested` → `triageCompleted` (+`crisisDetected`) |
| governance | `[?ClinicalReview]` | `crisisDetected` → `clinicalReviewResolved` (drives the HITL gate tool: freeze → ask on the bus → resume) |
| orchestrator | *supervises* | `triageCompleted`/`clinicalReviewResolved` → `matchingRequested` \| `matchingFailed`; failure routes → apology notification |
| matching | ScoreAffinity · RankProfessional · ScreenClinicPolicy | `matchingRequested` → `professionalMatched` \| `matchingFailed` |
| queue | AssignQueueSlot | `professionalMatched` → `queuePositionAssigned` |
| scheduling | ReserveConsultaSlot · ReleaseSlotHold · RecordConsulta | `queuePositionAssigned` → `consultaScheduled` \| `slotReservationFailed`; saga compensation; `consultaScheduled` → `consultaProjectionUpdated` |
| notification | NotifyPatient | `consultaProjectionUpdated` \| `whatsappDispatchRequested` → `whatsappDispatched` |
| audit | — (witness) | `openmental.*.*.*.event.v1` → correlation-indexed trail + counters |

The **AgentRuntime** subscribes each agent to the bus and gives it a **serial
mailbox** — an Actor processes one message at a time. Choreography is the
default: no central conductor, agents react and emit. **Orchestration** is used
exactly where choreography can't decide alone:

- the `[?ClinicalReview]` gate (whether to hold or proceed after triage), and
- the failure routes (`matchingFailed`, `slotReservationFailed` → patient
  notification).

The **saga** (`ReserveConsultaSlot !-> ReleaseSlotHold`) is choreographed: a
failed reservation emits `slotReservationFailed`, which the same agent picks up
to run the compensator, then emits `slotHoldReleased`.

## 6. The flow graph

`src/orchestration/flow-dsl/`:

```
tokens.ts     :--:  !->  [ ]  ,  ?
parser.ts     DSL string → AST (segments: step | fork-join | gate; `!->` binds
              tighter than `:--:`)
graph.ts      AST + NodeBindings → { nodes, edges, stages, entryType, exitType }
typecheck.ts  the 2Flow "Regra de Tipos em Comptime":
                sequence  OutputType(A) ≡ InputType(B)
                fork      OutputType(up) ≡ InputType(branch[i]₀)   ∀ i
                join      OutputType(primary branch) ≡ InputType(next)
                saga      InputType(A) ≡ InputType(Comp)
              → pedagogical diagnostic on violation
render.ts     ASCII topology · edge table · Mermaid
```

`compileFlow()` = parse + bind + typecheck. `bootstrap()` calls it as a **hard
startup gate** — the system refuses to run a graph that doesn't type.

Two type levels, both enforced:
- **flow contract** — the phase types (`IntakeSubmission`, `TriagedIntake`,
  `MatchedIntake`, `QueuedIntake`, `ScheduledConsulta`, `PersistedConsulta`,
  `ConfirmedConsulta`), checked by `typecheckGraph`.
- **tool contract** — each Tool's zod input/output schema, checked at `invoke`.

The agent handler bridges them (fetch read-model data, build the tool input,
fold the tool result into the next phase aggregate).

## 7. Events, projections, provenance

Events are typed facts (`src/domain/events.ts` — one zod schema per subject).
The runtime validates every inbound envelope against its subject schema before a
handler runs, and refuses to emit a payload that fails its schema.

Projections (`record-projection` behaviour + `src/projections/read.ts`):
`queue`, `consulta`, `professional-affinity`, `intake-record`. Each stored as
`{ version, document }`; derivable from events; never the source of truth.

Provenance: `correlationId` threads the whole flow; `causationId` links each
event to the event that produced it; the audit agent + the `.qmes` streams give
two independent records of what happened.

## 8. Security posture

Zero-Trust seams are present in shape: cryptographic actor identity and replay
protection modelled in the sidecar (DPoP, mTLS/Kyber transcript); the HITL gate
is cryptographically-nothing-yet but fully auditable (request + decision both
traverse the bus). Authentication vs authorization are separate concerns — the
Tool authorises invocation independently of the requesting agent.

## 9. Known simplifications (vertical slice)

- KV / locks / directory are in-memory (`src/adapters`, `src/domain/directory.ts`);
  the ports are what agents depend on — Redis/Postgres/Neo4j swap in behind them.
- The triage classifier is a deterministic lexicon, not a call to medgemma; the
  semantic output and its schema are model-ready.
- Transcription / voice cloning / video-emotion / billing-quota behaviours are
  declared (manifests, config, price hooks) but only `transcribe-audio` is wired
  into the slice, in offline mode.
- Queue-group load balancing is not implemented in the sidecar (every member
  receives) — fine while each agent is a singleton.
