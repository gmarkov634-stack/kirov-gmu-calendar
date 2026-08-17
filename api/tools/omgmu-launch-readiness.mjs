import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.resolve(
  apiDir,
  process.env.OMGMU_LAUNCH_READINESS_REPORT || "data/regression/omgmu-launch-readiness-report.json",
);
const historicalReportPath = path.resolve(
  apiDir,
  process.env.OMGMU_HISTORICAL_REPORT || "data/regression/omgmu-historical-regression-report.json",
);

const readinessTests = [
  "test/omgmu-main-merge-safety.test.js",
  "test/omgmu-commerce-live.test.js",
  "test/omgmu-watch-review-issue-workflow.test.js",
  "test/vk-omgmu-tenant-wiring.test.js",
];

const networklessEnv = {
  ...process.env,
  OMGMU_HISTORICAL_REPORT: historicalReportPath,
  HTTP_PROXY: "",
  HTTPS_PROXY: "",
  ALL_PROXY: "",
  http_proxy: "",
  https_proxy: "",
  all_proxy: "",
};

async function validateFiles(paths) {
  for (const relative of paths) {
    const absolute = path.resolve(apiDir, relative);
    if (!absolute.startsWith(`${path.join(apiDir, "test")}${path.sep}`)) {
      throw new Error(`Launch-readiness test escapes test directory: ${relative}`);
    }
    const stat = await fs.stat(absolute);
    if (!stat.isFile()) throw new Error(`Launch-readiness test is not a file: ${relative}`);
  }
}

async function readJson(filename) {
  try {
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch {
    return null;
  }
}

const startedAt = new Date().toISOString();
await validateFiles(readinessTests);

const historical = spawnSync(process.execPath, ["tools/omgmu-historical-regression.mjs"], {
  cwd: apiDir,
  stdio: "inherit",
  env: networklessEnv,
});

const contracts = spawnSync(process.execPath, ["--test", ...readinessTests], {
  cwd: apiDir,
  stdio: "inherit",
  env: networklessEnv,
});

const historicalReport = await readJson(historicalReportPath);
const historicalPass = historical.status === 0 && historicalReport?.status === "PASS";
const contractsPass = contracts.status === 0;
const structuralPass = historicalPass && contractsPass;

const report = {
  version: 1,
  university: "omgmu",
  mode: "offline-structural-launch-readiness",
  startedAt,
  finishedAt: new Date().toISOString(),
  status: structuralPass ? "STRUCTURALLY_READY_CURRENT_DATA_WAITING" : "STRUCTURAL_GAP",
  structuralReady: structuralPass,
  currentPeriod: {
    academicYear: "2026/2027",
    semester: "autumn",
    officialSourceRequired: true,
    status: "WAITING_FOR_OFFICIAL_SOURCE",
  },
  launchAuthority: {
    publicationAllowedByThisGate: false,
    salesAllowedByThisGate: false,
    trialsAllowedByThisGate: false,
    nextRequiredBoundary: "exact-source-sha-semantic-review",
  },
  checks: {
    historicalRegression: historicalPass ? "PASS" : "FAIL",
    historicalRegressionReport: path.relative(apiDir, historicalReportPath),
    structuralContracts: contractsPass ? "PASS" : "FAIL",
    structuralContractTests: readinessTests,
  },
};

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(`OmGMU launch readiness: ${report.status}`);
console.log(`Report: ${reportPath}`);
process.exit(structuralPass ? 0 : 1);
