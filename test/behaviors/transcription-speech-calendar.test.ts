import { test } from "node:test";
import assert from "node:assert/strict";
import { fixedClock } from "../../src/kernel/clock.js";
import { createLogger } from "../../src/kernel/logger.js";
import { MemoryStore } from "../../src/adapters/kv-memory.js";
import { offlineHttpPort } from "../../src/adapters/http-fetch.js";
import { offlineAiGateway } from "../../src/adapters/ai-gateway.js";
import type { BehaviorContext } from "../../src/behaviors/kind.js";
import { assemblePrompt } from "../../src/behaviors/actions/assemble-prompt/index.js";
import { llmComplete } from "../../src/behaviors/actions/llm-complete/index.js";
import { guardResponse } from "../../src/behaviors/actions/guard-response/index.js";
import { synthesizeSpeech } from "../../src/behaviors/actions/synthesize-speech/index.js";
import { mirrorCalendarEvent } from "../../src/behaviors/actions/mirror-calendar-event/index.js";
import { pollExternalCalendar } from "../../src/behaviors/actions/poll-external-calendar/index.js";
import { SCOPE_GUARD } from "../../config/transcription.js";
import { GOOGLE_CALENDAR } from "../../config/calendar.js";

const ctx = (): BehaviorContext => {
  const store = new MemoryStore();
  return {
    clock: fixedClock("2026-09-02T12:00:00.000Z"),
    logger: createLogger("error"),
    kv: store,
    locks: store,
    bus: { async ask() { throw new Error("no bus"); }, async emit() {} },
    http: offlineHttpPort,
    ai: offlineAiGateway,
    correlationId: "cor_test",
  };
};

test("assemble-prompt orders sections and skips optional empty ones", async () => {
  const res = await assemblePrompt.execute(
    ctx(),
    {
      sections: [
        { id: "role", heading: "PAPEL", body: "revisor" },
        { id: "raw", heading: "BRUTA", dynamic: true },
        { id: "prior", heading: "ANTERIORES", dynamic: true, optional: true },
      ],
      divider: "\n---\n",
      charsPerToken: 4,
    },
    { dynamic: { raw: "eu to com and ciencia" } },
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual(res.value.includedSections, ["role", "raw"]);
  assert.deepEqual(res.value.skippedSections, ["prior"]);
  assert.match(res.value.prompt, /## PAPEL[\s\S]*## BRUTA/);
});

test("assemble-prompt fails when a required dynamic section is missing", async () => {
  const res = await assemblePrompt.execute(
    ctx(),
    { sections: [{ id: "raw", heading: "BRUTA", dynamic: true }], divider: "\n", charsPerToken: 4 },
    { dynamic: {} },
  );
  assert.equal(res.ok, false);
});

test("llm-complete parses a fenced JSON offline completion", async () => {
  const res = await llmComplete.execute(
    ctx(),
    { modelId: "medgemma-1.5", temperature: 0, live: false, expectJson: true },
    { prompt: "x", offlineCompletion: '```json\n{"correctedText":"ok","confidence":0.9}\n```' },
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.value.parsedOk, true);
  assert.deepEqual(res.value.json, { correctedText: "ok", confidence: 0.9 });
  assert.equal(res.value.simulated, true);
});

test("guard-response accepts a faithful in-scope correction", async () => {
  const res = await guardResponse.execute(
    ctx(),
    { triggers: SCOPE_GUARD.triggers },
    {
      response: { correctedText: "eu estou com muita ansiedade", confidence: 0.9, unknowns: [] },
      sourceText: "eu estou com muita and ciencia",
      producedTextField: "correctedText",
      knownVocabulary: ["ansiedade"],
    },
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.value.inScope, true);
  assert.equal(res.value.violations.length, 0);
});

test("guard-response flags unknowns and produces a clarification question", async () => {
  const res = await guardResponse.execute(
    ctx(),
    { triggers: SCOPE_GUARD.triggers },
    {
      response: {
        correctedText: "o paciente citou zolpidex",
        confidence: 0.9,
        unknowns: [{ term: "zolpidex", why: "não está no glossário" }],
      },
      sourceText: "o paciente citou zolpidex",
      producedTextField: "correctedText",
      knownVocabulary: [],
    },
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.value.inScope, false);
  assert.ok(res.value.violations.some((v) => v.rule === "hasUnknowns"));
  assert.ok(res.value.question && res.value.question.includes("zolpidex"));
});

test("guard-response flags an over-edited correction", async () => {
  const res = await guardResponse.execute(
    ctx(),
    { triggers: SCOPE_GUARD.triggers },
    {
      response: { correctedText: "conteúdo completamente diferente do original aqui", confidence: 0.9 },
      sourceText: "oi",
      producedTextField: "correctedText",
      knownVocabulary: [],
    },
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.value.inScope, false);
  assert.ok(res.value.violations.some((v) => v.rule === "editRatioAbove"));
});

test("synthesize-speech respects the monthly credit budget", async () => {
  const cfg = {
    modelId: "eleven_multilingual_v2",
    live: false,
    voiceMode: "cloned" as const,
    defaultVoiceId: "libVoice",
    creditsPerCharacter: 1,
    monthlyCreditBudget: 20,
  };
  const okRes = await synthesizeSpeech.execute(ctx(), cfg, { text: "curto", language: "pt-BR", creditsUsedThisMonth: 0 });
  assert.equal(okRes.ok, true);
  const overRes = await synthesizeSpeech.execute(ctx(), cfg, {
    text: "um texto bem mais longo que estoura o orçamento",
    language: "pt-BR",
    creditsUsedThisMonth: 0,
  });
  assert.equal(overRes.ok, false);
});

test("mirror-calendar-event is idempotent by external key", async () => {
  const shared = ctx();
  const cfg = {
    provider: "google" as const,
    live: false,
    baseUrl: GOOGLE_CALENDAR.baseUrl,
    calendarId: "primary",
    tokenEnvVar: "X",
    timezone: "America/Sao_Paulo",
    systemTag: GOOGLE_CALENDAR.systemTag,
    correlationPropertyKey: "k",
    stateNamespace: "calendar-mirror",
  };
  const input = {
    externalKey: "con_1",
    action: "upsert" as const,
    summary: "Consulta",
    description: "x",
    startIso: "2026-09-03T10:00:00.000Z",
    endIso: "2026-09-03T10:50:00.000Z",
    attendees: [],
  };
  const first = await mirrorCalendarEvent.execute(shared, cfg, input);
  const again = await mirrorCalendarEvent.execute(shared, cfg, input);
  assert.equal(first.ok && first.value.action, "created");
  assert.equal(again.ok && again.value.action, "noop");
});

test("poll-external-calendar returns only events that are not ours", async () => {
  const cfg = {
    provider: "google" as const,
    live: false,
    baseUrl: GOOGLE_CALENDAR.baseUrl,
    calendarId: "primary",
    systemTag: GOOGLE_CALENDAR.systemTag,
    stateNamespace: "external-calendar",
  };
  const res = await pollExternalCalendar.execute(ctx(), cfg, {
    professionalId: "pro_ANA",
    offlineSnapshot: [
      { providerEventId: "e1", summary: "Almoço", startIso: "2026-09-03T15:00:00.000Z", endIso: "2026-09-03T16:00:00.000Z", description: "" },
      { providerEventId: "e2", summary: "Consulta", startIso: "2026-09-03T18:00:00.000Z", endIso: "2026-09-03T19:00:00.000Z", description: `${GOOGLE_CALENDAR.systemTag}\nconsulta: con_9` },
    ],
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.value.observed.length, 1);
  assert.equal(res.value.observed[0]!.providerEventId, "e1");
  assert.equal(res.value.ownEventsSkipped, 1);
});
