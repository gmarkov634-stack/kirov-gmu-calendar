import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, index) => String(from + index));
}

const EXPECTED_GROUPS = {
  medicine: {
    1: range(101, 120),
    2: range(201, 220),
    3: range(301, 317),
    4: range(401, 416),
    5: range(501, 516),
    6: range(601, 616)
  },
  pediatrics: {
    1: range(131, 140),
    2: range(231, 239),
    3: range(331, 337),
    4: range(431, 436),
    5: range(531, 537),
    6: range(631, 637)
  },
  dentistry: {
    1: range(191, 194),
    2: range(291, 294),
    3: range(391, 394),
    4: range(491, 494),
    5: range(591, 594)
  }
};

const PROJECT_PROGRAMS = ['medicine', 'pediatrics', 'dentistry'];
const PROJECT_FACULTIES = ['medical-faculty', 'pediatric-faculty', 'dental-faculty'];

test('uses only verified official KGMU timetable pages for the project scope', async () => {
  const sources = await readJson('../source/sources.json');

  assert.equal(sources.universityId, 'kirov-gmu');
  assert.equal(sources.officialDomain, 'kirovgma.ru');
  assert.deepEqual(sources.projectScope.programIds, PROJECT_PROGRAMS);
  assert.deepEqual(sources.projectScope.facultyIds, PROJECT_FACULTIES);
  assert.equal(sources.discovery.strategy, 'html-xlsx-links');
  assert.equal(sources.discovery.artifactMimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  for (const url of [sources.timetableIndexUrl, ...sources.sources.map((source) => source.pageUrl)]) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.hostname, 'kirovgma.ru');
  }

  assert.deepEqual(sources.sources.map((source) => source.sourceId), PROJECT_PROGRAMS);
  assert.deepEqual(sources.sources.flatMap((source) => source.programIds), PROJECT_PROGRAMS);
});

test('supports future academic years without changing shared core contracts', async () => {
  const sources = await readJson('../source/sources.json');

  assert.equal(sources.discovery.academicYearPattern, '^20\\d{2}-20\\d{2}$');
  assert.deepEqual(sources.discovery.termIds, ['semester-1', 'semester-2']);
  assert.equal(sources.versioning.catalogSnapshotPattern, 'catalog/{academicYear}-{term}.json');
  assert.equal(sources.versioning.retainHistoricalSnapshots, true);
  assert.equal(Object.hasOwn(sources.discovery, 'termLabel'), false);
});

test('matches the published 2026-2027 semester 1 groups for the three supported programs', async () => {
  const catalog = await readJson('../catalog/2026-2027-semester-1.json');

  assert.equal(catalog.universityId, 'kirov-gmu');
  assert.equal(catalog.academicYear, '2026-2027');
  assert.equal(catalog.term, 'semester-1');
  assert.equal(catalog.coverage.status, 'complete-for-project-scope');
  assert.deepEqual(catalog.coverage.facultyIds, PROJECT_FACULTIES);
  assert.deepEqual(catalog.coverage.programIds, PROJECT_PROGRAMS);

  const seenPrograms = new Set();
  const seenGroups = new Set();
  for (const program of catalog.programs) {
    assert.equal(seenPrograms.has(program.programId), false, `duplicate program ${program.programId}`);
    seenPrograms.add(program.programId);

    const expectedCourses = EXPECTED_GROUPS[program.programId];
    assert.ok(expectedCourses, `unexpected program ${program.programId}`);
    assert.deepEqual(program.courses.map((course) => course.course), Object.keys(expectedCourses).map(Number));

    for (const course of program.courses) {
      assert.deepEqual(course.groupIds, expectedCourses[course.course]);
      for (const groupId of course.groupIds) {
        assert.equal(seenGroups.has(groupId), false, `duplicate group ${groupId}`);
        seenGroups.add(groupId);
      }
    }
  }

  assert.deepEqual([...seenPrograms], PROJECT_PROGRAMS);
  assert.equal(seenGroups.size, 171);
  assert.equal(catalog.programs.some((program) => program.programId === 'medical-biochemistry'), false);
});
