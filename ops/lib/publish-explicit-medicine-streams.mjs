#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildExplicitPublicationPlan } from '../../src/explicit-publication-plan.js';
import { canonicalJson } from '../../src/explicit-decisions.js';
import { toCorePublicationQa } from '../../src/medicine-publication-plan.js';
import { applyMedicinePublicationPlan } from './publish-medicine-plan.mjs';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), 'utf8'));
}

async function loadStream(stream) {
  const [manifest, source, evidence, qa] = await Promise.all([
    readJson(`fixtures/2026-2027-semester-1/medicine-${stream}.decisions.json`),
    readJson(`fixtures/2026-2027-semester-1/medicine-${stream}.source.json`),
    readJson(`qa/2026-2027-semester-1/medicine-${stream}.evidence.json`),
    readJson(`qa/2026-2027-semester-1/medicine-${stream}.qa-report.json`)
  ]);
  return { stream, plan: buildExplicitPublicationPlan({ manifest, source, evidence, qa }), qa };
}

async function verifyStreamPublishedIcs({
  published,
  version,
  unfoldIcs,
  countVevents,
  renderPublishedScheduleIcs,
  calendarName
}) {
  const ics = unfoldIcs(renderPublishedScheduleIcs({
    scheduleVersion: published.scheduleVersion,
    events: published.events,
    calendarName
  }));
  if (countVevents(ics) !== version.eventCount) {
    throw new Error(`group ${version.groupId} ICS VEVENT count verification failed`);
  }
  if (published.events.some((event) => event.assessment) && !ics.includes('DESCRIPTION:')) {
    throw new Error(`group ${version.groupId} assessment metadata is missing from rendered ICS`);
  }
  if (published.events.some((event) => event.lessonType === 'lecture') && !ics.includes('ЛЕКЦ.')) {
    throw new Error(`group ${version.groupId} lecture display prefix is missing from rendered ICS`);
  }
}

export async function runExplicitMedicineStreamsPublication({ streams, evidenceScopeLabel }) {
  if (!Array.isArray(streams) || streams.length === 0) throw new Error('streams must be a non-empty array');
  if (typeof evidenceScopeLabel !== 'string' || evidenceScopeLabel.length === 0) {
    throw new Error('evidenceScopeLabel is required');
  }

  const apply = process.argv.includes('--apply');
  const unknownArgs = process.argv.slice(2).filter((arg) => !['--apply', '--preflight'].includes(arg));
  if (unknownArgs.length > 0) throw new Error(`unsupported arguments: ${unknownArgs.join(', ')}`);

  const loaded = await Promise.all(streams.map(loadStream));
  const plans = loaded.map(({ plan }) => plan);
  const totalEvents = plans.reduce((sum, plan) => sum + plan.events.length, 0);
  const versions = plans.flatMap((plan) => plan.versions);

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'preflight',
    universityId: 'kirov-gmu',
    academicYearId: '2026-2027',
    academicPeriodId: '2026-2027-semester-1',
    streams: loaded.map(({ stream, plan }) => ({
      stream,
      sourceSha256: plan.sourceSha256,
      candidateDigest: plan.candidateDigest,
      eventCount: plan.events.length,
      versions: plan.versions
    })),
    groupCount: versions.length,
    eventCount: totalEvents
  }, null, 2));

  if (!apply) {
    console.log('PREFLIGHT_OK_NO_DATABASE_CHANGES');
    return;
  }

  const evidenceFingerprints = loaded.map(({ plan }) => canonicalJson(plan.coreEvidence));
  if (new Set(evidenceFingerprints).size !== 1) {
    throw new Error(`${evidenceScopeLabel} streams disagree on shared core evidence`);
  }

  let coreBoundary = null;
  for (const { plan, qa } of loaded) {
    const applied = await applyMedicinePublicationPlan({
      plan,
      qaForPublication: toCorePublicationQa(qa),
      coreEvidence: plan.coreEvidence,
      verifyPublishedIcs: verifyStreamPublishedIcs,
      standardResultFields: {},
      emitResult: false
    });
    if (coreBoundary == null) coreBoundary = applied.coreBoundary;
  }

  console.log(JSON.stringify({
    result: 'PRODUCTION_SCHEDULES_PUBLISHED_AND_VERIFIED',
    coreBoundary,
    groupCount: versions.length,
    eventCount: totalEvents,
    trialChanged: false,
    checkoutChanged: false
  }, null, 2));
}
