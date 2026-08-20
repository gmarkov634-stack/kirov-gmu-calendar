import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadConfig } from "../src/config.js";
import { getUniversityConfig } from "../src/universities/registry.mjs";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.resolve(
  apiRoot,
  process.env.CROSS_UNIVERSITY_HISTORICAL_REPORT || "data/regression/cross-university-historical-regression-report.json",
);
const omgmuReportPath = path.join(apiRoot, "data/regression/cross-university/omgmu-historical-regression-report.json");
const izhgmuReportPath = path.join(apiRoot, "data/imports/izhgmu-historical-regression-report.json");

const KGMU_BASELINE = Object.freeze({
  mode: "source-pinned-historical-network-regression",
  source: "https://kirovgma.ru/sites/default/files/files/2026/05/07/1097/2_stomat-07-05-2026-15.xlsx",
  program: "dentistry",
  course: 2,
  academicYear: "2025/26",
  semester: 2,
  classification: "S",
  eventCount: 830,
  sourceBlocks: 62,
  coveredSourceBlocks: 62,
  duplicateCount: 0,
  overlapCount: 13,
  digest: "2144bbbef763a295688fd6781ffdd1908d33074fd9c9ba76216e0104eaebc44b",
  groupCounts: { "291": 208, "292": 208, "293": 207, "294": 207 },
});

function runNode(relativeScript, extraEnv = {}) {
  const result = spawnSync(process.execPath, [relativeScript], {
    cwd: apiRoot,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error ? String(result.error.message || result.error) : null,
  };
}

function parseJsonObject(text) {
  const source = String(text || "").trim();
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function readJsonOrNull(filename) {
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch {
    return null;
  }
}

export function ugmuFailClosedBoundary() {
  const runtime = loadConfig({
    COMMERCIAL_SALES_ENABLED: "true",
    ENABLE_PUBLIC_ENDPOINTS: "true",
    TRIALS_ENABLED: "true",
    UGMU_SITE_URL: "https://must-not-open.example",
  });
  const university = getUniversityConfig("ugmu");
  const policy = runtime.universityAccess?.ugmu || {};
  const checks = {
    registryInactive: university.active === false,
    apiRoutingEnabled: policy.apiRoutingEnabled === true,
    publicEndpointsClosed: policy.publicEndpointsEnabled === false,
    checkoutClosed: policy.checkoutEnabled === false,
    trialsClosed: policy.trialsEnabled === false,
    paidRedirectBlank: runtime.universitySiteUrls?.ugmu === "",
  };
  return {
    university: "ugmu",
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

export function evaluateAggregate({ kgmu, omgmu, izhgmu, ugmuBoundary }) {
  const incumbentChecks = {
    kgmu: kgmu?.passed === true,
    omgmu: omgmu?.passed === true,
    izhgmu: izhgmu?.passed === true,
  };
  const allPassed = Object.values(incumbentChecks).every(Boolean) && ugmuBoundary?.passed === true;
  return {
    incumbentChecks,
    allPassed,
    status: allPassed ? "PASS" : "FAIL",
    launchAuthority: {
      productionPublicationAllowedByThisGate: false,
      productionSalesAllowedByThisGate: false,
      productionActivationAllowedByThisGate: false,
    },
    nextRequiredBoundary: allPassed ? "pages-build-deploy-gate" : "cross-university-historical-regression",
  };
}

function kgmuSummary(processResult) {
  const payload = parseJsonObject(processResult.stdout);
  const actual = payload?.qa || {};
  const checks = {
    processPassed: processResult.status === 0,
    payloadPass: payload?.status === "PASS",
    sourcePinned: payload?.source === KGMU_BASELINE.source,
    classificationStable: payload?.classification === KGMU_BASELINE.classification,
    eventCountStable: actual.eventCount === KGMU_BASELINE.eventCount,
    sourceBlocksStable: actual.sourceBlocks === KGMU_BASELINE.sourceBlocks,
    coveredSourceBlocksStable: actual.coveredSourceBlocks === KGMU_BASELINE.coveredSourceBlocks,
    duplicateCountStable: actual.duplicateCount === KGMU_BASELINE.duplicateCount,
    overlapCountStable: actual.overlapCount === KGMU_BASELINE.overlapCount,
    digestStable: payload?.digest === KGMU_BASELINE.digest,
    groupCountsStable: JSON.stringify(actual.groupCounts || {}) === JSON.stringify(KGMU_BASELINE.groupCounts),
  };
  return {
    university: "kgmu",
    mode: KGMU_BASELINE.mode,
    baseline: KGMU_BASELINE,
    actual: payload,
    checks,
    passed: Object.values(checks).every(Boolean),
    exitCode: processResult.status,
    error: processResult.error,
  };
}

function omgmuSummary(processResult, report) {
  const checks = {
    processPassed: processResult.status === 0,
    reportPresent: Boolean(report),
    statusPass: report?.status === "PASS",
    offline: report?.mode === "offline-historical-regression",
    profilesStable: report?.profileCount === 4,
    sourceAnchorsStable: report?.sourceAnchorCount === 5,
  };
  return {
    university: "omgmu",
    mode: report?.mode || "offline-historical-regression",
    report,
    checks,
    passed: Object.values(checks).every(Boolean),
    exitCode: processResult.status,
    error: processResult.error,
  };
}

function izhgmuSummary(processResult, report) {
  const baseline = report?.baseline || {};
  const scope = baseline.active_scope || {};
  const checks = {
    processPassed: processResult.status === 0,
    reportPresent: Boolean(report),
    statusPass: report?.status === "PASS",
    offline: report?.sourceMode === "offline_no_live_network",
    academicYearStable: baseline.academic_year === "2025/2026",
    semesterStable: baseline.semester === "spring",
    groupCountStable: scope.groups === 86,
    baseEventsStable: scope.base_events === 23000,
    semanticOverlapsStable: scope.semantic_overlaps_after_publication_policy === 0,
  };
  return {
    university: "izhgmu",
    mode: report?.sourceMode || "offline_no_live_network",
    report,
    checks,
    passed: Object.values(checks).every(Boolean),
    exitCode: processResult.status,
    error: processResult.error,
  };
}

export async function runCrossUniversityHistoricalRegression() {
  const startedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.mkdir(path.dirname(omgmuReportPath), { recursive: true });

  const kgmuProcess = runNode("tools/kgmu-verify-mixed.mjs");
  const omgmuProcess = runNode("tools/omgmu-historical-regression.mjs", {
    OMGMU_HISTORICAL_REPORT: path.relative(apiRoot, omgmuReportPath),
  });
  const izhgmuProcess = runNode("tools/izhgmu-historical-regression.mjs");

  const kgmu = kgmuSummary(kgmuProcess);
  const omgmu = omgmuSummary(omgmuProcess, await readJsonOrNull(omgmuReportPath));
  const izhgmu = izhgmuSummary(izhgmuProcess, await readJsonOrNull(izhgmuReportPath));
  const ugmuBoundary = ugmuFailClosedBoundary();
  const aggregate = evaluateAggregate({ kgmu, omgmu, izhgmu, ugmuBoundary });

  const report = {
    version: 1,
    subject: "ugmu-expansion",
    mode: "cross-university-historical-regression",
    startedAt,
    finishedAt: new Date().toISOString(),
    incumbents: { kgmu, omgmu, izhgmu },
    ugmuBoundary,
    ...aggregate,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Cross-university historical regression: ${report.status}`);
  console.log(`KGMU=${kgmu.passed ? "PASS" : "FAIL"}; OmGMU=${omgmu.passed ? "PASS" : "FAIL"}; IzhGMU=${izhgmu.passed ? "PASS" : "FAIL"}; UGMU fail-closed=${ugmuBoundary.passed ? "PASS" : "FAIL"}`);
  console.log(`Report: ${reportPath}`);
  if (!report.allPassed) process.exitCode = 1;
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runCrossUniversityHistoricalRegression().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
