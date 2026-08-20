import fs from "node:fs/promises";
import path from "node:path";

import { getUgmuSourcePage, UGMU_SOURCE_POLICY } from "../src/adapters/ugmu/source-registry.mjs";
import { loadConfig } from "../src/config.js";
import { getUniversityConfig } from "../src/universities/registry.mjs";

const EXPECTED_SHA = "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8";
const EXPECTED_GROUPS = Array.from({ length: 12 }, (_, index) => `ОЛД ${101 + index}`);

const apiDir = path.resolve(process.cwd());
const reportPath = path.resolve(apiDir, process.env.UGMU_LAUNCH_READINESS_REPORT || "data/regression/ugmu-launch-readiness-report.json");
const sourceWatchReportPath = path.resolve(apiDir, process.env.UGMU_SOURCE_WATCH_REPORT || "data/imports/ugmu-readiness/source-watch-report.json");
const firstStreamQaPath = path.resolve(apiDir, process.env.UGMU_FIRST_STREAM_QA_REPORT || "data/imports/ugmu-readiness/qa/first-stream-qa.json");
const firstStreamRegressionPath = path.resolve(apiDir, process.env.UGMU_FIRST_STREAM_REGRESSION_REPORT || "data/imports/ugmu-readiness/regression/first-stream-regression.json");
const fixturePath = path.resolve(apiDir, process.env.UGMU_FIRST_STREAM_FIXTURE || "test/fixtures/ugmu/first-stream-2026-autumn.json");
const watchConfigPath = path.resolve(apiDir, process.env.UGMU_SOURCE_WATCH_CONFIG || "../universities/ugmu/source-watch.json");

async function readJson(filename) {
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch (error) {
    return { __readError: `${error}` };
  }
}

function addCheck(checks, errors, name, passed, detail) {
  checks[name] = { status: passed ? "PASS" : "FAIL", detail };
  if (!passed) errors.push(`${name}: ${detail}`);
}

const startedAt = new Date().toISOString();
const [watchConfig, watchReport, firstStreamQa, regression, fixture] = await Promise.all([
  readJson(watchConfigPath),
  readJson(sourceWatchReportPath),
  readJson(firstStreamQaPath),
  readJson(firstStreamRegressionPath),
  readJson(fixturePath),
]);

const university = getUniversityConfig("ugmu");
const medicineSource = getUgmuSourcePage("medicine");
const runtimeConfig = loadConfig(process.env);
const checks = {};
const errors = [];

addCheck(checks, errors, "registryIdentity",
  university.id === "ugmu" && university.shortName === "УГМУ" && university.timeMode === "floating",
  `id=${university.id}; shortName=${university.shortName}; timeMode=${university.timeMode}`,
);
addCheck(checks, errors, "registryFailClosed", university.active === false, `active=${university.active}`);
addCheck(checks, errors, "paidRedirectFailClosed", runtimeConfig.universitySiteUrls?.ugmu === "", `UGMU site URL=${JSON.stringify(runtimeConfig.universitySiteUrls?.ugmu)}`);
addCheck(checks, errors, "sourceRegistry",
  Boolean(medicineSource?.initialScope)
    && university.source?.adapter === "ugmu"
    && university.source?.primaryPage === medicineSource?.page
    && UGMU_SOURCE_POLICY.semanticReviewRequired === true
    && JSON.stringify(UGMU_SOURCE_POLICY.versionIdentity) === JSON.stringify(["source_page", "source_url", "sha256"]),
  `medicine=${medicineSource?.page || "missing"}`,
);
addCheck(checks, errors, "watchPolicy",
  watchConfig.university === "ugmu"
    && watchConfig.program === "medicine"
    && watchConfig.expectedAcademicYear === "2026/2027"
    && watchConfig.expectedSemester === "autumn"
    && watchConfig.semanticReviewRequired === true
    && watchConfig.autoPublish === false,
  `autoPublish=${watchConfig.autoPublish}; semanticReviewRequired=${watchConfig.semanticReviewRequired}`,
);

const firstStreamSource = Array.isArray(watchReport.candidates)
  ? watchReport.candidates.find((item) => item.course === 1 && String(item.stream) === "1" && item.part === "combined")
  : null;
addCheck(checks, errors, "sourceWatch",
  watchReport.university === "ugmu"
    && watchReport.expectedAcademicYear === "2026/2027"
    && watchReport.expectedSemester === "autumn"
    && watchReport.failedCount === 0
    && watchReport.unresolvedCount === 0
    && watchReport.semanticReviewRequired === true
    && watchReport.autoPublish === false
    && watchReport.publicationAllowed === false
    && Boolean(firstStreamSource),
  `status=${watchReport.status}; candidates=${watchReport.candidateCount}; failed=${watchReport.failedCount}; unresolved=${watchReport.unresolvedCount}`,
);
addCheck(checks, errors, "exactSourceSha",
  firstStreamSource?.sha256 === EXPECTED_SHA && fixture.sourceSha256 === EXPECTED_SHA,
  `watch=${firstStreamSource?.sha256 || "missing"}; fixture=${fixture.sourceSha256 || "missing"}`,
);

const qaGroups = Array.isArray(firstStreamQa.groups) ? firstStreamQa.groups.map((item) => item.group).sort((a, b) => a.localeCompare(b, "ru", { numeric: true })) : [];
addCheck(checks, errors, "firstStreamQa",
  firstStreamQa.allApproved === true
    && firstStreamQa.crossGroupPassed === true
    && firstStreamQa.publicationAllowed === false
    && firstStreamQa.sourceSha256 === EXPECTED_SHA
    && firstStreamQa.totals?.groups === 12
    && firstStreamQa.totals?.patterns === 276
    && firstStreamQa.totals?.events === 4286
    && firstStreamQa.totals?.lectures === 1344
    && JSON.stringify(qaGroups) === JSON.stringify(EXPECTED_GROUPS),
  `approved=${firstStreamQa.allApproved}; groups=${firstStreamQa.totals?.groups}; events=${firstStreamQa.totals?.events}`,
);

addCheck(checks, errors, "regressionFixtures",
  regression.passed === true
    && regression.publicationAllowed === false
    && regression.sourceSha256 === EXPECTED_SHA
    && regression.totals?.groups === 12
    && regression.totals?.events === 4286
    && regression.totals?.fixtureControls === 36
    && regression.totals?.specialControls === 3,
  `passed=${regression.passed}; controls=${regression.totals?.fixtureControls}+${regression.totals?.specialControls}`,
);
addCheck(checks, errors, "stableUidSequence",
  regression.totals?.exactUnchanged === 4286
    && regression.totals?.simulatedChanged === 12
    && regression.totals?.simulatedUnchanged === 4274
    && regression.totals?.stableUidGroups === 12
    && regression.totals?.sequenceAdvancedGroups === 12,
  `unchanged=${regression.totals?.exactUnchanged}; changed=${regression.totals?.simulatedChanged}; stableUid=${regression.totals?.stableUidGroups}; sequence=${regression.totals?.sequenceAdvancedGroups}`,
);

const fixtureGroups = Array.isArray(fixture.groups) ? fixture.groups.map((item) => item.group).sort((a, b) => a.localeCompare(b, "ru", { numeric: true })) : [];
addCheck(checks, errors, "fixtureScope",
  fixture.university === "ugmu"
    && fixture.program === "medicine"
    && fixture.course === 1
    && String(fixture.stream) === "1"
    && JSON.stringify(fixtureGroups) === JSON.stringify(EXPECTED_GROUPS),
  `fixture groups=${fixtureGroups.length}`,
);

const failClosed = university.active === false
  && runtimeConfig.universitySiteUrls?.ugmu === ""
  && watchConfig.autoPublish === false
  && watchReport.publicationAllowed === false
  && firstStreamQa.publicationAllowed === false
  && regression.publicationAllowed === false;
addCheck(checks, errors, "commercialPublicationBoundary", failClosed, `failClosed=${failClosed}`);

const structuralReady = errors.length === 0;
const report = {
  version: 1,
  university: "ugmu",
  mode: "live-source-structural-readiness",
  startedAt,
  finishedAt: new Date().toISOString(),
  status: structuralReady ? "STRUCTURALLY_READY_FIRST_STREAM_FAIL_CLOSED" : "STRUCTURAL_GAP",
  structuralReady,
  scope: {
    program: "medicine",
    course: 1,
    stream: "1",
    groups: EXPECTED_GROUPS,
    academicYear: "2026/2027",
    semester: "autumn",
    sourceSha256: EXPECTED_SHA,
  },
  sourceState: {
    watchStatus: watchReport.status || null,
    availableCourses: watchReport.availableCourses || [],
    missingCourses: watchReport.missingCourses || [],
    firstStreamCaptured: Boolean(firstStreamSource),
  },
  launchAuthority: {
    publicationAllowedByThisGate: false,
    salesAllowedByThisGate: false,
    trialsAllowedByThisGate: false,
    catalogVisibilityAllowedByThisGate: false,
    nextRequiredBoundary: "api-university-id-ugmu",
  },
  checks,
  evidence: {
    sourceWatchReport: path.relative(apiDir, sourceWatchReportPath),
    firstStreamQaReport: path.relative(apiDir, firstStreamQaPath),
    firstStreamRegressionReport: path.relative(apiDir, firstStreamRegressionPath),
    fixture: path.relative(apiDir, fixturePath),
    watchConfig: path.relative(apiDir, watchConfigPath),
  },
  errors,
};

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`UGMU structural readiness: ${report.status}`);
console.log(`Checks: ${Object.values(checks).filter((item) => item.status === "PASS").length}/${Object.keys(checks).length} PASS`);
console.log("Publication/sales/trials/catalog visibility allowed by this gate: no");
console.log(`Next boundary: ${report.launchAuthority.nextRequiredBoundary}`);
console.log(`Report: ${reportPath}`);
if (!structuralReady) {
  for (const error of errors) console.error(error);
  process.exitCode = 2;
}
