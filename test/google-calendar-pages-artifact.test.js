import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Pages artifact includes Google management UX without enabling it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "kgmu-google-pages-"));
  try {
    const result = spawnSync("sh", ["deploy/build-pages.sh", directory], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const html = await readFile(join(directory, "manage", "index.html"), "utf8");
    const googleModule = await readFile(join(directory, "manage", "google-calendar.js"), "utf8");
    const pagesConfig = await readFile(join(directory, "runtime-config.js"), "utf8");

    assert.match(html, /\.\/google-calendar\.js/);
    assert.match(googleModule, /googleCalendarEnabled: false/);
    assert.doesNotMatch(pagesConfig, /googleCalendarEnabled\s*:\s*true/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
