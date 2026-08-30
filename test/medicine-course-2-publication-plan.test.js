import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { buildExplicitPublicationPlan } from '../src/explicit-publication-plan.js';

const execFileAsync = promisify(execFile);

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

async function plan(stream) {
  const [manifest, source, evidence, qa] = await Promise.all([
    readJson(`../fixtures/2026-2027-semester-1/medicine-${stream}.decisions.json`),
    readJson(`../fixtures/2026-2027-semester-1/medicine-${stream}.source.json`),
    readJson(`../qa/2026-2027-semester-1/medicine-${stream}.evidence.json`),
    readJson(`../qa/2026-2027-semester-1/medicine-${stream}.qa-report.json`)
  ]);
  return buildExplicitPublicationPlan({ manifest, source, evidence, qa });
}

test('builds deterministic publication plans for medicine course 2', async () => {
  const first = await plan('201-210');
  const second = await plan('211-220');
  assert.equal(first.events.length, 2662);
  assert.equal(second.events.length, 2646);
  assert.equal(first.candidateDigest, 'sha256:dbfcd46c084145c03f4dc9d0f53bfac42a42d58ceb5c4ca5897ee7ee5cb60192');
  assert.equal(second.candidateDigest, 'sha256:f1fe8459ad1724e9322d95c2500924a9a7a4b6e016d6884347e4fd2aa1d4a912');
  assert.deepEqual(first.versions.map(({ groupId, eventCount }) => [groupId, eventCount]), [
    ['201',266],['202',268],['203',267],['204',267],['205',269],
    ['206',266],['207',266],['208',265],['209',264],['210',264]
  ]);
  assert.deepEqual(second.versions.map(({ groupId, eventCount }) => [groupId, eventCount]), [
    ['211',265],['212',266],['213',265],['214',265],['215',264],
    ['216',265],['217',262],['218',266],['219',263],['220',265]
  ]);
});

test('applies the source-specific group 206 Anatomy operator decision on 31 December', async () => {
  const first = await plan('201-210');
  const anatomy = first.events.filter((event) => event.groupId === '206' && event.discipline === 'Анатомия');
  const onDec30 = anatomy.filter((event) => event.date === '2026-12-30');
  assert.equal(onDec30.length, 2);
  assert.deepEqual(onDec30.map(({ startTime, endTime }) => [startTime, endTime]).sort(), [
    ['13:10','15:35'],['13:30','15:55']
  ]);
  const onDec31 = anatomy.filter((event) => event.date === '2026-12-31');
  assert.equal(onDec31.length, 1);
  assert.equal(onDec31[0].startTime, '13:10');
  assert.equal(onDec31[0].endTime, '15:35');
  assert.equal(onDec31[0].sourceRef?.locator, '2 леч.1!G23#operator-extra-2026-12-31');
});

test('applies confirmed R66 suppressions to the exact conflicting computed source occurrences', async () => {
  const first = await plan('201-210');
  const second = await plan('211-220');
  assert.equal(first.events.some((event) => event.groupId === '201' && event.date === '2026-12-18' && event.sourceRef?.locator === '2 леч.1!B34#s1'), false);
  assert.equal(second.events.some((event) => event.groupId === '217' && event.date === '2026-12-16' && event.sourceRef?.locator === '2леч.2!H23#s1'), false);
  assert.equal(second.events.some((event) => event.groupId === '218' && event.date === '2026-10-31' && event.sourceRef?.locator === '2леч.2!H41#s1'), false);
});

test('keeps date-specific place exceptions and does not invent an online lecture URL', async () => {
  const first = await plan('201-210');
  const second = await plan('211-220');
  const online = first.events.filter((event) => event.date === '2026-09-12' && event.lessonType === 'lecture' && event.discipline === 'Медицинская и биологическая физика');
  assert.equal(online.length, 10);
  assert.ok(online.every((event) => event.location === 'Онлайн'));
  assert.ok(first.events.some((event) => event.groupId === '201' && event.date === '2026-11-30' && event.discipline === 'Сестринское дело' && event.location?.includes('аудитория 106')));
  assert.ok(second.events.some((event) => event.groupId === '211' && event.date === '2026-09-01' && event.discipline === 'Нормальная физиология' && event.location?.includes('аудитория 803')));
});

test('course-2 publication preflight is read-only and covers all 20 groups', async () => {
  const script = fileURLToPath(new URL('../ops/publish-medicine-201-220.mjs', import.meta.url));
  const { stdout, stderr } = await execFileAsync(process.execPath, [script, '--preflight']);
  assert.equal(stderr, '');
  assert.match(stdout, /"groupCount": 20/);
  assert.match(stdout, /"eventCount": 5308/);
  assert.match(stdout, /PREFLIGHT_OK_NO_DATABASE_CHANGES/);
});
