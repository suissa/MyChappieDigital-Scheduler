/**
 * Read-side helpers over the projections the agents write.
 *
 * Projections are derived views (AGENTS.md §17): they answer questions, they are
 * not the source of truth. `recordProjection` stores each document as
 * `{ version, document }` under `projection:<name>`.
 */

import type { MemoryStore } from "../adapters/kv-memory.js";
import { PROJECTION } from "../../config/projections.js";
import { AUDIT_NS, type AuditEntry } from "../agents/audit-agent.js";

interface Versioned<T> {
  version: number;
  document: T;
}

const doc = async <T>(store: MemoryStore, name: string, key: string): Promise<T | undefined> =>
  (await store.get<Versioned<T>>(`projection:${name}`, key))?.document;

export interface ConsultaView {
  consultaId: string;
  intakeId: string;
  professionalId: string;
  scheduledFor: string;
  priceCentavos: number;
  slotId: string;
}

export interface QueueView {
  professionalId: string;
  size: number;
  lastPatientId: string;
  updatedAt: string;
}

export interface AffinityView {
  professionalId: string;
  condition: string;
  affinity: number;
  lastMatchScore: number;
}

export const readConsultaForPatient = (store: MemoryStore, patientId: string) =>
  doc<ConsultaView>(store, PROJECTION.consulta, patientId);

export const readQueueForProfessional = (store: MemoryStore, professionalId: string) =>
  doc<QueueView>(store, PROJECTION.queue, professionalId);

export const readAffinity = (store: MemoryStore, professionalId: string, condition: string) =>
  doc<AffinityView>(store, PROJECTION.affinity, `${professionalId}:${condition}`);

export const readAuditTrail = (store: MemoryStore, correlationId: string) =>
  store.get<AuditEntry[]>(AUDIT_NS.trail, correlationId);

export const readSubjectCounters = async (
  store: MemoryStore,
): Promise<ReadonlyArray<readonly [string, number]>> =>
  (await store.list<number>(AUDIT_NS.counters)).slice().sort((a, b) => a[0].localeCompare(b[0]));
