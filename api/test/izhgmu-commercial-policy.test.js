import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { createOfferCatalogHandler } from "../src/offer-catalog.js";
import { offerSku } from "../src/offer-sku.mjs";
import {
  catalogContextAllowed,
  universitySalesEnabled,
  universityTrialsEnabled,
} from "../src/university-commerce-policy.mjs";

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("IzhGMU stage I policy exposes only medicine courses 1-3 and keeps commerce closed", () => {
  assert.equal(catalogContextAllowed({ university: "izhgmu", program: "medicine", course: 1 }), true);
  assert.equal(catalogContextAllowed({ university: "izhgmu", program: "medicine", course: 3 }), true);
  assert.equal(catalogContextAllowed({ university: "izhgmu", program: "medicine", course: 4 }), false);
  assert.equal(catalogContextAllowed({ university: "izhgmu", program: "pediatrics", course: 1 }), false);
  assert.equal(catalogContextAllowed({ university: "izhgmu", program: "dentistry", course: 1 }), false);
  assert.equal(universitySalesEnabled("izhgmu"), false);
  assert.equal(universityTrialsEnabled("izhgmu"), false);

  assert.equal(universitySalesEnabled("kgmu"), true);
  assert.equal(universityTrialsEnabled("kgmu"), true);
  assert.equal(universitySalesEnabled("omgmu"), true);
  assert.equal(universityTrialsEnabled("omgmu"), true);
});

test("IzhGMU backend owns stable offer SKU identity", () => {
  assert.equal(offerSku({ university: "izhgmu", program: "medicine" }, "semester"), "calendar:izhgmu:medicine:semester");
  assert.equal(offerSku({ university: "izhgmu", program: "medicine" }, "year"), "calendar:izhgmu:medicine:year");
  assert.equal(offerSku({ university: "izhgmu", program: "medicine" }, "unknown"), "");
});

test("IzhGMU live catalog filters deferred scope and reports tenant gates closed", async () => {
  let groupReads = 0;
  const handler = createOfferCatalogHandler({
    store: {
      async listScheduleGroups() {
        groupReads += 1;
        return [{ groupId: "izhgmu:medicine:1:101", groupCode: "101", displayName: "Группа 101" }];
      },
    },
    config: {
      offerAcademicYear: "2026/27",
      offerSemester: 1,
      commercialSalesEnabled: true,
      trialsEnabled: true,
    },
    async listProgramAvailability() {
      return [
        { program: "medicine", courses: [1, 2, 3, 4, 5, 6] },
        { program: "pediatrics", courses: [1] },
        { program: "dentistry", courses: [1] },
      ];
    },
  });

  await withServer(handler, async (base) => {
    const programsResponse = await fetch(`${base}/api/v2/catalog/izhgmu/programs`);
    assert.equal(programsResponse.status, 200);
    const programs = await programsResponse.json();
    assert.equal(programs.commercial, "closed");
    assert.equal(programs.trials, "closed");
    assert.deepEqual(programs.programs, [{
      program: "medicine",
      courses: [1, 2, 3],
      offers: {
        semester: { sku: "calendar:izhgmu:medicine:semester" },
        year: { sku: "calendar:izhgmu:medicine:year" },
      },
    }]);

    const deferredResponse = await fetch(`${base}/api/v2/catalog/izhgmu/medicine/4/groups`);
    assert.equal(deferredResponse.status, 404);
    assert.deepEqual(await deferredResponse.json(), { error: "catalog_not_available" });
    assert.equal(groupReads, 0);

    const liveResponse = await fetch(`${base}/api/v2/catalog/izhgmu/medicine/1/groups`);
    assert.equal(liveResponse.status, 200);
    const live = await liveResponse.json();
    assert.equal(live.commercial, "closed");
    assert.equal(live.trials, "closed");
    assert.deepEqual(live.groups, [{
      groupId: "izhgmu:medicine:1:101",
      groupCode: "101",
      displayName: "Группа 101",
    }]);
    assert.equal(groupReads, 1);
  });
});
