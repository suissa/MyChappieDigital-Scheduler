/**
 * Google Calendar connector as code — **mirror only, never rendered**.
 *
 * The system never shows a calendar UI. Google Calendar is purely a two-way
 * mirror:
 *   outbound — every consulta the system schedules is written as a calendar
 *              event (create / update / delete), keyed by our consultaId.
 *   inbound  — events the professional adds directly in Google Calendar are
 *              observed and mirrored back in as `externalCalendarEventObserved`,
 *              which the scheduling side treats as a busy block.
 *
 * Auth material is never a literal here — `tokenEnvVar` names the environment
 * variable the runtime injects (build the code now, wire real OAuth later).
 */

export const CALENDAR_PROVIDER = Object.freeze({ google: "google" } as const);
export type CalendarProvider = (typeof CALENDAR_PROVIDER)[keyof typeof CALENDAR_PROVIDER];

export const GOOGLE_CALENDAR = Object.freeze({
  provider: CALENDAR_PROVIDER.google,
  /** Off by default — nothing calls Google until this is turned on. */
  live: false,
  baseUrl: "https://www.googleapis.com/calendar/v3",
  /** Which calendar to mirror into. "primary" = the professional's default. */
  calendarId: "primary",
  /** The runtime reads the access token from this env var; the token itself is
   *  never stored in code or in the repo. */
  tokenEnvVar: "GOOGLE_CALENDAR_ACCESS_TOKEN",
  timezone: "America/Sao_Paulo",
  /** Marker on every event we own, so inbound sync can tell ours from theirs. */
  systemTag: "mychappie:consulta",
  /** How the mirror behaves. */
  direction: { outbound: true, inbound: true } as const,
  /** Inbound poll cadence (used by the scheduled trigger, not a hot loop). */
  inboundPollSeconds: 300,
  /** Extended-property key that carries our consultaId on mirrored events. */
  correlationPropertyKey: "mychappieConsultaId",
} as const);

/** How an outbound consulta maps to a calendar event. */
export const EVENT_TEMPLATE = Object.freeze({
  summary: (args: { patientName: string }): string => `Consulta — ${args.patientName}`,
  description: (args: { consultaId: string; condition: string; priceFormatted: string }): string =>
    [
      `${GOOGLE_CALENDAR.systemTag}`,
      `consulta: ${args.consultaId}`,
      `foco: ${args.condition}`,
      `valor: ${args.priceFormatted}`,
      "Espelho automático — não editar por aqui.",
    ].join("\n"),
  /** Consulta duration comes from scheduling config; declared there. */
} as const);

/** An inbound event that carries our tag is one of ours coming back — ignore it. */
export const isOwnEvent = (description: string | undefined): boolean =>
  (description ?? "").includes(GOOGLE_CALENDAR.systemTag);
