import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  canonicalJson,
  digestNormalizedEvents,
  expandExplicitDecisionManifest,
  sha256Hex
} from '../src/explicit-decisions.js';

const CORE_HEAD = '2d6fe2b37c41c515be98d086b017eaaf17632335';
const EXPECTED_DIGEST = 'sha256:d2e3987a60ea05fc97de83afba9993285022dd932fd16a082da155efe589567f';
const GROUPS = ['631', '632', '633', '634', '635', '636', '637'];

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

function eventSetDigest(events) {
  return sha256Hex(canonicalJson([...events].sort((a, b) => a.eventId.localeCompare(b.eventId))));
}

function unfold(ics) {
  return ics.replace(/\r\n[ \t]/g, '');
}

function countMatches(value, regex) {
  return (value.match(regex) ?? []).length;
}

async function loadCore() {
  const root = process.env.MEDICAL_CALENDAR_CORE_ROOT;
  if (!root) throw new Error('MEDICAL_CALENDAR_CORE_ROOT is required for cross-repository integration');
  const marker = (await readFile(resolve(root, '.integration-head'), 'utf8')).trim();
  assert.equal(marker, CORE_HEAD, 'integration core checkout must be pinned to reviewed PR #246 head');
  return import(pathToFileURL(resolve(root, 'src/index.js')).href);
}

test('Pediatrics course 6 real candidate persists and renders losslessly on core PR #246', async () => {
  const [decisions, source, qa, core] = await Promise.all([
    readJson('../fixtures/2026-2027-semester-1/pediatrics-631-637.decisions.json'),
    readJson('../fixtures/2026-2027-semester-1/pediatrics-631-637.source.json'),
    readJson('../qa/2026-2027-semester-1/pediatrics-631-637.qa-report.json'),
    loadCore()
  ]);

  for (const name of [
    'openSqliteRuntimeDatabase',
    'createSqliteScheduleRepository',
    'createReadyScheduleVersion',
    'renderPublishedScheduleIcs'
  ]) {
    assert.equal(typeof core[name], 'function', `core PR #246 must export ${name}`);
  }

  const events = expandExplicitDecisionManifest(decisions, {
    universityId: source.universityId,
    academicPeriodId: source.academicPeriodId,
    sourceId: source.source.sourceId
  });

  assert.equal(events.length, 679);
  assert.equal(digestNormalizedEvents(events), EXPECTED_DIGEST);
  assert.equal(qa.candidateDigest, EXPECTED_DIGEST);
  assert.equal(qa.decision, 'pass');
  assert.ok(qa.checks.every((check) => check.status !== 'fail'));
  assert.equal(events.filter((event) => event.timeSemantics === 'floating').length, 637);
  assert.equal(events.filter((event) => event.timeSemantics === 'date-only').length, 42);
  assert.equal(events.filter((event) => event.timeSemantics === 'date-only' && (Object.hasOwn(event, 'startTime') || Object.hasOwn(event, 'endTime'))).length, 0);

  const directory = await mkdtemp(join(tmpdir(), 'kgmu-pediatrics-631-637-core246-'));
  const database = core.openSqliteRuntimeDatabase({ path: join(directory, 'runtime.sqlite'), timeout: 5000 });
  try {
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_id = '008_date_only_event_timing'").get().count,
      1,
      'core PR #246 date-only migration must be active'
    );
    const repository = core.createSqliteScheduleRepository(database);

    for (const groupId of GROUPS) {
      const groupEvents = events.filter((event) => event.groupId === groupId);
      assert.equal(groupEvents.length, 97, `candidate group ${groupId} cardinality`);
      assert.equal(groupEvents.filter((event) => event.timeSemantics === 'date-only').length, 6, `candidate group ${groupId} date-only cardinality`);
      assert.equal(groupEvents.filter((event) => event.timeSemantics === 'floating').length, 91, `candidate group ${groupId} floating cardinality`);

      const snapshot = core.createReadyScheduleVersion({
        parsingResult: {
          jobId: qa.parsingJobId,
          universityId: source.universityId,
          academicPeriodId: source.academicPeriodId,
          events
        },
        qaReport: qa,
        candidateDigest: EXPECTED_DIGEST,
        groupId,
        versionId: `integration-kgmu-pediatrics-${groupId}-core246`,
        createdAt: '2026-09-02T09:00:00Z'
      });

      await repository.saveReadySnapshot({
        academicYearId: source.academicYear,
        scheduleVersion: snapshot.scheduleVersion,
        events: snapshot.events
      });
      await repository.publishVersion({
        versionId: snapshot.scheduleVersion.versionId,
        publishedAt: '2026-09-02T09:05:00Z'
      });

      const loaded = await repository.getPublishedSchedule({
        universityId: source.universityId,
        groupId,
        academicYearId: source.academicYear,
        academicPeriodId: source.academicPeriodId
      });
      assert.ok(loaded, `published group ${groupId} must reload`);
      assert.equal(loaded.scheduleVersion.versionId, snapshot.scheduleVersion.versionId);
      assert.equal(loaded.events.length, 97);
      assert.equal(eventSetDigest(loaded.events), eventSetDigest(groupEvents), `group ${groupId} persistence digest`);
      assert.deepEqual(
        loaded.events.filter((event) => event.timeSemantics === 'date-only').map((event) => event.eventId).sort(),
        groupEvents.filter((event) => event.timeSemantics === 'date-only').map((event) => event.eventId).sort(),
        `group ${groupId} date-only identities`
      );

      const ics = unfold(core.renderPublishedScheduleIcs({
        scheduleVersion: loaded.scheduleVersion,
        events: loaded.events,
        calendarName: `КГМУ педиатрия ${groupId}`,
        preferences: { remindersMinutesBefore: [15] }
      }));
      assert.equal(countMatches(ics, /BEGIN:VEVENT/g), 97, `group ${groupId} VEVENT count`);
      assert.equal(countMatches(ics, /DTSTART;VALUE=DATE:\d{8}/g), 6, `group ${groupId} all-day DTSTART count`);
      assert.equal(countMatches(ics, /DTEND;VALUE=DATE:\d{8}/g), 6, `group ${groupId} all-day DTEND count`);
      assert.equal(countMatches(ics, /DTSTART:\d{8}T\d{6}/g), 91, `group ${groupId} floating DTSTART count`);
      assert.doesNotMatch(ics, /DTSTART;VALUE=DATE:[^\r\n]*T\d{6}/, `group ${groupId} must not invent a date-only clock time`);

      for (const event of loaded.events.filter((item) => item.timeSemantics === 'date-only')) {
        const uid = `UID:${event.eventId}@medical-calendar`;
        assert.ok(ics.includes(uid), `group ${groupId} date-only UID ${event.eventId}`);
        const block = ics.split(uid)[1].split('END:VEVENT')[0];
        assert.match(block, /DTSTART;VALUE=DATE:\d{8}/);
        assert.match(block, /DTEND;VALUE=DATE:\d{8}/);
        assert.doesNotMatch(block, /DTSTART[^\r\n]*T\d{6}/);
        assert.doesNotMatch(block, /DTEND[^\r\n]*T\d{6}/);
        assert.doesNotMatch(block, /BEGIN:VALARM/);
      }
    }

    assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});
