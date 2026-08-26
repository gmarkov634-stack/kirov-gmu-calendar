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
  'medical-biochemistry': {
    1: ['141'],
    2: ['241'],
    3: ['341'],
    4: ['441'],
    5: ['541'],
    6: ['641']
  },
  dentistry: {
    1: range(191, 194),
    2: range(291, 294),
    3: range(391, 394),
    4: ['494'],
    5: range(591, 594)
  }
};

test('uses only verified official KGMU timetable pages', async () => {
  const sources = await readJson('../source/sources.json');

  assert.equal(sources.universityId, 'kirov-gmu');
  assert.equal(sources.officialDomain, 'kirovgma.ru');
  assert.equal(sources.discovery.strategy, 'html-xlsx-links');
  assert.equal(sources.discovery.artifactMimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

  for (const url of [sources.timetableIndexUrl, ...sources.sources.map((source) => source.pageUrl)]) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.hostname, 'kirovgma.ru');
  }

  assert.deepEqual(
    sources.sources.map((source) => source.sourceId),
    ['medicine', 'pediatric-faculty', 'dentistry']
  );
});

test('matches the published 2026-2027 semester 1 group ranges without claiming full KGMU coverage', async () => {
  const catalog = await readJson('../catalog/2026-2027-semester-1.json');

  assert.equal(catalog.universityId, 'kirov-gmu');
  assert.equal(catalog.academicYear, '2026-2027');
  assert.equal(catalog.term, 'semester-1');
  assert.equal(catalog.coverage.status, 'partial');
  assert.deepEqual(catalog.coverage.includedSourceIds, ['medicine', 'pediatric-faculty', 'dentistry']);

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

  assert.deepEqual([...seenPrograms], ['medicine', 'pediatrics', 'medical-biochemistry', 'dentistry']);
  assert.equal(seenGroups.size, 174);
});

test('keeps medical biochemistry distinct from pediatrics while sharing the official faculty page', async () => {
  const sources = await readJson('../source/sources.json');
  const catalog = await readJson('../catalog/2026-2027-semester-1.json');

  const pediatricSource = sources.sources.find((source) => source.sourceId === 'pediatric-faculty');
  assert.deepEqual(pediatricSource.programIds, ['pediatrics', 'medical-biochemistry']);

  const pediatrics = catalog.programs.find((program) => program.programId === 'pediatrics');
  const biochemistry = catalog.programs.find((program) => program.programId === 'medical-biochemistry');
  assert.equal(pediatrics.facultyId, 'pediatric-faculty');
  assert.equal(biochemistry.facultyId, 'pediatric-faculty');
  assert.notEqual(pediatrics.programId, biochemistry.programId);
});
