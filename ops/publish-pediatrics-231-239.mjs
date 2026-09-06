#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildExplicitPublicationPlan } from '../src/explicit-publication-plan.js';
import { toCorePublicationQa } from '../src/pediatrics-publication-plan.js';
import { runPediatricsPublication } from './lib/publish-pediatrics-course.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPLY = process.argv.includes('--apply');
const UNKNOWN_ARGS = process.argv.slice(2).filter((arg) => !['--apply', '--preflight'].includes(arg));
if (UNKNOWN_ARGS.length > 0) throw new Error(`unsupported arguments: ${UNKNOWN_ARGS.join(', ')}`);

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), 'utf8'));
}

async function loadPlan() {
  const [manifest, source, evidence, qa] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-231-239.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/pediatrics-231-239.source.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-231-239.evidence.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-231-239.qa-report.json')
  ]);
  return { plan: buildExplicitPublicationPlan({ manifest, source, evidence, qa }), qa };
}

function verifyCourse2Ics({ core, published, version, unfoldIcs, countVevents }) {
  const ics = unfoldIcs(core.renderPublishedScheduleIcs({
    scheduleVersion: published.scheduleVersion,
    events: published.events,
    calendarName: `КГМУ педиатрия ${version.groupId}`
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

const { plan, qa } = await loadPlan();
if (plan.programId !== 'pediatrics') throw new Error(`unexpected programId: ${plan.programId}`);
if (plan.events.some((event) => event.facultativeId != null)) {
  throw new Error('Pediatrics course 2 candidate unexpectedly contains facultative events');
}

await runPediatricsPublication({
  apply: APPLY,
  plan,
  qaForPublication: toCorePublicationQa(qa),
  result: 'PRODUCTION_PEDIATRICS_COURSE_2_SCHEDULES_PUBLISHED_AND_VERIFIED',
  verifyPublishedIcs: verifyCourse2Ics,
  resultMetadata: {
    trialChanged: false,
    checkoutChanged: false,
    subscriptionsChanged: false,
    entitlementsChanged: false,
    calendarPreferencesChanged: false,
    subscriptionTokensChanged: false
  }
});
