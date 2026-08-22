const STREAM_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "1", first: 101, last: 112 }),
  Object.freeze({ id: "2", first: 113, last: 124 }),
  Object.freeze({ id: "3", first: 125, last: 136 }),
  Object.freeze({ id: "4", first: 137, last: 150 }),
]);

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeUniversity(value) {
  return normalizeText(value).toLowerCase();
}

export const UGMU_COURSE1_STREAMS = STREAM_DEFINITIONS;

export const UGMU_COURSE1_GROUPS = Object.freeze(
  STREAM_DEFINITIONS.flatMap((stream) =>
    Array.from({ length: stream.last - stream.first + 1 }, (_, index) => {
      const groupCode = `ОЛД ${stream.first + index}`;
      return Object.freeze({
        university: "ugmu",
        program: "medicine",
        course: 1,
        stream: stream.id,
        groupCode,
        groupId: `ugmu:medicine:1:stream-${stream.id}:${groupCode}`,
      });
    }),
  ),
);

export const UGMU_COURSE1_GROUP_CODES = Object.freeze(
  UGMU_COURSE1_GROUPS.map((group) => group.groupCode),
);

const GROUP_BY_CODE = new Map(
  UGMU_COURSE1_GROUPS.map((group) => [group.groupCode, group]),
);

export function ugmuCourse1GroupByCode(value) {
  return GROUP_BY_CODE.get(normalizeText(value)) || null;
}

export function ugmuCourse1ContextAllowed(context = {}) {
  if (normalizeUniversity(context.university) !== "ugmu") return false;
  if (normalizeText(context.program) !== "medicine") return false;
  if (Number(context.course) !== 1) return false;

  const group = ugmuCourse1GroupByCode(context.groupCode);
  if (!group) return false;
  if (normalizeText(context.stream) !== group.stream) return false;
  return normalizeText(context.groupId) === group.groupId;
}
