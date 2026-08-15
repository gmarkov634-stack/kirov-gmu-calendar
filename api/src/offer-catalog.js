import { listOfferProgramAvailability } from "./offer-availability.js";
import { scheduleContext } from "./order-context.js";

const UNIVERSITY_ID = /^[a-z][a-z0-9-]{1,31}$/;
const PROGRAM_ID = /^[a-z][a-z0-9-]{1,31}$/;

function send(response, status, body, cacheControl = "no-store") {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": cacheControl,
  });
  response.end(JSON.stringify(body));
}

function allowCors(request, response, config) {
  const origin = request.headers.origin;
  const allowedOrigins = Array.isArray(config.allowedOrigins)
    ? config.allowedOrigins
    : [config.allowedOrigin].filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function validOfferPeriod(config) {
  const academicYear = String(config.offerAcademicYear || "").trim();
  const semester = Number(config.offerSemester);
  if (!/^\d{4}(?:\/|-)\d{2,4}$/.test(academicYear) || ![1, 2].includes(semester)) return null;
  return { academicYear, semester };
}

function localDate(date, timezone) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return new Date().toISOString().slice(0, 10);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const fields = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  } catch {
    return value.toISOString().slice(0, 10);
  }
}

function previewEvent(event) {
  if (event?.timing?.date) {
    const sequence = event?.derived?.sequence;
    const locations = Array.isArray(event?.lesson?.locations) ? event.lesson.locations.filter(Boolean) : [];
    return {
      date: String(event.timing.date),
      startTime: event.timing.start_time || null,
      endTime: event.timing.end_time || null,
      allDay: event.timing.all_day === true,
      title: String(event?.calendar?.title || event?.lesson?.discipline?.normalized || event?.lesson?.discipline?.raw || "Занятие"),
      type: event?.lesson?.type?.raw || event?.lesson?.type?.code || null,
      location: event?.calendar?.location || locations.join(", ") || null,
      sequence: Number.isInteger(sequence?.index) && Number.isInteger(sequence?.total)
        ? `${sequence.index} из ${sequence.total}`
        : null,
    };
  }

  const start = String(event?.start || "");
  const end = String(event?.end || "");
  const date = /^20\d{2}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : null;
  if (!date) return null;
  return {
    date,
    startTime: event?.allDay === true ? null : start.match(/T(\d{2}:\d{2})/)?.[1] || null,
    endTime: event?.allDay === true ? null : end.match(/T(\d{2}:\d{2})/)?.[1] || null,
    allDay: event?.allDay === true,
    title: String(event?.title || "Занятие"),
    type: null,
    location: event?.location || null,
    sequence: null,
  };
}

function previewEvents(schedule, today, limit = 4) {
  const values = (schedule?.events || [])
    .map(previewEvent)
    .filter(Boolean)
    .sort((left, right) => `${left.date}T${left.startTime || "00:00"}`.localeCompare(`${right.date}T${right.startTime || "00:00"}`));
  const upcoming = values.filter((event) => event.date >= today);
  return (upcoming.length ? upcoming : values.slice(-limit)).slice(0, limit);
}

export function createOfferCatalogHandler({
  store,
  config,
  listProgramAvailability = listOfferProgramAvailability,
  now = () => new Date(),
}) {
  return async function offerCatalogHandler(request, response) {
    allowCors(request, response, config);
    if (request.method === "OPTIONS") return send(response, 204, {});
    if (request.method !== "GET") return send(response, 405, { error: "method_not_allowed" });

    const url = new URL(request.url, "http://localhost");
    const programSummaryMatch = url.pathname.match(/^\/api\/v2\/catalog\/([^/]+)\/programs$/);
    const groupMatch = url.pathname.match(/^\/api\/v2\/catalog\/([^/]+)\/([^/]+)\/(\d+)\/groups$/);
    const previewMatch = url.pathname.match(/^\/api\/v2\/catalog\/([^/]+)\/([^/]+)\/(\d+)\/([^/]+)\/preview$/);
    if (!programSummaryMatch && !groupMatch && !previewMatch) return send(response, 404, { error: "not_found" });

    const period = validOfferPeriod(config);
    if (!period) return send(response, 503, { error: "offer_not_configured" });

    if (programSummaryMatch) {
      const university = decodeURIComponent(programSummaryMatch[1]);
      if (!UNIVERSITY_ID.test(university)) return send(response, 400, { error: "invalid_catalog_context" });
      try {
        const programs = await listProgramAvailability({
          store,
          university,
          academicYear: period.academicYear,
          semester: period.semester,
        });
        return send(response, 200, {
          university,
          academicYear: period.academicYear,
          semester: period.semester,
          programs,
        }, "public, max-age=60");
      } catch (error) {
        console.error("offer availability unavailable", error);
        return send(response, 503, { error: "catalog_unavailable" });
      }
    }

    const match = groupMatch || previewMatch;
    const university = decodeURIComponent(match[1]);
    const program = decodeURIComponent(match[2]);
    const course = Number(match[3]);
    if (!UNIVERSITY_ID.test(university) || !PROGRAM_ID.test(program) || !Number.isInteger(course) || course < 1 || course > 9) {
      return send(response, 400, { error: "invalid_catalog_context" });
    }

    try {
      const groups = await store.listScheduleGroups({
        university,
        program,
        course,
        academicYear: period.academicYear,
        semester: period.semester,
      });

      if (groupMatch) {
        return send(response, 200, {
          university,
          program,
          course,
          academicYear: period.academicYear,
          semester: period.semester,
          groups: groups.map(({ groupId, groupCode, displayName }) => ({ groupId, groupCode, displayName })),
        }, "public, max-age=60");
      }

      const requestedGroupCode = decodeURIComponent(previewMatch[4]);
      const group = groups.find((item) => item.groupCode === requestedGroupCode);
      if (!group) return send(response, 404, { error: "offer_not_found" });
      const schedule = await store.getSchedule({
        university,
        program,
        course,
        groupId: group.groupId,
        groupCode: group.groupCode,
        academicYear: period.academicYear,
        semester: period.semester,
        plan: "semester",
      });
      if (!schedule) return send(response, 404, { error: "offer_not_found" });
      const context = scheduleContext(schedule, university);
      const samePeriod = context.university === university &&
        context.program === program &&
        context.course === course &&
        context.groupId === group.groupId &&
        Number(context.semester) === Number(period.semester);
      if (!samePeriod) return send(response, 409, { error: "offer_not_ready" });

      return send(response, 200, {
        university,
        program,
        course,
        academicYear: period.academicYear,
        semester: period.semester,
        group: {
          groupId: group.groupId,
          groupCode: group.groupCode,
          displayName: group.displayName || context.groupDisplayName || `Группа ${group.groupCode}`,
        },
        events: previewEvents(schedule, localDate(now(), context.timezone), 4),
      }, "public, max-age=60");
    } catch (error) {
      console.error("offer catalog unavailable", error);
      return send(response, 503, { error: "catalog_unavailable" });
    }
  };
}
