#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';
import { verifyIzhgmuMedicine6PostsemesterReview } from '../src/adapters/izhgmu/postsemester-reviewed.mjs';
import {
  buildIzhgmuMedicine6PostsemesterCandidate,
  buildIzhgmuMedicine6PostsemesterQaBatch,
} from '../src/adapters/izhgmu/postsemester-canonical.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function findFile(root, filename) {
  const candidates = [path.join(root, filename), path.join(root, 'postsemester', filename)];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`IzhGMU post-semester PDF not found: ${filename}`);
  return found;
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-postsemester'));
const attestationBuffer = fs.readFileSync(findFile(inputDir, 'medicine6-intermediate-attestation-2026.pdf'));
const giaBuffer = fs.readFileSync(findFile(inputDir, 'medicine6-gia-2026.pdf'));
const verified = verifyIzhgmuMedicine6PostsemesterReview({
  intermediateAttestationBuffer: attestationBuffer,
  giaBuffer,
});

let eventCounter = 0;
function prepared(group) {
  return prepareSchedulePublication(buildIzhgmuMedicine6PostsemesterQaBatch({ group, review: verified.review }), {
    now: '2026-08-16T00:00:00Z',
    eventIdFactory: () => `evt_izh_ps_${group}_${String(++eventCounter).padStart(3, '0')}`,
    versionIdFactory: () => `ver_izh_ps_${group}`,
  });
}

const summaries = [];
for (const group of ['601', '626']) {
  const candidate = buildIzhgmuMedicine6PostsemesterCandidate({ group, review: verified.review });
  const publication = prepared(group);
  if (!publication.inputQa.publishable || !publication.outputQa.publishable) {
    throw new Error(`Safe IzhGMU post-semester candidate failed shared QA for group ${group}`);
  }
  summaries.push({
    group,
    safeEvents: candidate.events.map((event) => ({
      title: event.lesson.discipline.normalized,
      date: event.timing.date,
      startTime: event.timing.start_time,
      endTime: event.timing.end_time,
      allDay: event.timing.all_day,
      sourceFile: event.source.file_name,
    })),
    deferredFacts: candidate.deferredFacts.map((fact) => ({
      kind: fact.kind,
      date: fact.date,
      startTime: fact.startTime,
      endTime: fact.endTime,
      warning: fact.warning,
    })),
    blockers: candidate.blockers.map((blocker) => ({
      component: blocker.component,
      warning: blocker.warning,
      date: blocker.date || null,
    })),
    inputQa: publication.inputQa.publishable,
    outputQa: publication.outputQa.publishable,
    productionPublishable: candidate.publishable,
  });
}

console.log('IZHGMU_POSTSEMESTER_CANONICAL', JSON.stringify({
  sourceHashes: verified.observedHashes,
  groups: summaries,
  invariant: 'safe_events_only; state_exam_start_without_end_is_deferred; missing_group_dates_are_never_inferred',
}));
