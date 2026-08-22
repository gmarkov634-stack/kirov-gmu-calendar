const freeze = (value) => Object.freeze(value);

const course1Streams = freeze([
  freeze({ id: "1", groups: freeze(Array.from({ length: 12 }, (_, index) => `ОЛД ${101 + index}`)) }),
  freeze({ id: "2", groups: freeze(Array.from({ length: 12 }, (_, index) => `ОЛД ${113 + index}`)) }),
  freeze({ id: "3", groups: freeze(Array.from({ length: 12 }, (_, index) => `ОЛД ${125 + index}`)) }),
  freeze({ id: "4", groups: freeze(Array.from({ length: 14 }, (_, index) => `ОЛД ${137 + index}`)) }),
]);

export const UGMU_CATALOG = freeze({
  schemaVersion: 1,
  university: freeze({
    id: "ugmu",
    name: "Уральский государственный медицинский университет",
  }),
  faculties: freeze([
    freeze({
      id: "medical-preventive-faculty",
      name: "Лечебно-профилактический факультет",
      programs: freeze([
        freeze({
          id: "medicine",
          code: "31.05.01",
          name: "Лечебное дело",
          durationYears: 6,
          courses: freeze([
            freeze({
              number: 1,
              streams: course1Streams,
            }),
          ]),
        }),
      ]),
    }),
  ]),
});

export function ugmuCatalogGroups() {
  return UGMU_CATALOG.faculties.flatMap((faculty) =>
    faculty.programs.flatMap((program) =>
      program.courses.flatMap((course) =>
        course.streams.flatMap((stream) =>
          stream.groups.map((groupCode) =>
            freeze({
              university: UGMU_CATALOG.university.id,
              faculty: faculty.id,
              program: program.id,
              programCode: program.code,
              course: course.number,
              stream: stream.id,
              groupCode,
              groupId: `${UGMU_CATALOG.university.id}:${program.id}:${course.number}:stream-${stream.id}:${groupCode}`,
            }),
          ),
        ),
      ),
    ),
  );
}
