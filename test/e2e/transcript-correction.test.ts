/**
 * E2E: the local-Whisper + LLM-correction transcription pipeline, choreographed
 * over the live UbiQUIC sidecar. Skips if the sidecar is unreachable.
 */

import { test, before } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { bootstrap, type SchedulerSystem } from "../../src/app/bootstrap.js";
import { fixedClock } from "../../src/kernel/clock.js";
import { readTranscript, readClarification, readAuditTrail } from "../../src/projections/read.js";
import { UBIQUIC } from "../../config/broker.js";
import { SUBJECTS } from "../../config/subjects.js";
import { ID } from "../../src/kernel/ids.js";

const reachable = (): Promise<boolean> =>
  new Promise((resolve) => {
    const s = net.connect(UBIQUIC.port, UBIQUIC.host);
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
    setTimeout(() => (s.destroy(), resolve(false)), 1500);
  });

let up = false;
before(async () => {
  up = await reachable();
  if (!up) console.warn(`\n[e2e] sidecar down at ${UBIQUIC.serverUrl} — skipping.\n`);
});

const waitFor = async (p: () => Promise<boolean>, ms = 14000, step = 75): Promise<boolean> => {
  const end = Date.now() + ms;
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

const run = async (opts: Parameters<typeof bootstrap>[0], body: (s: SchedulerSystem) => Promise<void>) => {
  const sys = bootstrap({ logLevel: "error", ...opts });
  await sys.start();
  try {
    await body(sys);
  } finally {
    await sys.stop();
  }
};

const RAW = "eu to com muita and ciencia e as vezes tenho crise de pa nico no trabalho";

test("in-scope: whisper draft is corrected and finalized", { concurrency: 1 }, async (t) => {
  if (!up) return t.skip();
  const clock = fixedClock("2026-09-02T09:00:00.000Z");
  await run({ clock, reviewDesk: "external" }, async (sys) => {
    const transcriptId = ID.review().replace("rev_", "trs_");
    const audioRef = `mem://audio/${transcriptId}.ogg`;
    const correction = JSON.stringify({
      correctedText: "eu tô com muita ansiedade e às vezes tenho crise de pânico no trabalho",
      corrections: [
        { from: "and ciencia", to: "ansiedade", reason: "ASR" },
        { from: "pa nico", to: "pânico", reason: "ASR" },
      ],
      uncertainSpans: [],
      unknowns: [],
      confidence: 0.9,
    });

    const { correlationId } = await sys.emit(SUBJECTS.transcriptionRequested, {
      transcriptId,
      audioRef,
      durationSeconds: 40,
      language: "pt",
      tier: "primary",
      offlineRaw: RAW,
      offlineCorrection: correction,
      context: {
        patientName: "Maria",
        dominantCondition: "ansiedade",
        priorTranscripts: [],
        professionalNames: ["Dra. Ana Prado"],
      },
    });

    const done = await waitFor(trailHas(sys, correlationId, SUBJECTS.transcriptFinalized));
    assert.equal(done, true, "the transcript should be finalized");

    const doc = await readTranscript(sys.store, audioRef);
    assert.ok(doc);
    assert.equal(doc!.inScope, true);
    assert.match(doc!.correctedText, /ansiedade/);
    assert.match(doc!.correctedText, /pânico/);
    assert.equal(doc!.rawText, RAW);
    assert.equal(doc!.corrections.length, 2);
  });
});

test("out-of-scope: an unknown term raises a clarification and keeps the raw", { concurrency: 1 }, async (t) => {
  if (!up) return t.skip();
  const clock = fixedClock("2026-09-02T09:00:00.000Z");
  await run({ clock, reviewDesk: "auto-reject" }, async (sys) => {
    const transcriptId = ID.review().replace("rev_", "trs_");
    const audioRef = `mem://audio/${transcriptId}.ogg`;
    const correction = JSON.stringify({
      correctedText: `${RAW} e mencionou zolpidex`,
      corrections: [],
      uncertainSpans: [],
      unknowns: [{ term: "zolpidex", why: "não está no glossário clínico" }],
      confidence: 0.9,
    });

    const { correlationId } = await sys.emit(SUBJECTS.transcriptionRequested, {
      transcriptId,
      audioRef,
      durationSeconds: 40,
      language: "pt",
      tier: "primary",
      offlineRaw: RAW,
      offlineCorrection: correction,
      context: { priorTranscripts: [], professionalNames: [] },
    });

    const done = await waitFor(trailHas(sys, correlationId, SUBJECTS.transcriptFinalized));
    assert.equal(done, true);

    const doc = await readTranscript(sys.store, audioRef);
    assert.ok(doc);
    assert.equal(doc!.inScope, false);
    assert.ok(doc!.clarificationId, "a clarification id should be recorded");
    // auto-reject desk => keep the raw text
    assert.equal(doc!.correctedText, RAW);

    const clar = await readClarification(sys.store, doc!.clarificationId!);
    assert.ok(clar);

    const trail = (await readAuditTrail(sys.store, correlationId)) ?? [];
    const subs = trail.map((e) => e.subject);
    assert.ok(subs.includes(SUBJECTS.transcriptDrafted));
    assert.ok(subs.includes(SUBJECTS.clarificationResolved));
    assert.ok(subs.includes(SUBJECTS.transcriptFinalized));
  });
});
