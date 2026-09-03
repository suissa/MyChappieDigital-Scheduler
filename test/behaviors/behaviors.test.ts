import { test } from "node:test";
import assert from "node:assert/strict";
import { fixedClock } from "../../src/kernel/clock.js";
import { createLogger } from "../../src/kernel/logger.js";
import { MemoryStore } from "../../src/adapters/kv-memory.js";
import { offlineHttpPort } from "../../src/adapters/http-fetch.js";
import { offlineAiGateway } from "../../src/adapters/ai-gateway.js";
import type { BehaviorContext } from "../../src/behaviors/kind.js";
import { classifyText } from "../../src/behaviors/actions/classify-text/index.js";
import { scoreWeighted } from "../../src/behaviors/actions/score-weighted/index.js";
import { reserveResource } from "../../src/behaviors/actions/reserve-resource/index.js";
import { Tool } from "../../src/tools/tool.js";
import { AGENT } from "../../config/identity.js";
import { CONDITION_LEXICON, CRISIS_LEXICON, CONDITION } from "../../config/clinical.js";

const ctx = (): BehaviorContext => {
  const store = new MemoryStore();
  return {
    clock: fixedClock("2026-09-02T12:00:00.000Z"),
    logger: createLogger("error"),
    kv: store,
    locks: store,
    bus: { async ask() { throw new Error("no bus in unit test"); }, async emit() {} },
    http: offlineHttpPort,
    ai: offlineAiGateway,
    correlationId: "cor_test",
  };
};

test("classify-text maps a lexicon and flags escalation", async () => {
  const res = await classifyText.execute(
    ctx(),
    {
      lexicon: Object.fromEntries(
        Object.entries(CONDITION_LEXICON).map(([k, v]) => [k, [...v]]),
      ),
      fallbackLabel: CONDITION.desconhecido,
      escalation: { phrases: [...CRISIS_LEXICON], label: "crise" },
      severity: { priority: ["urgente"], elevated: ["piorando"] },
    },
    { text: "tenho muita ansiedade e as vezes penso em me machucar, esta urgente" },
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.value.escalated, true);
  assert.ok(res.value.labels.includes(CONDITION.ansiedade));
  assert.ok(res.value.severityLabels.includes("priority"));
});

test("score-weighted respects weights and penalties", async () => {
  const res = await scoreWeighted.execute(
    ctx(),
    {
      weightsBps: { affinity: 6000, availability: 4000 },
      penaltyBps: { workload: 1000 },
      totalBps: 10000,
    },
    {
      candidates: [
        { id: "hi", features: { affinity: 1, availability: 1 }, penaltyCounts: {} },
        { id: "lo", features: { affinity: 0.2, availability: 0.3 }, penaltyCounts: { workload: 3 } },
      ],
    },
  );
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.value.scored[0]!.id, "hi");
  assert.ok(res.value.scored[0]!.score > res.value.scored[1]!.score);
});

test("reserve-resource is exclusive under contention", async () => {
  const shared = ctx();
  const cfg = { poolNamespace: "slot-pool", holdSeconds: 60, maxAttempts: 1, retryDelayMs: 0 };
  const input = { poolId: "proX", candidateKeys: ["s1"], holderRef: "a" };
  const first = await reserveResource.execute(shared, cfg, input);
  const second = await reserveResource.execute(shared, cfg, { ...input, holderRef: "b" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
});

test("a restricted Tool refuses an unauthorised invoker", async () => {
  const tool = new Tool({
    name: "t",
    owner: AGENT.matching,
    behavior: scoreWeighted,
    config: { weightsBps: { a: 10000 }, penaltyBps: {}, totalBps: 10000 },
  });
  const denied = await tool.invoke(ctx(), { candidates: [] }, AGENT.notification);
  assert.equal(denied.ok, false);
  if (denied.ok) return;
  assert.equal(denied.error.code, "INVOCATION_DENIED");

  const allowed = await tool.invoke(ctx(), { candidates: [] }, AGENT.matching);
  assert.equal(allowed.ok, true);
});
