import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const server = fs.readFileSync(path.resolve(here, "../src/server.js"), "utf8");

test("server wires write-only upper funnel analytics endpoint", () => {
  assert.match(server, /createFunnelEventHandler/);
  assert.match(server, /url\.pathname === "\/api\/v2\/analytics"/);
  assert.match(server, /return funnelEventHandler\(request, response\)/);
});
