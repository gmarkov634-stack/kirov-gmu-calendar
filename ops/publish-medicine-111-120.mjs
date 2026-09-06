#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildMedicinePublicationPlan,
  toCorePublicationQa
} from '../src/medicine-publication-plan.js';
import { applyMedicinePublicationPlan } from './lib/publish-medicine-plan.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPLY = process.argv.includes('--apply');
const UNKNOWN_ARGS = process.argv.slice(2).filter((arg) => !['--apply', '--preflight'].includes(arg));
if (UNKNOWN_ARGS.length > 0) throw new Error(`unsupported arguments: ${UNKNOWN_ARGS.join(', ')}`);

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), 'utf8'));
}

async function loadPlan() {
  const [manifest, facultatives, source, evidence, qa] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/medicine-111-120.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-111-120.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/medicine-111-120.source.json'),
    readJson('qa/2026-2027-semester-1/medicine-111-120.evidence.json'),
    readJson('qa/2026-2027-semester-1/medicine-111-120.qa-report.json')
  ]);
  return { plan: buildMedicinePublicationPlan({ manifest, facultatives, source, evidence, qa }), qa };
}

function verifyMedicine111120Ics({
  renderPublishedScheduleIcs,
  scheduleVersion,
  events,
  version,
  calendarName,
  unfoldIcs,
  countVevents
}) {
  const defaultVisibleEvents = events.filter((event) => event.facultativeId == null);
  const defaultIcs = unfoldIcs(renderPublishedScheduleIcs({
    scheduleVersion,
    events,
    calendarName
  }));
  if (countVevents(defaultIcs) !== defaultVisibleEvents.length) {
    throw new Error(`group ${version.groupId} default-off ICS VEVENT count verification failed`);
  }

  const allFacultativeChoices = Object.fromEntries(
    events
      .filter((event) => event.facultativeId != null)
      .map((event) => [event.facultativeId, true])
  );
  const allFacultativesIcs = unfoldIcs(renderPublishedScheduleIcs({
    scheduleVersion,
    events,
    calendarName,
    preferences: { facultativeChoices: allFacultativeChoices }
  }));
  if (countVevents(allFacultativesIcs) !== version.eventCount) {
    throw new Error(`group ${version.groupId} all-facultatives ICS VEVENT count verification failed`);
  }

  if (defaultVisibleEvents.some((event) => event.assessment) && !defaultIcs.includes('DESCRIPTION:')) {
    throw new Error(`group ${version.groupId} assessment metadata is missing from default rendered ICS`);
  }
  if (
    defaultVisibleEvents.some((event) => event.lessonType === 'graded-credit')
    && !defaultIcs.includes('ЗАЧЕТ С ОЦЕНКОЙ')
  ) {
    throw new Error(`group ${version.groupId} graded-credit summary is missing from default rendered ICS`);
  }
}

const { plan, qa } = await loadPlan();

console.log(JSON.stringify({
  mode: APPLY ? 'apply' : 'preflight',
  universityId: plan.universityId,
  academicYearId: plan.academicYearId,
  academicPeriodId: plan.academicPeriodId,
  sourceSha256: plan.sourceSha256,
  candidateDigest: plan.candidateDigest,
  eventCount: plan.events.length,
  versions: plan.versions
}, null, 2));

if (!APPLY) {
  console.log('PREFLIGHT_OK_NO_DATABASE_CHANGES');
} else {
  await applyMedicinePublicationPlan({
    plan,
    qaForPublication: toCorePublicationQa(qa),
    coreEvidence: plan.coreEvidence,
    verifyPublishedIcs: verifyMedicine111120Ics,
    resultFields: { previousVersionsPreserved: false }
  });
}
