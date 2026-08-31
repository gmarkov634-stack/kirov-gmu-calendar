const PE_SELECTION_GROUP_ID = 'medicine-5-physical-education-stream-2026-s1';
const PE_SELECTION_OPTION_IDS = Object.freeze(['stream-1', 'stream-2']);
const EXPECTED_PE_EVENTS_PER_OPTION = 16;

function unfoldIcs(ics) {
  return String(ics).replace(/\r\n[ \t]/g, '');
}

function countVevents(ics) {
  return (unfoldIcs(ics).match(/BEGIN:VEVENT/g) ?? []).length;
}

function renderCount({
  renderPublishedScheduleIcs,
  scheduleVersion,
  events,
  calendarName,
  preferences
}) {
  return countVevents(renderPublishedScheduleIcs({
    scheduleVersion,
    events,
    calendarName,
    ...(preferences == null ? {} : { preferences })
  }));
}

export function verifyMedicine501516IcsPersonalization({
  renderPublishedScheduleIcs,
  scheduleVersion,
  events,
  calendarName
}) {
  if (typeof renderPublishedScheduleIcs !== 'function') {
    throw new TypeError('renderPublishedScheduleIcs must be a function');
  }
  if (!Array.isArray(events) || events.length === 0) {
    throw new TypeError('events must be a non-empty array');
  }

  const commonEvents = events.filter((event) => event?.selection == null);
  const selectionEvents = events.filter((event) => event?.selection != null);
  const optionCounts = Object.fromEntries(PE_SELECTION_OPTION_IDS.map((optionId) => [optionId, 0]));

  for (const event of selectionEvents) {
    const selection = event.selection;
    if (selection?.selectionGroupId !== PE_SELECTION_GROUP_ID) {
      throw new Error('course 5 ICS verification found an unexpected selection group');
    }
    if (!PE_SELECTION_OPTION_IDS.includes(selection.selectionOptionId)) {
      throw new Error('course 5 ICS verification found an unexpected selection option');
    }
    optionCounts[selection.selectionOptionId] += 1;
  }

  for (const optionId of PE_SELECTION_OPTION_IDS) {
    if (optionCounts[optionId] !== EXPECTED_PE_EVENTS_PER_OPTION) {
      throw new Error(
        `course 5 ICS verification expected ${EXPECTED_PE_EVENTS_PER_OPTION} ${optionId} events, got ${optionCounts[optionId]}`
      );
    }
  }

  const expectedSelectionEvents = EXPECTED_PE_EVENTS_PER_OPTION * PE_SELECTION_OPTION_IDS.length;
  if (selectionEvents.length !== expectedSelectionEvents) {
    throw new Error(
      `course 5 ICS verification expected ${expectedSelectionEvents} selection events, got ${selectionEvents.length}`
    );
  }

  const defaultEventCount = renderCount({
    renderPublishedScheduleIcs,
    scheduleVersion,
    events,
    calendarName
  });
  if (defaultEventCount !== commonEvents.length) {
    throw new Error(
      `course 5 default fail-closed ICS VEVENT count verification failed: expected ${commonEvents.length}, got ${defaultEventCount}`
    );
  }

  const selectedEventCounts = {};
  for (const optionId of PE_SELECTION_OPTION_IDS) {
    const expectedCount = commonEvents.length + optionCounts[optionId];
    const actualCount = renderCount({
      renderPublishedScheduleIcs,
      scheduleVersion,
      events,
      calendarName,
      preferences: {
        electiveChoices: {
          [PE_SELECTION_GROUP_ID]: optionId
        }
      }
    });
    if (actualCount !== expectedCount) {
      throw new Error(
        `course 5 ${optionId} ICS VEVENT count verification failed: expected ${expectedCount}, got ${actualCount}`
      );
    }
    selectedEventCounts[optionId] = actualCount;
  }

  return Object.freeze({
    selectionGroupId: PE_SELECTION_GROUP_ID,
    totalCandidateEventCount: events.length,
    commonEventCount: commonEvents.length,
    selectionEventCount: selectionEvents.length,
    optionEventCounts: Object.freeze({ ...optionCounts }),
    defaultEventCount,
    selectedEventCounts: Object.freeze(selectedEventCounts)
  });
}
