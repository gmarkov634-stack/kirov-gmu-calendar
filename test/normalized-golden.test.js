import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
function selected(table, maskHex) {
  const mask = BigInt(`0x${maskHex}`);
  return table.filter((_, index) => (mask & (1n << BigInt(index))) !== 0n);
}
function expandManifest(manifest) {
  const events = [];
  for (const tuple of manifest.decisions) {
    const [locator, groupMaskHex, dateMaskHex, startTime, endTime, disciplineIndex, lessonTypeIndex, locationIndex] = tuple;
    const discipline = manifest.disciplineTable[disciplineIndex];
    const lessonType = manifest.lessonTypeTable[lessonTypeIndex];
    const location = manifest.locationTable[locationIndex];
    const assessment = manifest.assessmentMetadataByDisciplineIndex[String(disciplineIndex)] ?? null;
    for (const groupId of selected(manifest.groupTable, groupMaskHex)) {
      for (const date of selected(manifest.dateTable, dateMaskHex)) {
        const sourceLocator = `${manifest.sheetName}!${locator}`;
        const key = [groupId, date, startTime, endTime, discipline, lessonType, sourceLocator].join('|');
        const event = {
          eventId: `kgmu-${sha256(key).slice(0, 24)}`,
          universityId: 'kirov-gmu', groupId, academicPeriodId: '2026-2027-semester-1',
          date, startTime, endTime, timeSemantics: 'floating', discipline, lessonType,
          teacher: null, location, sourceRef: { sourceId: 'medicine', locator: sourceLocator }
        };
        if (assessment) event.assessment = structuredClone(assessment);
        events.push(event);
      }
    }
  }
  return events.sort((a, b) => [
    Number(a.groupId) - Number(b.groupId), a.date.localeCompare(b.date),
    a.startTime.localeCompare(b.startTime), a.endTime.localeCompare(b.endTime),
    a.discipline.localeCompare(b.discipline), a.lessonType.localeCompare(b.lessonType),
    a.sourceRef.locator.localeCompare(b.sourceRef.locator)
  ].find(value => value !== 0) ?? 0);
}
function minutes(value) { const [h, m] = value.split(':').map(Number); return h * 60 + m; }
function overlaps(a, b) { return minutes(a.startTime) < minutes(b.endTime) && minutes(b.startTime) < minutes(a.endTime); }

test('refreshed 27.08 medicine 101-110 expands only explicit operator decisions', async () => {
  const manifest = await readJson('../fixtures/2026-2027-semester-1/medicine-101-110.decisions.json');
  const evidence = await readJson('../qa/2026-2027-semester-1/medicine-101-110.evidence.json');
  const qa = await readJson('../qa/2026-2027-semester-1/medicine-101-110.qa-report.json');
  const events = expandManifest(manifest);

  assert.equal(manifest.schema, 'kgmu-explicit-semantic-decisions-v3');
  assert.equal(manifest.sourceSha256, '341f5bce70de3b6a483f7edfe83fe37ec02e70a4aaccb043aa77a23f9222255b');
  assert.equal(manifest.semanticDecisionMode, 'operator-authored-explicit');
  assert.equal(manifest.logicalSourceCellCount, 145);
  assert.equal(manifest.decisionCount, 196);
  assert.equal(events.length, 3429);
  assert.equal(evidence.eventCount, 3429);
  assert.equal(evidence.coveredSourceCellCount, 145);
  assert.equal(evidence.unresolvedAmbiguities, 0);
  assert.equal(evidence.duplicateEvents, 0);
  assert.equal(evidence.explicitOverlapWarningCount, 8);
  assert.equal(qa.decision, 'pass');
  assert.ok(qa.checks.some(check => check.code === 'shared-contract-assessment-projection' && check.status === 'pass'));
  assert.equal(qa.sharedContractEvidence.commit, '46c64976fff5483b34b40570f4ffe49f20554ff3');
  assert.equal(qa.sharedContractEvidence.normalizedEventSchemaBlob, 'f40a8d7efef1cf362cea9a82976dd86d431186b8');
  assert.equal(qa.sharedContractEvidence.icsRendererBlob, '94cbd7d50aa4af2028ab27298cc05592ee3d51b7');
  assert.equal(qa.candidateDigest, 'sha256:5282de1dcec279ac4d035d55ea57d293d8ed0294ecc1cb0e3446e7a4e7a3f20a');
  assert.equal(evidence.candidateDigest, qa.candidateDigest);
  assert.equal(`sha256:${sha256(canonicalJson(events))}`, qa.candidateDigest);
  assert.deepEqual(evidence.groupEventCounts, {
    '101':336,'102':335,'103':335,'104':335,'105':336,'106':336,'107':347,'108':347,'109':361,'110':361
  });

  const signatures = new Set();
  const sourceCells = new Set();
  for (const event of events) {
    assert.equal(event.timeSemantics, 'floating');
    assert.ok(minutes(event.endTime) > minutes(event.startTime));
    const sig = [event.groupId,event.date,event.startTime,event.endTime,event.discipline,event.lessonType,event.location].join('|');
    assert.ok(!signatures.has(sig), `duplicate event ${sig}`);
    signatures.add(sig);
    sourceCells.add(event.sourceRef.locator.match(/!([A-Z]+\d+)#/)[1]);
  }
  assert.equal(sourceCells.size, 145);
  assert.equal(evidence.r83Checks.length, 26);
  assert.ok(evidence.r83Checks.every(check => check.status === 'pass'));
});

test('preserves assessment metadata and explicit graded-credit controls', async () => {
  const manifest = await readJson('../fixtures/2026-2027-semester-1/medicine-101-110.decisions.json');
  const events = expandManifest(manifest);
  const orgIndex = manifest.disciplineTable.indexOf('Основы российской государственности');
  const upoIndex = manifest.disciplineTable.indexOf('УПО. Общий уход');
  assert.equal(manifest.assessmentMetadataByDisciplineIndex[String(orgIndex)].type, 'graded-credit');
  assert.equal(manifest.assessmentMetadataByDisciplineIndex[String(upoIndex)].type, 'graded-credit');
  const controls = events.filter(event => event.discipline === 'Основы российской государственности' && event.lessonType === 'graded-credit');
  assert.equal(controls.length, 10);
  assert.ok(controls.every(event => event.assessment?.type === 'graded-credit'));
  const combined = controls.find(event => event.groupId === '109' && event.date === '2027-01-16');
  assert.ok(combined);
  assert.equal(combined.startTime, '16:40');
  assert.equal(combined.endTime, '20:45');
});

test('preserves exactly eight source-explicit overlaps', async () => {
  const manifest = await readJson('../fixtures/2026-2027-semester-1/medicine-101-110.decisions.json');
  const evidence = await readJson('../qa/2026-2027-semester-1/medicine-101-110.evidence.json');
  const events = expandManifest(manifest);
  const byDay = new Map();
  for (const event of events) {
    const key = `${event.groupId}|${event.date}`;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(event);
  }
  let count = 0;
  for (const dayEvents of byDay.values()) {
    for (let i = 0; i < dayEvents.length; i += 1) {
      for (let j = i + 1; j < dayEvents.length; j += 1) if (overlaps(dayEvents[i], dayEvents[j])) count += 1;
    }
  }
  assert.equal(count, 8);
  assert.equal(evidence.explicitOverlapWarnings.length, 8);
});

test('locks literal H9/I9 timing, B32 geometry and R89 curator behavior', async () => {
  const manifest = await readJson('../fixtures/2026-2027-semester-1/medicine-101-110.decisions.json');
  const events = expandManifest(manifest);
  for (const groupId of ['107','108']) {
    const upo = events.filter(event => event.groupId === groupId && event.date === '2026-09-07' && event.discipline === 'УПО. Общий уход')
      .map(event => [event.startTime,event.endTime]).sort();
    assert.deepEqual(upo, [['08:30','10:00'],['11:10','11:40']]);
  }
  assert.equal(events.filter(event => event.groupId === '102' && event.sourceRef.locator.startsWith('1 леч.1!B32#')).length, 0);
  assert.equal(events.filter(event => event.groupId === '101' && event.sourceRef.locator.startsWith('1 леч.1!B32#')).length, 2);
  const curator = events.filter(event => event.groupId === '110' && event.discipline === 'Час куратора' && event.sourceRef.locator.startsWith('1 леч.1!K27#s2'));
  assert.equal(curator.length, 19);
  assert.ok(curator.some(event => event.startTime === '14:30' && event.endTime === '15:30'));
  assert.ok(curator.some(event => event.startTime === '16:30' && event.endTime === '17:30'));
});

test('locks B41 local override and 02.09 phone-smoke lecture classification', async () => {
  const manifest = await readJson('../fixtures/2026-2027-semester-1/medicine-101-110.decisions.json');
  const events = expandManifest(manifest);
  const economy = events.filter(event => event.groupId === '101' && event.date === '2026-12-12' && event.discipline === 'Экономика');
  assert.equal(economy.length, 1);
  assert.equal(economy[0].startTime, '13:30');
  assert.equal(economy[0].endTime, '15:00');
  for (const discipline of ['Физика, математика','Биология']) {
    const event = events.find(item => item.groupId === '101' && item.date === '2026-09-02' && item.discipline === discipline);
    assert.ok(event);
    assert.equal(event.lessonType, 'lecture');
  }
});
