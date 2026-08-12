import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createOfferCatalogHandler } from "../src/offer-catalog.js";

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("offer catalog exposes only groups from the configured commercial period", () => {
  const calls = [];
  const handler = createOfferCatalogHandler({
    config: {
      allowedOrigin: "https://example.test",
      offerAcademicYear: "2026/27",
      offerSemester: 1,
    },
    store: {
      async listScheduleGroups(input) {
        calls.push(input);
        return [{ groupId: "kgmu:foreign:6:601и", groupCode: "601и", displayName: "Группа 601и", internal: "omit" }];
      },
    },
  });

  return withServer(handler, async (base) => {
    const response = await fetch(`${base}/api/v2/catalog/kgmu/foreign/6/groups?academicYear=2025/26&semester=2`, {
      headers: { Origin: "https://example.test" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://example.test");
    const body = await response.json();
    assert.equal(body.academicYear, "2026/27");
    assert.equal(body.semester, 1);
    assert.deepEqual(body.groups, [{ groupId: "kgmu:foreign:6:601и", groupCode: "601и", displayName: "Группа 601и" }]);
    assert.deepEqual(calls, [{
      university: "kgmu",
      program: "foreign",
      course: 6,
      academicYear: "2026/27",
      semester: 1,
    }]);
  });
});

test("offer catalog exposes one server-scoped program availability summary", () => {
  const calls = [];
  const handler = createOfferCatalogHandler({
    config: {
      allowedOrigin: "https://example.test",
      offerAcademicYear: "2026/27",
      offerSemester: 1,
    },
    store: {},
    listProgramAvailability: async (input) => {
      calls.push(input);
      return [
        { program: "medicine", courses: [2, 3] },
        { program: "pediatrics", courses: [1] },
      ];
    },
  });

  return withServer(handler, async (base) => {
    const response = await fetch(`${base}/api/v2/catalog/kgmu/programs?academicYear=2025/26&semester=2`, {
      headers: { Origin: "https://example.test" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=60");
    assert.deepEqual(await response.json(), {
      university: "kgmu",
      academicYear: "2026/27",
      semester: 1,
      programs: [
        { program: "medicine", courses: [2, 3] },
        { program: "pediatrics", courses: [1] },
      ],
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].university, "kgmu");
    assert.equal(calls[0].academicYear, "2026/27");
    assert.equal(calls[0].semester, 1);
  });
});

test("offer catalog rejects invalid course context", () => withServer(
  createOfferCatalogHandler({
    config: { offerAcademicYear: "2026/27", offerSemester: 1 },
    store: { listScheduleGroups: async () => [] },
  }),
  async (base) => {
    const response = await fetch(`${base}/api/v2/catalog/kgmu/foreign/99/groups`);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_catalog_context" });
  },
));
