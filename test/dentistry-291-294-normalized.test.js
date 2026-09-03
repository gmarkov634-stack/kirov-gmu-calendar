import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { digestNormalizedEvents } from '../src/explicit-decisions.js';

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

const sourcePath = 'fixtures/2026-2027-semester-1/dentistry-291-294.source.json';
const jobPath = 'fixtures/2026-2027-semester-1/dentistry-291-294.parsing-job.json';
const draftPath = 'qa/2026-2027-semester-1/dentistry-291-294.normalized-draft.json';
const qaPath = 'qa/2026-2027-semester-1/dentistry-291-294.qa-report.json';
const evidencePath = 'qa/2026-2027-semester-1/dentistry-291-294.evidence.json';

test('dentistry 291-294 normalized draft is source-bound, complete and QA-passed', async () => {
  const [source, job, draft, qa, evidence] = await Promise.all([
    readJson(sourcePath), readJson(jobPath), readJson(draftPath), readJson(qaPath), readJson(evidencePath)
  ]);

  assert.equal(source.source.sha256, 'ec51c194d2f91d33230da4d93d8bad1dfe885d70ec4bd0e2eec959071b4ff610');
  assert.equal(source.source.objectKey, job.sourceObjectKey);
  assert.equal(source.idempotency.sourceArtifactKey, `sha256:${source.source.sha256}`);
  assert.equal(source.idempotency.reuseIfShaMatches, true);
  assert.equal(draft.schema, 'kgmu-normalized-draft-v1');
  assert.equal(draft.status, 'PASS');
  assert.equal(draft.sourceArtifactId, source.source.sourceArtifactId);
  assert.equal(draft.parsingJobId, job.jobId);
  assert.equal(draft.sourceSha256, source.source.sha256);
  assert.equal(draft.parserProfile, 'mixed');
  assert.equal(draft.parserRulesVersion, source.parserRulesVersion);
  assert.deepEqual(draft.expectedGroupIds, ['291', '292', '293', '294']);
  assert.equal(draft.eventCount, 1066);
  assert.deepEqual(draft.groupEventCounts, { '291': 265, '292': 266, '293': 266, '294': 269 });
  assert.equal(draft.events.length, draft.eventCount);
  assert.equal(digestNormalizedEvents(draft.events), draft.candidateDigest);
  assert.equal(qa.candidateDigest, draft.candidateDigest);
  assert.equal(qa.decision, 'pass');
  assert.ok(Array.isArray(qa.checks));
  assert.equal(qa.checks.some((item) => item.status === 'fail'), false);
  assert.equal(qa.checks.some((item) => item.code === 'shared-core-boundary' && item.status === 'pass'), true);
  assert.equal(qa.checks.some((item) => item.code === 'publication-scope' && item.status === 'pass'), true);

  const ids = new Set();
  const signatures = new Set();
  let assessmentEvents = 0;
  let propedeuticEvents = 0;
  for (const event of draft.events) {
    assert.equal(event.universityId, 'kirov-gmu');
    assert.ok(draft.expectedGroupIds.includes(event.groupId));
    assert.equal(event.academicPeriodId, '2026-2027-semester-1');
    assert.equal(event.timeSemantics, 'floating');
    assert.match(event.date, /^202[67]-\d{2}-\d{2}$/);
    assert.match(event.startTime, /^(?:[01]\d|2[0-3]):[0-5]\d$/);
    assert.match(event.endTime, /^(?:[01]\d|2[0-3]):[0-5]\d$/);
    assert.equal(event.teacher, null);
    assert.equal(event.sourceRef.sourceId, 'dentistry');
    assert.match(event.sourceRef.locator, /^2 стомат\.!/);
    assert.equal(ids.has(event.eventId), false, `duplicate eventId ${event.eventId}`);
    ids.add(event.eventId);
    const signature = JSON.stringify([
      event.groupId, event.date, event.startTime, event.endTime,
      event.discipline, event.lessonType, event.location
    ]);
    assert.equal(signatures.has(signature), false, `duplicate logical event ${signature}`);
    signatures.add(signature);
    if (event.assessment) assessmentEvents += 1;
    if (event.discipline === 'Пропедевтическая стоматология') {
      propedeuticEvents += 1;
      assert.equal(event.location, 'Консультативно-диагностическое отделение клиники Кировского ГМУ, ул. Никитская, 161');
    }
  }
  assert.equal(ids.size, draft.eventCount);
  assert.ok(assessmentEvents > 0);
  assert.equal(assessmentEvents, evidence.finalNormalizedDraft.assessmentEventCount);
  assert.ok(propedeuticEvents > 0);
  assert.equal(evidence.finalNormalizedDraft.normalizedEventV1Compatible, true);
  assert.ok(Number.isInteger(evidence.timeOverlapAudit.overlapCount));
  assert.equal(evidence.timeOverlapAudit.overlaps.length, evidence.timeOverlapAudit.overlapCount);
  assert.equal(evidence.scheduleCoverage.unmatched.length, 0);
  assert.equal(evidence.qaResolution.unresolvedCountNotes, 0);
});
