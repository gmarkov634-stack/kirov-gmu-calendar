import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createHandler } from "../src/app.js";

async function withServer(config, callback) {
  const server = http.createServer(createHandler({ store: {}, config }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("meta keeps legacy trials state while exposing dedicated UGMU trial state", async () => {
  await withServer({
    trialsEnabled: false,
    ugmuTrialsEnabled: true,
    commercialSalesEnabled: false,
    yookassaTestMode: true,
  }, async (base) => {
    const response = await fetch(`${base}/api/v2/meta`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.trials, "closed");
    assert.deepEqual(body.universityTrials, { ugmu: "open" });
  });
});

test("meta reports dedicated UGMU trial gate closed by default", async () => {
  await withServer({
    trialsEnabled: false,
    ugmuTrialsEnabled: false,
    commercialSalesEnabled: false,
    yookassaTestMode: true,
  }, async (base) => {
    const response = await fetch(`${base}/api/v2/meta`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.trials, "closed");
    assert.deepEqual(body.universityTrials, { ugmu: "closed" });
  });
});
