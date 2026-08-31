import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { expandExplicitDecisionManifest } from '../src/explicit-decisions.js';
import { verifyMedicine501516IcsPersonalization } from '../src/medicine-501-516-ics-verification.js';

const manifest = JSON.parse(await readFile(
  new URL('../fixtures/2026-2027-semester-1/medicine-501-516.decisions.json', import.meta.url),
  'utf8'
));
const source = JSON.parse(await readFile(
  new URL('../fixtures/2026-2027-semester-1/medicine-501-516.source.json', import.meta.url),
  'utf8'
));
const events = expandExplicitDecisionManifest(manifest, {
  universityId: source.universityId,
  academicPeriodId: source.academicPeriodId,
  sourceId: source.source.sourceId
}).filter((event) => event.groupId === '501');

function renderWithFailClosedSelection({ events: renderEvents, preferences = {} }) {
  const choices = preferences.electiveChoices ?? {};
  const visibleEvents = renderEvents.filter((event) => {
    if (event.selection == null) return true;
    return choices[event.selection.selectionGroupId] === event.selection.selectionOptionId;
  });
  const vevents = visibleEvents.map(() => 'BEGIN:VEVENT\r\nEND:VEVENT').join('\r\n');
  return `BEGIN:VCALENDAR\r\n${vevents}\r\nEND:VCALENDAR\r\n`;
}

test('course 5 ICS verification respects fail-closed PE personalization', () => {
  assert.equal(events.length, 150);

  const result = verifyMedicine501516IcsPersonalization({
    renderPublishedScheduleIcs: renderWithFailClosedSelection,
    scheduleVersion: { versionId: 'test' },
    events,
    calendarName: 'КГМУ 501'
  });

  assert.equal(result.totalCandidateEventCount, 150);
  assert.equal(result.selectionEventCount, 32);
  assert.equal(result.commonEventCount, 118);
  assert.deepEqual(result.optionEventCounts, { 'stream-1': 16, 'stream-2': 16 });
  assert.equal(result.defaultEventCount, 118);
  assert.deepEqual(result.selectedEventCounts, { 'stream-1': 134, 'stream-2': 134 });
});

test('course 5 ICS verification rejects a renderer that leaks both PE streams by default', () => {
  const renderAllEvents = ({ events: renderEvents }) => {
    const vevents = renderEvents.map(() => 'BEGIN:VEVENT\r\nEND:VEVENT').join('\r\n');
    return `BEGIN:VCALENDAR\r\n${vevents}\r\nEND:VCALENDAR\r\n`;
  };

  assert.throws(() => verifyMedicine501516IcsPersonalization({
    renderPublishedScheduleIcs: renderAllEvents,
    scheduleVersion: { versionId: 'test' },
    events,
    calendarName: 'КГМУ 501'
  }), /default fail-closed ICS VEVENT count verification failed/);
});
