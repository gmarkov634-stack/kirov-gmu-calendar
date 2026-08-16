import fs from 'node:fs/promises';
import path from 'node:path';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const inputDir = path.resolve(arg('--input-dir', '/tmp/izhgmu-current'));
const medicine1Dir = path.resolve(arg('--medicine1-dir', '/tmp/izhgmu-medicine1-dryrun'));
const output = path.resolve(arg('--output', path.join(inputDir, 'medicine1-3-readiness.json')));

const [medicine1Readiness, medicine1Manifest, medicine2, medicine3] = await Promise.all([
  fs.readFile(path.join(inputDir, 'medicine1-readiness.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(medicine1Dir, 'manifest.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(inputDir, 'medicine2-normalized.json'), 'utf8').then(JSON.parse),
  fs.readFile(path.join(inputDir, 'medicine3-canonical-summary.json'), 'utf8').then(JSON.parse),
]);

assert(medicine1Readiness.summary?.groups === 30, 'medicine-1 expected 30 groups');
assert(medicine1Readiness.summary?.contentReady === 30, 'medicine-1 not all groups content-ready');
assert(medicine1Readiness.summary?.blockedBySource === 0, 'medicine-1 has source blockers');
assert(medicine1Readiness.summary?.productionAuthorized === false, 'medicine-1 must remain production-disabled');
assert(medicine1Manifest.contentReady === true, 'medicine-1 dry-run packages are not all content-ready');
assert(medicine1Manifest.summary?.groups === 30, 'medicine-1 dry-run expected 30 groups');
assert(medicine1Manifest.summary?.allSidecarsMatchBase === true, 'medicine-1 personalization sidecars drifted from base schedules');
assert(medicine1Manifest.summary?.blockedBySource === 0, 'medicine-1 dry-run contains source-blocked groups');
assert(medicine1Manifest.productionAuthorized === false, 'medicine-1 dry-run must remain production-disabled');

const medicine2Groups = (medicine2.streams || []).flatMap((stream) => stream.groupResults || []);
assert(medicine2.summary?.groups === 30 && medicine2Groups.length === 30, 'medicine-2 expected 30 groups');
assert(medicine2.summary?.contentReady === 30, 'medicine-2 not all groups content-ready');
assert(medicine2.summary?.blocked === 0, 'medicine-2 contains blocked groups');
assert(medicine2.summary?.groupsWithReview === 0, 'medicine-2 contains review groups');
assert(medicine2.summary?.groupsWithDeferred === 0, 'medicine-2 contains deferred groups');
assert(medicine2.summary?.canonicalQaPassed === 30, 'medicine-2 canonical QA did not pass for all groups');
assert(medicine2.summary?.overlapCount === 0, 'medicine-2 contains semantic overlaps');
assert(medicine2.summary?.productionAuthorized === false, 'medicine-2 must remain production-disabled');

assert(medicine3.groupCount === 26, 'medicine-3 expected 26 groups');
assert(medicine3.contentReadyGroupCount === 26, 'medicine-3 not all groups content-ready');
assert(medicine3.totalOverlaps === 0, 'medicine-3 contains semantic overlaps after publication policy');
assert(medicine3.excludedDiscipline === 'Стоматология', 'medicine-3 temporary exclusion contract changed');
assert(medicine3.productionAuthorized === false, 'medicine-3 must remain production-disabled');

const medicine2Events = medicine2Groups.reduce((sum, group) => sum + Number(group.events || 0), 0);
const courses = [
  {
    course: 1,
    groups: medicine1Readiness.summary.groups,
    contentReadyGroups: medicine1Readiness.summary.contentReady,
    baseEvents: Number(medicine1Manifest.summary?.totalBaseEvents || 0),
    potentialElectiveOptionEvents: Number(medicine1Manifest.summary?.totalOptionEvents || 0),
    personalizationReady: medicine1Manifest.summary?.allSidecarsMatchBase === true,
    exclusions: [],
  },
  {
    course: 2,
    groups: medicine2.summary.groups,
    contentReadyGroups: medicine2.summary.contentReady,
    baseEvents: medicine2Events,
    potentialElectiveOptionEvents: 0,
    personalizationReady: false,
    exclusions: [],
  },
  {
    course: 3,
    groups: medicine3.groupCount,
    contentReadyGroups: medicine3.contentReadyGroupCount,
    baseEvents: Number(medicine3.totalEvents || 0),
    potentialElectiveOptionEvents: 0,
    personalizationReady: false,
    exclusions: ['Стоматология'],
  },
];

const result = {
  profile: 'IZHGMU-MEDICINE-COURSES-1-3-READINESS',
  version: 1,
  university: 'izhgmu',
  facultyCode: 'medicine',
  scope: {
    activeCourses: [1, 2, 3],
    deferredCourses: [4, 5, 6],
  },
  groups: courses.reduce((sum, course) => sum + course.groups, 0),
  contentReadyGroups: courses.reduce((sum, course) => sum + course.contentReadyGroups, 0),
  baseEvents: courses.reduce((sum, course) => sum + course.baseEvents, 0),
  potentialElectiveOptionEvents: courses.reduce((sum, course) => sum + course.potentialElectiveOptionEvents, 0),
  semanticOverlaps: 0,
  courses,
  contentReady: true,
  productionAuthorized: false,
  authorizationReason: 'IzhGMU remains inactive and the reviewed official source set is spring 2025/2026; courses 4-6 are intentionally deferred.',
};

assert(result.groups === 86, `medicine 1-3 group cardinality changed: ${result.groups}/86`);
assert(result.contentReadyGroups === 86, `medicine 1-3 content-ready cardinality changed: ${result.contentReadyGroups}/86`);
assert(result.baseEvents > 0, 'medicine 1-3 aggregate contains no events');

await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log('IZHGMU_MEDICINE1_3_READINESS', JSON.stringify({
  groups: result.groups,
  contentReadyGroups: result.contentReadyGroups,
  baseEvents: result.baseEvents,
  potentialElectiveOptionEvents: result.potentialElectiveOptionEvents,
  semanticOverlaps: result.semanticOverlaps,
  deferredCourses: result.scope.deferredCourses,
  productionAuthorized: result.productionAuthorized,
}));
