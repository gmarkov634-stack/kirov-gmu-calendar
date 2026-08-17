import { listOfferProgramAvailability } from "./offer-availability.js";
import { listUniversities } from "./universities/registry.mjs";

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

export function isRegisteredUniversityInactive(id) {
  const normalized = String(id || "").trim().toLowerCase();
  if (!normalized) return false;

  const university = listUniversities().find((entry) =>
    [entry.id, entry.code]
      .filter(Boolean)
      .some((value) => String(value).trim().toLowerCase() === normalized),
  );

  return university?.active === false;
}

function rejectInactiveUniversity(response, university) {
  if (!isRegisteredUniversityInactive(university)) return false;
  send(response, 404, {
    error: "catalog_not_available",
    university,
    available: false,
  });
  return true;
}

export function createOfferCatalogHandler({ store, config, listProgramAvailability = listOfferProgramAvailability }) {
  return async function offerCatalogHandler(request, response) {
    allowCors(request, response, config);
    if (request.method === "OPTIONS") return send(response, 204, {});
    if (request.method !== "GET") return send(response, 405, { error: "method_not_allowed" });

    const url = new URL(request.url, "http://localhost");
    const programSummaryMatch = url.pathname.match(/^\/api\/v2\/catalog\/([^/]+)\/programs$/);
    const groupMatch = url.pathname.match(/^\/api\/v2\/catalog\/([^/]+)\/([^/]+)\/(\d+)\/groups$/);
    if (!programSummaryMatch && !groupMatch) return send(response, 404, { error: "not_found" });

    const period = validOfferPeriod(config);
    if (!period) return send(response, 503, { error: "offer_not_configured" });

    if (programSummaryMatch) {
      const university = decodeURIComponent(programSummaryMatch[1]);
      if (!UNIVERSITY_ID.test(university)) return send(response, 400, { error: "invalid_catalog_context" });
      if (rejectInactiveUniversity(response, university)) return;
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

    const university = decodeURIComponent(groupMatch[1]);
    const program = decodeURIComponent(groupMatch[2]);
    const course = Number(groupMatch[3]);
    if (!UNIVERSITY_ID.test(university) || !PROGRAM_ID.test(program) || !Number.isInteger(course) || course < 1 || course > 9) {
      return send(response, 400, { error: "invalid_catalog_context" });
    }
    if (rejectInactiveUniversity(response, university)) return;

    try {
      const groups = await store.listScheduleGroups({
        university,
        program,
        course,
        academicYear: period.academicYear,
        semester: period.semester,
      });
      return send(response, 200, {
        university,
        program,
        course,
        academicYear: period.academicYear,
        semester: period.semester,
        groups: groups.map(({ groupId, groupCode, displayName, stream }) => ({
          groupId,
          groupCode,
          displayName,
          ...(stream != null ? { stream } : {}),
        })),
      }, "public, max-age=60");
    } catch (error) {
      console.error("offer catalog unavailable", error);
      return send(response, 503, { error: "catalog_unavailable" });
    }
  };
}
