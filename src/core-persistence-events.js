function assertEventObject(event, label) {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    throw new TypeError(`${label} must be an object`);
  }
  return event;
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

export function toCorePersistenceEvent(event, { label = 'event' } = {}) {
  const source = assertEventObject(event, label);

  if (source.timeSemantics === 'floating') {
    assertNonEmptyString(source.startTime, `${label}.startTime`);
    assertNonEmptyString(source.endTime, `${label}.endTime`);
    return { ...source };
  }

  if (source.timeSemantics === 'date-only') {
    if (source.startTime != null || source.endTime != null) {
      throw new TypeError(`${label} date-only event must not have a non-null startTime or endTime`);
    }
    const { startTime: _startTime, endTime: _endTime, ...withoutTimes } = source;
    return withoutTimes;
  }

  throw new TypeError(`${label}.timeSemantics must be floating or date-only`);
}

export function toCorePersistenceEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('events must be an array');
  const adapted = events.map((event, index) => toCorePersistenceEvent(event, { label: `events[${index}]` }));
  if (adapted.length !== events.length) throw new Error('core persistence event adaptation changed event count');
  return adapted;
}
