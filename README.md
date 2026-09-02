# MyChappieScheduler — OpenMental

Event-driven, multi-agent implementation of [`docs/prompts/00.md`](docs/prompts/00.md)
(the **OpenMental** product: teleconsulta, agenda, agente assistente que aprende
afinidade profissional ↔ condição e define a posição do paciente na fila).

Built to four constraints:

| Constraint | How it lands here |
|---|---|
| **Everything as Code** — nenhum valor bruto no código | Every money value, model id, subject, weight, quota, endpoint, canonical label and semantic type lives in [`config/`](config/). Nothing business-meaningful is a literal anywhere else. |
| **Event-driven multi-agents**, choreography-first | 9 agents ([`src/agents/`](src/agents/)) react to typed facts on the bus and emit the next fact. Only the `[?ClinicalReview]` gate and the failure routes are *supervised* (the Orchestrator). |
| **UbiQUIC as the broker** | [`packages/Services/UbiQUIC`](packages/Services/UbiQUIC) is a **Zig** broker ported to Zig 0.16 that speaks the **NATS wire protocol**. TypeScript connects with the stock `nats` client — **no brokering logic is reimplemented in TS**. |
| **Data flow declared as a graph** | The whole flow is one string in the Lucy-mae *2Flow* notation (`:--:` `!->` `[A,B]` `[?Gate]`), compiled + **type-checked** (`OutputType(A) ≡ InputType(B)`) at startup. |

Each atomic action is an independent, generic **AtomicBehaviour** module
([`src/behaviors/actions/`](src/behaviors/actions/)); an agent turns one into a
concrete **Tool** by binding config from `config/` — and the *Tool* (not the
agent) authorises its own invocation.

---

## Run it

```bash
# 1. the broker sidecar (Zig 0.16, via WSL) — listens on 127.0.0.1:4433
npm run sidecar

# 2. the agent society + a demo intake
npm start
```

```
npm test          # 15 unit + 3 E2E (E2E auto-skips if the sidecar is down)
npm run typecheck
npm run flow:render   # prints the 2Flow topology + Mermaid + type report
```

Sample `npm start`:

```
AUDIT TRAIL (correlation cor_…)
  #001  actor.patient         openmental.intake.intake.submitted.event.v1
  #002  agent.triage          openmental.triage.triage.completed.event.v1
  #003  agent.matching        openmental.matching.match.professional-matched.event.v1
  #004  agent.queue           openmental.queue.queue-entry.position-assigned.event.v1
  #005  agent.scheduling      openmental.scheduling.consulta.scheduled.event.v1
  #006  agent.scheduling      openmental.scheduling.consulta-projection.updated.event.v1
  #007  agent.notification    openmental.notification.whatsapp.dispatched.event.v1
```

---

## The flow (declared once, as a graph)

```
ReceiveIntake
  :--: TriageComplaint
  :--: [?ClinicalReview]
  :--: [ ScoreAffinity :--: RankProfessional , ScreenClinicPolicy ]
  :--: AssignQueueSlot
  :--: ReserveConsultaSlot !-> ReleaseSlotHold
  :--: RecordConsulta
  :--: NotifyPatient
```

```
IntakeSubmission
   │
   ▼  ReceiveIntake        (transcreve áudio → texto; Audio.transcribe tool)
   ▼  TriageComplaint      IntakeSubmission ⟶ TriagedIntake   (Complaint.classify)
   ▼  [?ClinicalReview]    HITL gate — engajado só em crise; congela o fluxo,
   │                        pede aprovação humana via request/reply na bus
   ▼  ┌ fork ─────────────────────────────────────────────┐
   │  │ ramo 1: ScoreAffinity :--: RankProfessional        │  (afinidade + ranking)
   │  │ ramo 2: ScreenClinicPolicy                         │  (elegibilidade)
   │  └ join barrier ───────────────────────────────────────┘
   ▼  AssignQueueSlot      MatchedIntake ⟶ QueuedIntake   (fila justa por urgência)
   ▼  ReserveConsultaSlot  QueuedIntake ⟶ ScheduledConsulta (lock otimista + retry)
   │        └─ (falha !->) ─▶ ReleaseSlotHold              (saga: volta a QueuedIntake)
   ▼  RecordConsulta       projeção de consulta
   ▼  NotifyPatient        WhatsApp (Evolution API) — confirmação
ConfirmedConsulta
```

The compiler rejects a graph whose types don't chain, with a pedagogical box:

```
┌── 🛑 FALHA DE CONTRATO DE TIPAGEM NO PIPELINE ────────────────────────────┐
│  Fluxo inválido : ScoreAffinity :--: AssignQueueSlot
│    1. 'ScoreAffinity' emite o tipo:  👉 [ ScoredCandidateSet ]
│    2. 'AssignQueueSlot' espera consumir:  📥 [ MatchedIntake ]
│  💡 sequence: insira as etapas que transformam ScoredCandidateSet em MatchedIntake…
└──────────────────────────────────────────────────────────────────────┘
```

---

## Layout

```
config/                Everything-as-Code catalogs (money, ai-models, subjects,
                       clinical, scheduling, broker, identity, plans, projections,
                       semantic-types, integrations)
packages/Services/
  UbiQUIC/             the Zig NATS-protocol broker sidecar (own git repo)
src/
  kernel/              Result, branded ids, clock, logger
  messaging/           Envelope (causality+correlation), BrokerPort, UbiQuicNatsClient
  domain/              entities, typed event/command catalog (zod per subject), directory
  behaviors/           generic AtomicBehaviours — 1 dir + manifest each
  tools/               Tool = behaviour + bound config + invocation policy; catalog
  agents/              9 agents + the choreography runtime (actor mailboxes)
  orchestration/
    flow-dsl/          tokenizer · parser · graph · typecheck · render
    flows/             the consulta-scheduling flow (DSL string + node bindings)
    (orchestrator lives in src/agents/orchestrator-agent.ts)
  projections/         read-side helpers
  adapters/            in-memory KV/locks, fetch HTTP, bus request port
  app/                 bootstrap (composition root) + main
test/                  flow-dsl · behaviors · e2e
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the model in full.
