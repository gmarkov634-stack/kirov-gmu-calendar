import assert from "node:assert/strict";
import test from "node:test";

test("production OmGMU source probe returns raw verified PDF", async () => {
  const source = encodeURIComponent("https://omsk-osma.ru/files/r/UU/bilingva/2026/zan/4lek.pdf");
  const url = `https://kgmu-calendar-api.containerapps.ru/api/v1/admin/omgmu/source-probe?url=${source}&format=pdf`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const contentType = response.headers.get("content-type") || "";
  const body = Buffer.from(await response.arrayBuffer());
  console.log("OMGMU_PROD_PDF_PROXY", JSON.stringify({ status: response.status, contentType, bytes: body.length, magic: body.subarray(0, 5).toString("ascii") }));
  assert.equal(response.status, 200);
  assert.match(contentType, /^application\/pdf(?:;|$)/i);
  assert.equal(body.subarray(0, 5).toString("ascii"), "%PDF-");
});
