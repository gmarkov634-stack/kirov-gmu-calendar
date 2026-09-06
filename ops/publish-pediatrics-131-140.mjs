#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPediatricsPublicationPlan,
  toCorePublicationQa
} from '../src/pediatrics-publication-plan.js';
import { runPediatricsPublication } from './lib/publish-pediatrics-course.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const APPLY = process.argv.includes('--apply');
const UNKNOWN_ARGS = process.argv.slice(2).filter((arg) => !['--apply', '--preflight'].includes(arg));
if (UNKNOWN_ARGS.length > 0) throw new Error(`unsupported arguments: ${UNKNOWN_ARGS.join(', ')}`);

async function readJson(relativePath) {
  return JSON.parse(await readFile(resolve(ROOT, relativePath), 'utf8'));
}

async function loadPlan() {
  const [manifest, facultatives, source, evidence, qa] = await Promise.all([
    readJson('fixtures/2026-2027-semester-1/pediatrics-131-140.decisions.json'),
    readJson('fixtures/2026-2027-semester-1/pediatrics-131-140.facultatives.json'),
    readJson('fixtures/2026-2027-semester-1/pediatrics-131-140.source.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-131-140.evidence.json'),
    readJson('qa/2026-2027-semester-1/pediatrics-131-140.qa-report.json')
  ]);
  return { plan: buildPediatricsPublicationPlan({ manifest, facultatives, source, evidence, qa }), qa };
}

function verifyCourse1Ics({ core, published, version, unfoldIcs, countVevents }) {
  const defaultVisibleEvents = published.events.filter((event) => event.facultativeId == null);
  const defaultIcs = unfoldIcs(core.renderPublishedScheduleIcs({
    scheduleVersion: published.scheduleVersion,
    events: published.events,
    calendarName: `КГМУ педиатрия ${version.groupId}`
  }));
  if (countVevents(defaultIcs) !== defaultVisibleEvents.length) {
    throw new Error(`group ${version.groupId} default-off ICS VEVENT count verification failed`);
  }

  const allFacultativeChoices = Object.fromEntries(
    published.events
      .filter((event) => event.facultativeId != null)
      .map((event) => [event.facultativeId, true])
  );
  const allFacultativesIcs = unfoldIcs(core.renderPublishedScheduleIcs({
    scheduleVersion: published.scheduleVersion,
    events: published.events,
    calendarName: `КГМУ педиатрия ${version.groupId}`,
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
await runPediatricsPublication({
  apply: APPLY,
  plan,
  qaForPublication: toCorePublicationQa(qa),
  result: 'PRODUCTION_PEDIATRICS_SCHEDULES_PUBLISHED_AND_VERIFIED',
  requireProductionRuntimeCommit: false,
  verifyPublishedIcs: verifyCourse1Ics,
  resultMetadata: {
    trialChanged: false,
    checkoutChanged: false,
    subscriptionTokensChanged: false
  }
});
