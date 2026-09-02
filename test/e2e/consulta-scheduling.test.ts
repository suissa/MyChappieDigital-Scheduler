/**
 * End-to-end: the whole consulta-scheduling flow, choreographed over the live
 * UbiQUIC (QUICMQ) Zig sidecar. Start it first: `npm run sidecar` (WSL).
 *
 * If the sidecar is unreachable the suite skips rather than fails.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { bootstrap, type SchedulerSystem } from "../../src/app/bootstrap.js";
import { makeDemoDirectory, demoIntake, demoCrisisIntake } from "../../src/fixtures/demo.js";
import { fixedClock } from "../../src/kernel/clock.js";
import {
  readConsultaForPatient,
  readQueueForProfessional,
  readAffinity,
  readAuditTrail,
} from "../../src/projections/read.js";
import { UBIQUIC } from "../../config/broker.js";
import { SUBJECTS } from "../../config/subjects.js";
import { CONDITION } from "../../config/clinical.js";
import { PRICE_BOOK } from "../../config/money.js";

const canReachSidecar = (): Promise<boolean> =>
  new Promise((resolve) => {
    const sock = net.connect(UBIQUIC.port, UBIQUIC.host);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
    setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 1500);
  });

let sidecarUp = false;
before(async () => {
  sidecarUp = await canReachSidecar();
  if (!sidecarUp) {
    // eslint-disable-next-line no-console
    console.warn(`\n[e2e] UbiQUIC sidecar not reachable at ${UBIQUIC.serverUrl} — skipping E2E.\n`);
  }
});

const waitFor = async (p: () => Promise<boolean>, timeoutMs = 9000, step = 75): Promise<boolean> => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await p()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
};

const trailHas = (sys: SchedulerSystem, correlationId: string, subject: string) => async () => {
  const trail = (await readAuditTrail(sys.store, correlationId)) ?? [];
  return trail.some((e) => e.subject === subject);
};

const runSystem = async (
  opts: Parameters<typeof bootstrap>[0],
  body: (sys: SchedulerSystem) => Promise<void>,
): Promise<void> => {
  const sys = bootstrap({ logLevel: "error", ...opts });
  await sys.start();
  try {
    await body(sys);
  } finally {
    await sys.stop();
  }
};

test("happy path: intake → triage → match → queue → reserve → notify", { concurrency: 1 }, async (t) => {
  if (!sidecarUp) return t.skip();
  const clock = fixedClock("2026-09-02T09:00:00.000Z");

  await runSystem({ clock, directory: makeDemoDirectory(clock), reviewDesk: "external" }, async (sys) => {
    const intake = demoIntake(clock);
    const { correlationId } = await sys.submitIntake(intake);

    // Wait for the terminal fact of the flow.
    const finished = await waitFor(trailHas(sys, correlationId, SUBJECTS.whatsappDispatched));
    assert.equal(finished, true, "the flow should reach whatsappDispatched");

    const booked = (await readConsultaForPatient(sys.store, intake.patient.id)) !== undefined;
    assert.equal(booked, true, "a consulta should have been scheduled");

    const consulta = await readConsultaForPatient(sys.store, intake.patient.id);
    assert.ok(consulta);
    // pro_ANA has the strongest `ansiedade` affinity and a soon slot.
    assert.equal(consulta!.professionalId, "pro_ANA");
    assert.equal(consulta!.priceCentavos, PRICE_BOOK.consultaBase);

    const queue = await readQueueForProfessional(sys.store, "pro_ANA");
    assert.ok(queue && queue.size >= 1);

    const affinity = await readAffinity(sys.store, "pro_ANA", CONDITION.ansiedade);
    assert.ok(affinity, "the affinity projection should have been updated");

    // The audit agent witnesses events only (its pattern ends in `.event.v1`);
    // commands like `triageRequested` / `matchingRequested` are not on the trail.
    const trail = (await readAuditTrail(sys.store, correlationId)) ?? [];
    const subjects = trail.map((e) => e.subject);
    for (const expected of [
      SUBJECTS.intakeSubmitted,
      SUBJECTS.triageCompleted,
      SUBJECTS.professionalMatched,
      SUBJECTS.queuePositionAssigned,
      SUBJECTS.consultaScheduled,
      SUBJECTS.consultaProjectionUpdated,
      SUBJECTS.whatsappDispatched,
    ]) {
      assert.ok(subjects.includes(expected), `audit trail missing ${expected}`);
    }
    // The trail is causally ordered by arrival sequence.
    assert.deepEqual([...trail].map((e) => e.seq).sort((a, b) => a - b), trail.map((e) => e.seq));
  });
});

test("crisis path, review approved → still books, with the gate on the trail", { concurrency: 1 }, async (t) => {
  if (!sidecarUp) return t.skip();
  const clock = fixedClock("2026-09-02T09:00:00.000Z");

  await runSystem({ clock, directory: makeDemoDirectory(clock), reviewDesk: "auto-approve" }, async (sys) => {
    const intake = demoCrisisIntake(clock);
    const { correlationId } = await sys.submitIntake(intake);

    const finished = await waitFor(trailHas(sys, correlationId, SUBJECTS.whatsappDispatched));
    assert.equal(finished, true);
    assert.notEqual(
      await readConsultaForPatient(sys.store, intake.patient.id),
      undefined,
      "an approved crisis still books",
    );

    const trail = (await readAuditTrail(sys.store, correlationId)) ?? [];
    const subjects = trail.map((e) => e.subject);
    assert.ok(subjects.includes(SUBJECTS.crisisDetected), "crisis should be detected");
    assert.ok(subjects.includes(SUBJECTS.clinicalReviewResolved), "the HITL gate should resolve");
  });
});

test("crisis path, review rejected → no consulta, apology dispatched", { concurrency: 1 }, async (t) => {
  if (!sidecarUp) return t.skip();
  const clock = fixedClock("2026-09-02T09:00:00.000Z");

  await runSystem({ clock, directory: makeDemoDirectory(clock), reviewDesk: "auto-reject" }, async (sys) => {
    const intake = demoCrisisIntake(clock);
    const { correlationId } = await sys.submitIntake(intake);

    const apology = await waitFor(async () => {
      const trail = (await readAuditTrail(sys.store, correlationId)) ?? [];
      return trail.some((e) => e.subject === SUBJECTS.whatsappDispatched);
    });
    assert.equal(apology, true, "an apology message should be dispatched");

    const consulta = await readConsultaForPatient(sys.store, intake.patient.id);
    assert.equal(consulta, undefined, "no consulta on rejection");

    const trail = (await readAuditTrail(sys.store, correlationId)) ?? [];
    assert.ok(trail.map((e) => e.subject).includes(SUBJECTS.matchingFailed));
  });
});
