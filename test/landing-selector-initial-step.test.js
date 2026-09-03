import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../landing/app.js", import.meta.url);

async function appText() {
  return readFile(appUrl, "utf8");
}

test("landing selector initializes at faculty step without a default faculty", async () => {
  const app = await appText();

  assert.match(app, /let view = "faculty";/);
  assert.match(app, /let selectedProgramId = null;/);
  assert.doesNotMatch(app, /let selectedProgramId = "medicine";/);
  assert.match(app, /function renderFaculties\(\) \{[\s\S]*selectedProgramId = null;/);
  assert.match(app, /catalog = loaded;\s*wireSelectorNavigation\(\);\s*renderFaculties\(\);/);
  assert.doesNotMatch(app, /wireSavedInitialCourseView/);
});
