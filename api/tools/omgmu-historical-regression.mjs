import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(apiDir, "test/fixtures/omgmu-historical-regression.v1.json");
const reportPath = path.resolve(apiDir, process.env.OMGMU_HISTORICAL_REPORT || "data/regression/omgmu-historical-regression-report.json");
const SHA_RE = /^[a-f0-9]{64}$/;

function fail(message) {
  const error = new Error(message);
  error.code = "OMGMU_HISTORICAL_REGRESSION_INVALID";
  throw error;
}

function collectTests(manifest) {
  const tests = [];
  for (const profile of manifest.profiles || []) for (const test of profile.tests || []) tests.push(test);
  for (const test of manifest.failClosedTests || []) tests.push(test);
  for (const test of manifest.sharedCoreTests || []) tests.push(test);
  return [...new Set(tests)];
}

function collectShas(manifest) {
  const values = [];
  for (const profile of manifest.profiles || []) {
    if (profile.sourceSha256) values.push(profile.sourceSha256);
    for (const anchor of profile.anchors || []) if (anchor.sourceSha256) values.push(anchor.sourceSha256);
  }
  return values;
}

async function validateManifest(manifest) {
  if (manifest?.version !== 1 || manifest?.university !== "omgmu" || manifest?.purpose !== "immutable-historical-regression") {
    fail("Unexpected historical regression manifest identity");
  }
  if (manifest.network !== "forbidden") fail("Historical regression must explicitly forbid network access");
  const profiles = manifest.profiles || [];
  const profileNames = profiles.map((item) => item.profile);
  const requiredProfiles = ["course_lecture_list", "weekly_grid", "cycle_rotation_grid", "combined_rotation_table"];
  if (profiles.length !== requiredProfiles.length || requiredProfiles.some((name) => !profileNames.includes(name))) {
    fail("Historical regression must contain exactly the four approved ОмГМУ profiles");
  }
  const shas = collectShas(manifest);
  if (shas.length !== 5 || shas.some((sha) => !SHA_RE.test(String(sha)))) fail("Historical source SHA matrix is incomplete or invalid");
  if (new Set(shas).size !== shas.length) fail("Historical source SHA matrix contains duplicates");

  const tests = collectTests(manifest);
  const forbidden = new Set(manifest.forbiddenTests || []);
  for (const test of tests) {
    if (forbidden.has(test)) fail(`Network/live test is forbidden in historical gate: ${test}`);
    const absolute = path.resolve(apiDir, test);
    if (!absolute.startsWith(`${path.join(apiDir, "test")}${path.sep}`)) fail(`Historical test escapes test directory: ${test}`);
    try {
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) fail(`Historical test is not a file: ${test}`);
    } catch {
      fail(`Historical test is missing: ${test}`);
    }
  }
  return tests;
}

const startedAt = new Date().toISOString();
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const tests = await validateManifest(manifest);
const result = spawnSync(process.execPath, ["--test", ...tests], {
  cwd: apiDir,
  stdio: "inherit",
  env: {
    ...process.env,
    // The curated suite is fixture-only. Proxies are removed as a second guard
    // against accidental network use in future test changes.
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    http_proxy: "",
    https_proxy: "",
    all_proxy: "",
  },
});

const report = {
  version: 1,
  university: "omgmu",
  mode: "offline-historical-regression",
  manifest: path.relative(apiDir, manifestPath),
  startedAt,
  finishedAt: new Date().toISOString(),
  profileCount: manifest.profiles.length,
  sourceAnchorCount: collectShas(manifest).length,
  testFileCount: tests.length,
  tests,
  status: result.status === 0 ? "PASS" : "FAIL",
  exitCode: result.status ?? 1,
};
await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Historical regression: ${report.status}; ${report.profileCount} profiles; ${report.sourceAnchorCount} source anchors; ${report.testFileCount} test files`);
console.log(`Report: ${reportPath}`);
process.exit(report.exitCode);
