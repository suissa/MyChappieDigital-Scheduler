/**
 * AtomicBehaviour: Whatsapp.message.dispatch (generic outbound notifier).
 *
 * Generic single-transport message dispatcher. Bound by the Notification agent
 * to the WhatsApp/Evolution gateway from docs/prompts/00.md. When `live` is
 * false it simulates the send and still returns a receipt so the flow is
 * exercisable offline.
 */

import { z } from "zod";
import { defineBehavior } from "../../kind.js";
import { ok, err, domainError } from "../../../kernel/result.js";
import { SEMANTIC_TYPE } from "../../../../config/semantic-types.js";
import { BEHAVIOR, INVOCATION_POLICY, AGENT } from "../../../../config/identity.js";
import { SUBJECTS } from "../../../../config/subjects.js";
import { newId } from "../../../kernel/ids.js";

const configSchema = z.object({
  transport: z.literal("whatsapp"),
  live: z.boolean(),
  url: z.string().url(),
  defaultDelayMs: z.number().int().nonnegative(),
});
type Config = z.infer<typeof configSchema>;

const inputSchema = z.object({ to: z.string().min(8), text: z.string().min(1) });
type Input = z.infer<typeof inputSchema>;

const outputSchema = z.object({
  providerMessageId: z.string(),
  simulated: z.boolean(),
  transport: z.literal("whatsapp"),
});
type Output = z.infer<typeof outputSchema>;

export const dispatchNotification = defineBehavior<Config, Input, Output>({
  manifest: {
    apiVersion: "openmental/v1",
    kind: "AtomicBehavior",
    canonicalLabel: BEHAVIOR.dispatchWhatsapp,
    version: "1.0.0",
    types: { input: SEMANTIC_TYPE.outboundMessage, output: SEMANTIC_TYPE.deliveryReceipt },
    invocation: {
      policy: INVOCATION_POLICY.restricted,
      allowedAgents: [AGENT.notification],
      humanInTheLoop: false,
    },
    events: {
      listen: [SUBJECTS.whatsappDispatchRequested],
      emit: [SUBJECTS.whatsappDispatched],
    },
    execution: { state: "stateless", sandbox: true, idempotent: false },
  },
  configSchema,
  inputSchema,
  outputSchema,
  async execute(ctx, config, input) {
    if (!config.live) {
      return ok({
        providerMessageId: newId<"ProviderMessageId">("wamid"),
        simulated: true,
        transport: "whatsapp",
      });
    }
    const res = await ctx.http.postJson(config.url, {
      number: input.to,
      text: input.text,
      delay: config.defaultDelayMs,
    });
    if (res.status >= 400) {
      return err(
        domainError("WHATSAPP_SEND_FAILED", `gateway responded ${res.status}`, { body: res.json }),
      );
    }
    const body = res.json as { data?: { Info?: { ID?: string } } };
    return ok({
      providerMessageId: body.data?.Info?.ID ?? newId<"ProviderMessageId">("wamid"),
      simulated: false,
      transport: "whatsapp",
    });
  },
});
