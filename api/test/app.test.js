import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createHandler } from "../src/app.js";

const config = {
  allowedOrigin: "https://gmarkov634-stack.github.io",
  publicSiteUrl: "https://gmarkov634-stack.github.io/kirov-gmu-calendar/",
};
const store = {
  listGroups: () => [{ group: "132", faculty: "pediatrics", course: 1 }],
  get: async (group) => group === "132" ? { group, events: [] } : null,
};

async function withServer(callback) {
  const server = http.createServer(createHandler({ store, config }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("health endpoint responds", () => withServer(async (base) => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "kgmu-calendar-api" });
}));

test("schedule endpoint returns configured group", () => withServer(async (base) => {
  const response = await fetch(`${base}/api/v1/groups/132/schedule`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.group, "132");
  assert.match(body.disclaimer, /официальному расписанию/);
}));
