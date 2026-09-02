import { readFile, writeFile } from 'node:fs/promises';
import {
  digestNormalizedEvents,
  expandExplicitDecisionManifest
} from '../../src/explicit-decisions.js';

const ROOT = new URL('../../', import.meta.url);
async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, ROOT), 'utf8'));
}

const source = await readJson('fixtures/2026-2027-semester-1/pediatrics-331-337.source.json');
const manifest = await readJson('fixtures/2026-2027-semester-1/pediatrics-331-337.decisions.json');
const evidence = await readJson('qa/2026-2027-semester-1/pediatrics-331-337.evidence.json');
const plan = await readJson('qa/2026-2027-semester-1/pediatrics-331-337.date-plan.json');
const review = await readJson('qa/2026-2027-semester-1/pediatrics-331-337.semantic-review.json');
const crossDay = await readJson('qa/2026-2027-semester-1/pediatrics-331-337.cross-day-audit.json');

const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
});
const digest = digestNormalizedEvents(events);

function minutes(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function baseCell(locator) {
  return locator.replace(/^3пед\.!/, '').split('#')[0];
}

function baseSegment(locator) {
  return locator.replace(/#t\d+$/, '');
}

const blockingIssues = [];
if (manifest.sourceSha256 !== source.source.sha256) blockingIssues.push('manifest-source-sha-mismatch');
if (evidence.sourceSha256 !== source.source.sha256) blockingIssues.push('evidence-source-sha-mismatch');
if (plan.sourceSha256 !== source.source.sha256) blockingIssues.push('plan-source-sha-mismatch');
if (review.sourceSha256 !== source.source.sha256) blockingIssues.push('review-source-sha-mismatch');
if (digest !== manifest.candidateDigest || digest !== evidence.candidateDigest) blockingIssues.push('candidate-digest-mismatch');
if (review.status !== 'PASS' || review.blocksPublication !== false || review.unresolvedAmbiguities.length !== 0) blockingIssues.push('semantic-review-not-pass');
if (plan.reviewRequiredCellCount !== 0 || plan.passCellCount !== 98 || plan.plannedSegmentCount !== 131) blockingIssues.push('date-plan-incomplete');
if (crossDay.cueCount !== 44 || crossDay.passCount !== 43 || crossDay.reviewRequiredCount !== 1) blockingIssues.push('cross-day-audit-unexpected');

const expectedCells = new Set(plan.cells.map((cell) => baseCell(cell.sourceLocator)));
const coveredCells = new Set(manifest.decisions.map((decision) => baseCell(decision[0])));
const missingCells = [...expectedCells].filter((cell) => !coveredCells.has(cell)).sort();
const extraCells = [...coveredCells].filter((cell) => !expectedCells.has(cell)).sort();
if (missingCells.length || extraCells.length) blockingIssues.push('source-cell-coverage-mismatch');

const expectedSegments = new Set(plan.cells.flatMap((cell) => cell.segments.map((segment) => segment.segmentId)));
const coveredSegments = new Set(manifest.decisions.map((decision) => baseSegment(decision[0])));
const missingSegments = [...expectedSegments].filter((segment) => !coveredSegments.has(segment)).sort();
const extraSegments = [...coveredSegments].filter((segment) => !expectedSegments.has(segment)).sort();
if (missingSegments.length || extraSegments.length) blockingIssues.push('source-segment-coverage-mismatch');

const invalidEvents = [];
for (const event of events) {
  const eventDate = new Date(`${event.date}T00:00:00Z`);
  if (event.date < '2026-09-01' || event.date > '2026-12-30') {
    invalidEvents.push({ eventId: event.eventId, reason: 'date-out-of-semester', date: event.date });
  }
  if (eventDate.getUTCDay() === 0) {
    invalidEvents.push({ eventId: event.eventId, reason: 'sunday', date: event.date });
  }
  if (minutes(event.startTime) >= minutes(event.endTime)) {
    invalidEvents.push({ eventId: event.eventId, reason: 'non-positive-duration', startTime: event.startTime, endTime: event.endTime });
  }
  if (!source.expectedGroupIds.includes(event.groupId)) {
    invalidEvents.push({ eventId: event.eventId, reason: 'unexpected-group', groupId: event.groupId });
  }
}
if (invalidEvents.length) blockingIssues.push('invalid-normalized-events');

const duplicateMap = new Map();
for (const event of events) {
  const key = [event.groupId, event.date, event.startTime, event.endTime, event.discipline].join('|');
  const values = duplicateMap.get(key) ?? [];
  values.push(event);
  duplicateMap.set(key, values);
}
const exactDuplicates = [...duplicateMap.entries()]
  .filter(([, values]) => values.length > 1)
  .map(([key, values]) => ({
    key,
    count: values.length,
    sourceLocators: values.map((event) => event.sourceRef.locator)
  }));
if (exactDuplicates.length) blockingIssues.push('exact-logical-duplicates');

const byGroupDate = new Map();
for (const event of events) {
  const key = `${event.groupId}|${event.date}`;
  const values = byGroupDate.get(key) ?? [];
  values.push(event);
  byGroupDate.set(key, values);
}
const overlaps = [];
for (const [key, values] of byGroupDate) {
  const sorted = [...values].sort((a, b) => minutes(a.startTime) - minutes(b.startTime) || minutes(a.endTime) - minutes(b.endTime));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const left = sorted[i];
      const right = sorted[j];
      if (minutes(right.startTime) >= minutes(left.endTime)) break;
      overlaps.push({
        key,
        left: { discipline: left.discipline, startTime: left.startTime, endTime: left.endTime, sourceLocator: left.sourceRef.locator },
        right: { discipline: right.discipline, startTime: right.startTime, endTime: right.endTime, sourceLocator: right.sourceRef.locator }
      });
    }
  }
}

const confirmation = review.resolvedAmbiguities.find((item) => item.ambiguityId === 'PED3-D20-D12-MICROBIOLOGY-MISSING-MONDAY');
if (confirmation?.confirmationId !== 'USER-2026-09-02-PED3-KEEP-07-12') blockingIssues.push('operator-confirmation-missing');
const mondayMicrobiology333 = events.filter((event) =>
  event.groupId === '333' &&
  event.discipline === 'Микробиология, вирусология' &&
  new Date(`${event.date}T00:00:00Z`).getUTCDay() === 1
);
const resolvedExplicit = mondayMicrobiology333.filter((event) => event.date === '2026-12-07' && event.sourceRef.locator.startsWith('3пед.!D12'));
const d20Synthetic = mondayMicrobiology333.filter((event) => event.sourceRef.locator.startsWith('3пед.!D20'));
if (resolvedExplicit.length !== 1 || d20Synthetic.length !== 0) blockingIssues.push('group-333-microbiology-resolution-violated');

const unsafeLocations = events.filter((event) => typeof event.location === 'string' && event.location.includes('Щорса, 640'));
if (unsafeLocations.length) blockingIssues.push('suspicious-source-address-propagated');

const report = {
  schema: 'kgmu-candidate-qa-report-v1',
  fixtureId: source.fixtureId,
  sourceSha256: source.source.sha256,
  candidateDigest: digest,
  decision: blockingIssues.length === 0 ? 'pass' : 'review_required',
  blockingIssues,
  checks: {
    sourceCells: { expected: expectedCells.size, covered: coveredCells.size, missing: missingCells, extra: extraCells },
    sourceSegments: { expected: expectedSegments.size, covered: coveredSegments.size, missing: missingSegments, extra: extraSegments },
    normalizedEvents: { count: events.length, invalidCount: invalidEvents.length, invalidEvents },
    exactLogicalDuplicates: { count: exactDuplicates.length, items: exactDuplicates },
    overlaps: { count: overlaps.length, blocking: false, reason: 'Explicit source overlaps are preserved as source facts.', items: overlaps },
    crossDayAudit: { cueCount: crossDay.cueCount, passCount: crossDay.passCount, sourceMismatchCount: crossDay.reviewRequiredCount, semanticResolutionCount: review.resolvedAmbiguities.length },
    group333MicrobiologyResolution: {
      confirmationId: confirmation?.confirmationId ?? null,
      mondayEvents: mondayMicrobiology333.map((event) => ({ date: event.date, sourceLocator: event.sourceRef.locator, startTime: event.startTime, endTime: event.endTime })),
      resolvedExplicitCount: resolvedExplicit.length,
      d20SyntheticCount: d20Synthetic.length
    },
    locationSafety: { suspiciousSourceAddressPropagatedCount: unsafeLocations.length }
  },
  publicationGate: {
    candidateQaPass: blockingIssues.length === 0,
    productionPublished: false,
    landingExposed: false,
    note: 'Publication and landing exposure remain separate explicit steps.'
  }
};

await writeFile(new URL('qa/2026-2027-semester-1/pediatrics-331-337.qa-report.json', ROOT), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  decision: report.decision,
  blockingIssues: report.blockingIssues,
  eventCount: events.length,
  sourceCellCoverage: report.checks.sourceCells,
  sourceSegmentCoverage: report.checks.sourceSegments,
  exactLogicalDuplicateCount: exactDuplicates.length,
  overlapCount: overlaps.length,
  group333MicrobiologyResolution: report.checks.group333MicrobiologyResolution,
  suspiciousSourceAddressPropagatedCount: unsafeLocations.length
}, null, 2));
if (blockingIssues.length) process.exitCode = 1;
