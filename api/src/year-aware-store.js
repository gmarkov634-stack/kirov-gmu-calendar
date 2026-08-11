import { MultiUniversityStore } from "./university-store.js";

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function mergeYearSchedules(first, second) {
  const schedules = [first, second].filter(Boolean);
  if (!schedules.length) return null;
  if (schedules.length === 1) return schedules[0];
  const [base] = schedules;
  const events = uniqueBy(
    schedules.flatMap((schedule) => Array.isArray(schedule.events) ? schedule.events : []),
    (event) => event?.id || [event?.start, event?.end, event?.title, event?.location].join("|"),
  ).sort((a, b) => String(a?.start || "").localeCompare(String(b?.start || "")));
  const sources = uniqueBy(
    schedules.flatMap((schedule) => Array.isArray(schedule.sources) ? schedule.sources : []),
    (source) => JSON.stringify(source),
  );
  return {
    ...base,
    semester: Number(base.semester) || 1,
    includedSemesters: [...new Set(schedules.map((schedule) => Number(schedule.semester)).filter((value) => [1, 2].includes(value)))].sort(),
    sources,
    events,
  };
}

export class YearAwareStore extends MultiUniversityStore {
  async getSchedule(input) {
    if (input?.plan !== "year") return super.getSchedule(input);
    const academicYear = input?.academicYear || this.config.offerAcademicYear;
    const [semester1, semester2] = await Promise.all([
      super.getSchedule({ ...input, plan: "semester", academicYear, semester: 1 }),
      super.getSchedule({ ...input, plan: "semester", academicYear, semester: 2 }),
    ]);
    return mergeYearSchedules(semester1, semester2);
  }
}
