import assert from "node:assert/strict";
import test from "node:test";
import { runIzhgmuSourceAdapter } from "../src/adapters/izhgmu/source-adapter.mjs";

const GOOD_PAGE = `
  <h2>Лечебный факультет - Весна 2025-2026</h2>
  <a href="/schedule.xlsx">Расписание занятий для студентов 3 курса лечебного факультета на весенний семестр 2025-2026 уч.г.</a>
`;

test("source adapter is discovery-only and fail-closed before fingerprint parser dispatch", async () => {
  const result = await runIzhgmuSourceAdapter({ fetchFn: async () => new Response(GOOD_PAGE, { status: 200 }) });
  assert.equal(result.status, "discovered");
  assert.equal(result.active, false);
  assert.equal(result.publishable, false);
  assert.equal(result.parserDispatchReady, false);
  assert.equal(result.manifest.sourceCount, 1);
});

test("source adapter fails closed on an unclassified source", async () => {
  const html = `<a href="/schedule.xlsx">Расписание занятий неизвестного набора</a>`;
  const result = await runIzhgmuSourceAdapter({ fetchFn: async () => new Response(html, { status: 200 }) });
  assert.equal(result.status, "needs-source-review");
  assert.equal(result.publishable, false);
  assert.equal(result.manifest.validation.status, "needs-review");
});

test("source adapter reports source errors without throwing into publication flow", async () => {
  const result = await runIzhgmuSourceAdapter({ fetchFn: async () => new Response("down", { status: 503 }) });
  assert.equal(result.status, "source-error");
  assert.equal(result.publishable, false);
  assert.equal(result.manifest, null);
});
