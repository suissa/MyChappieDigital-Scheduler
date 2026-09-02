/**
 * `npm start` — boot the agent society, submit a demo intake, follow it through
 * the choreography, print the resulting projections and audit trail.
 *
 * Requires the UbiQUIC sidecar: `npm run sidecar` (WSL).
 */

import { bootstrap } from "./bootstrap.js";
import { demoIntake } from "../fixtures/demo.js";
import {
  readConsultaForPatient,
  readQueueForProfessional,
  readAuditTrail,
  readSubjectCounters,
} from "../projections/read.js";
import { formatMoney, money } from "../../config/money.js";
import { SUBJECTS } from "../../config/subjects.js";

const waitFor = async (
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  stepMs = 100,
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
};

const main = async (): Promise<void> => {
  const sys = bootstrap({ logLevel: "info", reviewDesk: "auto-approve" });
  await sys.start();

  const intake = demoIntake(sys.clock);
  const { intakeId, correlationId } = await sys.submitIntake(intake);

  const done = await waitFor(async () => {
    const trail = (await readAuditTrail(sys.store, correlationId)) ?? [];
    return trail.some((e) => e.subject === SUBJECTS.whatsappDispatched);
  }, 8_000);

  process.stdout.write(`\n${"═".repeat(72)}\nRESULT  intake=${intakeId}  correlation=${correlationId}\n${"═".repeat(72)}\n`);

  const consulta = await readConsultaForPatient(sys.store, intake.patient.id);
  if (consulta) {
    process.stdout.write(
      `consulta agendada\n` +
        `  profissional : ${consulta.professionalId}\n` +
        `  quando       : ${consulta.scheduledFor}\n` +
        `  preço        : ${formatMoney(money(consulta.priceCentavos))}\n` +
        `  slot         : ${consulta.slotId}\n`,
    );
    const q = await readQueueForProfessional(sys.store, consulta.professionalId);
    if (q) process.stdout.write(`  fila (${consulta.professionalId}) : tamanho ${q.size}\n`);
  } else {
    process.stdout.write(`consulta NÃO agendada (timeout=${!done})\n`);
  }

  const trail = await readAuditTrail(sys.store, correlationId);
  process.stdout.write(`\nAUDIT TRAIL (correlation ${correlationId})\n`);
  for (const e of trail ?? []) {
    process.stdout.write(`  #${String(e.seq).padStart(3, "0")}  ${e.producer.padEnd(20)}  ${e.subject}\n`);
  }

  process.stdout.write(`\nSUBJECT COUNTERS\n`);
  for (const [subject, count] of await readSubjectCounters(sys.store)) {
    process.stdout.write(`  ${String(count).padStart(3)}  ${subject}\n`);
  }

  await sys.stop();
  process.exit(consulta ? 0 : 1);
};

main().catch((e) => {
  process.stderr.write(`fatal: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(2);
});
