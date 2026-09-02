/**
 * Audit agent — cross-cutting observability (AGENTS.md §27).
 *
 * Subscribes to every event on UbiQUIC and keeps a correlation-indexed trail
 * plus per-subject counters. It never emits — it only witnesses. (The broker
 * itself also event-sources every publish to `.qmes`; this is the read side.)
 */

import { defineAgent } from "./agent.js";
import { AGENT, CONTEXT_LABEL } from "../../config/identity.js";
import { CONSUMER_GROUP } from "../../config/broker.js";
import { PATTERNS } from "../../config/subjects.js";

export const AUDIT_NS = Object.freeze({
  counters: "audit:counters",
  trail: "audit:trail",
  order: "audit:order",
} as const);

export interface AuditEntry {
  readonly seq: number;
  readonly subject: string;
  readonly producer: string;
  readonly correlationId: string;
  readonly at: string;
}

export const auditAgent = defineAgent({
  label: AGENT.audit,
  context: CONTEXT_LABEL.audit,
  tools: [],
  subscriptions: [
    {
      subject: PATTERNS.allEvents,
      queueGroup: CONSUMER_GROUP.audit,
      async handle(_payload, ctx) {
        const subject = ctx.incomingSubject;

        const count = ((await ctx.kv.get<number>(AUDIT_NS.counters, subject)) ?? 0) + 1;
        await ctx.kv.put(AUDIT_NS.counters, subject, count);

        const seq = ((await ctx.kv.get<number>(AUDIT_NS.order, "seq")) ?? 0) + 1;
        await ctx.kv.put(AUDIT_NS.order, "seq", seq);

        const trail = (await ctx.kv.get<AuditEntry[]>(AUDIT_NS.trail, ctx.correlationId)) ?? [];
        trail.push({
          seq,
          subject,
          producer: ctx.incomingProducer,
          correlationId: ctx.correlationId,
          at: ctx.clock.nowIso(),
        });
        await ctx.kv.put(AUDIT_NS.trail, ctx.correlationId, trail);

        ctx.logger.debug("witnessed", { seq, subject, producer: ctx.incomingProducer });
      },
    },
  ],
});
