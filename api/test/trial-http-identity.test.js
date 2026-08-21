import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { createTrialHttpHandler } from "../src/trial-http-handler.js";

const SECRET = "trial-http-identity-secret-32-bytes-minimum";

function request(body, headers = {}) {
  const value = Readable.from([JSON.stringify(body)]);
  value.method = "POST";
  value.url = "/api/v2/trials";
  value.headers = {
    "x-forwarded-for": "198.51.100.7",
    "user-agent": "TrialHttpTest/1.0",
    "accept-language": "ru-RU",
    ...headers,
  };
  value.socket = { remoteAddress: "10.0.0.7" };
  return value;
}

function response() {
  return {
    headers: {},
    status: null,
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers = {}) {
      this.status = status;
      Object.assign(this.headers, headers);
    },
    end(body = "") {
      this.body = body;
    },
  };
}

test("trial HTTP handler passes only an opaque request identity to the service", async () => {
  let captured;
  const trials = {
    async create(input, meta) {
      captured = { input, meta };
      return { status: "active" };
    },
  };
  const handler = createTrialHttpHandler({
    store: {},
    config: { trialIdentityHmacSecret: SECRET, allowedOrigins: [] },
    trials,
  });
  const res = response();

  assert.equal(await handler.handleApi(request({ university: "ugmu" }), res), true);
  assert.equal(res.status, 201);
  assert.deepEqual(captured.input, { university: "ugmu" });
  assert.match(captured.meta.identityHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(captured.meta).includes("198.51.100.7"), false);
  assert.equal(JSON.stringify(captured.meta).includes("TrialHttpTest"), false);
});

test("trial HTTP handler returns conflict for an already claimed anonymous trial", async () => {
  const error = new Error("duplicate");
  error.code = "trial_already_claimed";
  const handler = createTrialHttpHandler({
    store: {},
    config: { trialIdentityHmacSecret: SECRET, allowedOrigins: [] },
    trials: { async create() { throw error; } },
  });
  const res = response();

  assert.equal(await handler.handleApi(request({ university: "ugmu" }), res), true);
  assert.equal(res.status, 409);
  assert.deepEqual(JSON.parse(res.body), { error: "trial_already_claimed" });
});
