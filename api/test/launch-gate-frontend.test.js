import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

async function text(name) {
  return fs.readFile(path.join(root, name), "utf8");
}

test("KGMU frontend commercial checkout is fail closed and server owned", async () => {
  const status = await text("program-status.js");
  const html = await text("index.html");

  assert.match(html, /program-status\.js[^>]*>[\s\S]*app-utils\.js[^>]*>[\s\S]*app\.js/);
  assert.match(status, /data\.offer\.sales\s*=\s*"closed"/);
  assert.match(status, /\/api\/v2\/meta/);
  assert.match(status, /body\?\.sales\s*===\s*"open"\s*\?\s*"open"\s*:\s*"closed"/);
  assert.match(status, /form\.hidden\s*=\s*!open/);
  assert.match(status, /event\.stopImmediatePropagation\(\)/);
  assert.match(status, /data\.offer\.sales\s*===\s*"open"/);
});

test("KGMU frontend payment mode follows safe API metadata instead of static launch configuration", async () => {
  const status = await text("program-status.js");
  assert.match(status, /body\?\.paymentMode\s*===\s*"test"\s*\|\|\s*body\?\.paymentMode\s*===\s*"live"/);
  assert.match(status, /data\.offer\.testMode\s*=\s*body\.paymentMode\s*===\s*"test"/);
});
