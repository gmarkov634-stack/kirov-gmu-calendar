import assert from "node:assert/strict";
import test from "node:test";
import {
  createOfferCatalogHandler,
  isRegisteredUniversityCatalogDisabled,
} from "../src/offer-catalog.js";

function createResponse() {
  return {
    headers: {},
    status: null,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers = {}) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    end(body = "") {
      this.body = body ? JSON.parse(body) : null;
    },
  };
}

function createRequest(url) {
  return {
    method: "GET",
    url,
    headers: {},
  };
}

const config = {
  offerAcademicYear: "2026/27",
  offerSemester: 1,
  allowedOrigins: [],
};

test("public catalog gate is independent from the university active state", () => {
  assert.equal(isRegisteredUniversityCatalogDisabled("izhgmu"), true);
  assert.equal(isRegisteredUniversityCatalogDisabled("omgmu"), false);
  assert.equal(isRegisteredUniversityCatalogDisabled("kgmu"), false);
  assert.equal(isRegisteredUniversityCatalogDisabled("kirov"), false);
});

test("IzhGMU program catalog is blocked before availability lookup", async () => {
  let availabilityCalls = 0;
  const handler = createOfferCatalogHandler({
    store: {},
    config,
    listProgramAvailability: async () => {
      availabilityCalls += 1;
      return [];
    },
  });
  const response = createResponse();

  await handler(createRequest("/api/v2/catalog/izhgmu/programs"), response);

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    error: "catalog_not_available",
    university: "izhgmu",
    available: false,
  });
  assert.equal(availabilityCalls, 0);
});

test("IzhGMU group catalog is blocked before schedule storage lookup", async () => {
  let storageCalls = 0;
  const handler = createOfferCatalogHandler({
    store: {
      async listScheduleGroups() {
        storageCalls += 1;
        return [];
      },
    },
    config,
  });
  const response = createResponse();

  await handler(createRequest("/api/v2/catalog/izhgmu/medicine/1/groups"), response);

  assert.equal(response.status, 404);
  assert.equal(storageCalls, 0);
});

test("legacy Kirov catalog behavior is preserved", async () => {
  let availabilityCalls = 0;
  const handler = createOfferCatalogHandler({
    store: {},
    config,
    listProgramAvailability: async ({ university }) => {
      availabilityCalls += 1;
      assert.equal(university, "kirov");
      return [{ program: "medicine", available: true }];
    },
  });
  const response = createResponse();

  await handler(createRequest("/api/v2/catalog/kirov/programs"), response);

  assert.equal(response.status, 200);
  assert.equal(availabilityCalls, 1);
  assert.equal(response.body.university, "kirov");
});
