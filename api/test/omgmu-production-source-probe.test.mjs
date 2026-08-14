import assert from "node:assert/strict";
import test from "node:test";

test("production server can fetch official OmGMU 4th-course lectures PDF", async () => {
  const sourceUrl = "https://omsk-osma.ru/files/r/UU/bilingva/2026/zan/4lek.pdf";
  const endpoint = new URL("https://kgmu-calendar-api.containerapps.ru/api/v1/admin/omgmu/source-probe");
  endpoint.searchParams.set("url", sourceUrl);

  const response = await fetch(endpoint, { signal: AbortSignal.timeout(30000) });
  const bodyText = await response.text();
  console.log("OMGMU_SOURCE_PROBE_BEGIN");
  console.log(bodyText);
  console.log("OMGMU_SOURCE_PROBE_END");

  assert.equal(response.status, 200, bodyText);
  const body = JSON.parse(bodyText);
  assert.equal(body.status, "ok");
  assert.equal(body.httpStatus, 200);
  assert.equal(body.isPdf, true);
  assert.ok(body.bytes > 0);
  assert.match(body.sha256, /^[a-f0-9]{64}$/);
});
