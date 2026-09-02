/**
 * External integration endpoints as code.
 *
 * The WhatsApp gateway is the local Evolution API instance from
 * docs/prompts/00.md ("POST http://localhost:8008/send/text"). In the vertical
 * slice the notification behaviour runs against an in-process fake unless
 * `live` is turned on here.
 */

export const WHATSAPP = Object.freeze({
  live: false,
  baseUrl: "http://localhost:8008",
  sendTextPath: "/send/text",
  method: "POST",
  contentType: "application/json",
  defaultDelayMs: 0,
  get sendTextUrl(): string {
    return this.baseUrl + this.sendTextPath;
  },
} as const);

export const GROQ = Object.freeze({
  live: false,
  baseUrl: "https://api.groq.com/openai/v1",
  transcriptionPath: "/audio/transcriptions",
  docsUrl: "https://console.groq.com/docs/models",
} as const);

/** Message templates as code — no user-facing copy inline in behaviours. */
export const MESSAGE_TEMPLATE = Object.freeze({
  consultaScheduled: (args: { professionalName: string; whenIso: string; position: number }): string =>
    `Sua consulta foi agendada com ${args.professionalName} para ${args.whenIso}. ` +
    `Posição na fila de atendimento: ${args.position}.`,
  clinicalReviewPending: (): string =>
    "Recebemos seu pedido. Um profissional da nossa equipe vai revisar seu caso com prioridade e " +
    "entrar em contato em instantes.",
  matchingFailed: (): string =>
    "Ainda não encontramos um profissional disponível para o seu caso. Você entrou na lista e " +
    "avisaremos assim que houver uma vaga.",
} as const);
