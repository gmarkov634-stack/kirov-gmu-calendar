import { buildCalendar } from "./calendar.js";

const DISCLAIMER = "Календарь составлен по официальному расписанию. Переносы и изменения, согласованные группой с преподавателем, в календаре не отображаются.";

function send(response, status, body, type = "application/json; charset=utf-8") {
  const content = type.startsWith("application/json") ? JSON.stringify(body) : body;
  response.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": status === 200 ? "public, max-age=300" : "no-store",
  });
  response.end(content);
}

export function createHandler({ store, config }) {
  return async function handler(request, response) {
    const origin = request.headers.origin;
    if (origin && origin === config.allowedOrigin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") return send(response, 204, "", "text/plain");
    if (request.method !== "GET") return send(response, 405, { error: "method_not_allowed" });

    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/health") {
      return send(response, 200, { status: "ok", service: "kgmu-calendar-api" });
    }
    if (url.pathname === "/api/v1/meta") {
      return send(response, 200, {
        service: "Календарь КГМУ",
        timezone: "Europe/Moscow",
        academicYear: "2025-2026",
        semester: 2,
        disclaimer: DISCLAIMER,
      });
    }
    if (url.pathname === "/api/v1/groups") {
      return send(response, 200, { groups: store.listGroups() });
    }

    const match = url.pathname.match(/^\/api\/v1\/groups\/(\d{3})\/(schedule|calendar\.ics)$/);
    if (!match) return send(response, 404, { error: "not_found" });

    try {
      const schedule = await store.get(match[1]);
      if (!schedule) return send(response, 404, { error: "schedule_not_published", group: match[1] });
      if (match[2] === "calendar.ics") {
        const calendar = buildCalendar(schedule, config.publicSiteUrl);
        response.setHeader("Content-Disposition", `inline; filename=kgmu-${match[1]}.ics`);
        return send(response, 200, calendar, "text/calendar; charset=utf-8");
      }
      return send(response, 200, { ...schedule, disclaimer: DISCLAIMER });
    } catch (error) {
      console.error(error);
      return send(response, 503, { error: "schedule_storage_unavailable" });
    }
  };
}
