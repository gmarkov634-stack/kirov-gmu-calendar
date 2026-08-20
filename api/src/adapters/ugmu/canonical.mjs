function emptyDerived() {
  return {
    academic_week: null,
    sequence: { index: null, total: null, bucket: null },
    next_same_event: null,
    is_last_same_event: false,
    day: {
      index: null,
      total: null,
      remaining: null,
      next_event: null,
      gap_minutes: null,
      overlaps_next: false,
    },
    cycle: null,
    assessment: null,
  };
}

function semesterName(value) {
  if (value === 1 || value === "1" || value === "autumn") return "autumn";
  if (value === 2 || value === "2" || value === "spring") return "spring";
  throw new Error(`Unsupported UGMU semester: ${value}`);
}

function sourceFileName(sourceUrl) {
  if (!sourceUrl) return "ugmu-source.pdf";
  try {
    const pathname = new URL(sourceUrl).pathname;
    return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) || "ugmu-source.pdf");
  } catch {
    return "ugmu-source.pdf";
  }
}

function eventDate(value) {
  const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})T/);
  if (!match) throw new Error(`Invalid UGMU event datetime: ${value}`);
  return match[1];
}

function eventTime(value) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/);
  if (!match) throw new Error(`Invalid UGMU event datetime: ${value}`);
  return match[1];
}

function lessonType(rawEvent) {
  // The weekly-grid source explicitly marks lectures with «Л.». Other cells do
  // not state a specific practical/seminar/lab type, so the canonical layer
  // must not invent one.
  return rawEvent.lessonType === "lecture" ? "lecture" : "other";
}

function locations(rawEvent) {
  const value = String(rawEvent.location || "").trim();
  if (!value) return [];
  const online = value.toLocaleLowerCase("ru-RU") === "онлайн";
  return [{
    raw: value,
    building: null,
    room: null,
    address: online ? null : value,
  }];
}

function sourceNote(rawEvent) {
  const notes = [];
  if (rawEvent.department) notes.push(`Кафедра: ${rawEvent.department}`);
  if (rawEvent.locationNote) notes.push(rawEvent.locationNote);
  return notes.length ? notes.join("; ") : null;
}

function parserRules(rawEvent) {
  const rules = [
    "UGMU-WEEKLY-GRID-V1",
    "UGMU-I-II-WEEK-ANCHORS",
    "UGMU-REFERENCE-TABLE-NORMALIZATION",
  ];
  if (rawEvent.lessonType === "lecture") rules.push("UGMU-LECTURE-L-PREFIX");
  if (rawEvent.location === "Онлайн") rules.push("UGMU-LECTURES-ONLINE");
  if (rawEvent.locationNote) rules.push("UGMU-NO-FABRICATED-ADDRESS");
  return rules;
}

function canonicalEvent(rawEvent, rawSchedule, source) {
  const typeCode = lessonType(rawEvent);
  return {
    schema_version: "1.0",
    system: {
      event_id: null,
      schedule_version_id: null,
      fingerprint: null,
      revision: null,
      created_at: null,
      updated_at: null,
    },
    university: {
      code: "ugmu",
      name: "Уральский государственный медицинский университет",
    },
    academic: {
      academic_year: rawSchedule.academicYear,
      semester: semesterName(rawSchedule.semester),
      faculty_code: "medicine",
      faculty_name: "Лечебное дело",
      course: rawSchedule.course,
    },
    audience: {
      group: rawSchedule.group.code,
      scope: "whole_group",
      subgroups: [],
      stream: String(rawSchedule.stream),
    },
    timing: {
      date: eventDate(rawEvent.start),
      start_time: eventTime(rawEvent.start),
      end_time: eventTime(rawEvent.end),
      all_day: false,
      time_mode: "floating",
    },
    lesson: {
      discipline: {
        raw: rawEvent.sourceTitle || rawEvent.title,
        normalized: rawEvent.title,
      },
      type: {
        raw: rawEvent.lessonType === "lecture" ? "Л." : null,
        code: typeCode,
      },
      teachers: [],
      locations: locations(rawEvent),
      source_note: sourceNote(rawEvent),
      cycle_id: null,
      joint_groups: [],
    },
    source: {
      file_name: sourceFileName(source.url),
      file_hash: source.sha256 ? `sha256:${source.sha256}` : null,
      sheet: null,
      references: [
        { role: "date", range: `weekly-grid:${rawSchedule.group.code}:${eventDate(rawEvent.start)}` },
        { role: "time", range: `weekly-grid:${rawSchedule.group.code}:${eventTime(rawEvent.start)}-${eventTime(rawEvent.end)}` },
        { role: "lesson", range: `weekly-grid:${rawSchedule.group.code}:${rawEvent.sourceTitle || rawEvent.title}` },
        { role: "week", range: `weekly-grid:${rawEvent.weekRule || "weekly"}` },
      ],
      raw_text: rawEvent.sourceTitle || rawEvent.title,
    },
    parse: {
      status: "ok",
      rule_ids: parserRules(rawEvent),
      warnings: [],
    },
    derived: emptyDerived(),
    calendar: {
      title: null,
      description: null,
      location: null,
    },
  };
}

export function canonicalizeUgmuWeeklyPilot(rawSchedule) {
  if (!rawSchedule || rawSchedule.university !== "ugmu") throw new Error("Invalid UGMU pilot schedule");
  if (rawSchedule.group?.code !== "ОЛД 101") throw new Error("UGMU canonical pilot is fail-closed to ОЛД 101");
  if (rawSchedule.course !== 1 || String(rawSchedule.stream) !== "1") {
    throw new Error("UGMU canonical pilot requires course 1, stream 1");
  }
  if (rawSchedule.sourceReview?.status !== "semantic-reviewed-pilot") {
    throw new Error("UGMU source must pass semantic review before canonicalization");
  }
  if (rawSchedule.sourceReview?.publicationAllowed !== false) {
    throw new Error("UGMU pilot source boundary must remain fail-closed");
  }
  if (!Array.isArray(rawSchedule.events) || !rawSchedule.events.length) {
    throw new Error("UGMU pilot contains no events");
  }

  const source = rawSchedule.sources?.[0];
  if (!source?.url || !source?.sha256) throw new Error("UGMU pilot requires exact source URL and SHA-256");

  return {
    schema_version: "1.0",
    schedule: {
      university_code: "ugmu",
      academic_year: rawSchedule.academicYear,
      semester: semesterName(rawSchedule.semester),
      faculty_code: "medicine",
      course: rawSchedule.course,
      group: rawSchedule.group.code,
      period: {
        start_date: rawSchedule.semesterPeriod.start,
        end_date: rawSchedule.semesterPeriod.end,
        week1_start_date: rawSchedule.weekAnchors.I,
      },
      source_files: [source.url],
      generated_at: null,
      parser: "ugmu-weekly-grid/pilot-v1",
    },
    events: rawSchedule.events.map((event) => canonicalEvent(event, rawSchedule, source)),
  };
}
