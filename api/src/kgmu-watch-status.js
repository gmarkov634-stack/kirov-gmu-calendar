function send(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function safeSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  return {
    status: summary.status === "PARTIAL" ? "PARTIAL" : "OK",
    checkedAt: summary.checkedAt || null,
    expectedAcademicYear: summary.expectedAcademicYear || null,
    expectedSemesters: Array.isArray(summary.expectedSemesters) ? summary.expectedSemesters : [],
    parserRevision: summary.parserRevision || null,
    discoveredCount: Math.max(0, Number(summary.discoveredCount) || 0),
    targetCount: Math.max(0, Number(summary.targetCount) || 0),
    ingestedCount: Math.max(0, Number(summary.ingestedCount) || 0),
    unchangedCount: Math.max(0, Number(summary.unchangedCount) || 0),
    errorCount: Math.max(0, Number(summary.errorCount) || 0),
  };
}

export function createKgmuWatchStatusHandler({ stateStore, config }) {
  return async function kgmuWatchStatusHandler(request, response) {
    if (request.method !== "GET") return send(response, 405, { error: "method_not_allowed" });
    try {
      const state = await stateStore.read();
      return send(response, 200, {
        university: "kgmu",
        enabled: Boolean(config.kgmuWatchEnabled),
        intervalMs: Number(config.kgmuWatchIntervalMs || 0),
        lastRunAt: state.lastRunAt || null,
        lastRun: safeSummary(state.lastRunSummary),
      });
    } catch (error) {
      console.error("KGMU watcher status failed", error);
      return send(response, 503, { error: "kgmu_watch_status_unavailable" });
    }
  };
}
