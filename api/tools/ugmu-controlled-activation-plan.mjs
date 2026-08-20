import fs from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../src/config.js";

const apiDir = path.resolve(process.cwd());
const repoRoot = path.resolve(apiDir, "..");
const planPath = path.resolve(repoRoot, "universities/ugmu/controlled-activation-plan.json");
const registryPath = path.resolve(apiDir, "src/universities/registry.mjs");
const appPath = path.resolve(apiDir, "src/app.js");
const landingConfigPath = path.resolve(repoRoot, "site/ugmu/config.js");
const landingAppPath = path.resolve(repoRoot, "site/ugmu/app.js");
const packagePath = path.resolve(apiDir, "src/adapters/ugmu/publication-package.mjs");
const outputPath = path.resolve(apiDir, process.env.UGMU_CONTROLLED_ACTIVATION_PLAN_REPORT || "data/regression/ugmu-controlled-activation-plan-report.json");

const [plan, registry, app, landingConfig, landingApp, publicationPackage] = await Promise.all([
  fs.readFile(planPath, "utf8").then(JSON.parse),
  fs.readFile(registryPath, "utf8"),
  fs.readFile(appPath, "utf8"),
  fs.readFile(landingConfigPath, "utf8"),
  fs.readFile(landingAppPath, "utf8"),
  fs.readFile(packagePath, "utf8"),
]);

const expectedSha = "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8";
const expectedGroups = Array.from({ length: 12 }, (_, index) => `ОЛД ${101 + index}`);
const errors = [];
const checks = {};
function check(name, passed, detail) {
  checks[name] = { status: passed ? "PASS" : "FAIL", detail };
  if (!passed) errors.push(`${name}: ${detail}`);
}

const closedConfig = loadConfig({});
const globalOnlyConfig = loadConfig({ COMMERCIAL_SALES_ENABLED: "true" });
const ugmuOnlyConfig = loadConfig({ UGMU_SALES_ENABLED: "true" });
const stageBlock = plan.mandatoryPreactivationBlocks?.find((item) => item.id === "stage-first-stream-production-schedules");
const salesBlock = plan.mandatoryPreactivationBlocks?.find((item) => item.id === "isolate-global-sales-gate");
const isolationPhase = plan.phases?.find((item) => item.id === "deploy-isolation-guards");

check("scopeFrozen",
  plan.university === "ugmu"
    && plan.scope?.sourceSha256 === expectedSha
    && JSON.stringify(plan.scope?.groups) === JSON.stringify(expectedGroups),
  `groups=${plan.scope?.groups?.length}; sha=${plan.scope?.sourceSha256}`,
);
check("planHasNoLaunchAuthority",
  plan.authority?.automaticActivationAllowed === false
    && plan.authority?.activationPerformedByPlan === false
    && plan.authority?.productionMutationAllowedByPlan === false
    && plan.authority?.requiresExplicitLaunchAuthorization === true,
  JSON.stringify(plan.authority),
);
check("currentRegistryFailClosed",
  registry.includes('id: "ugmu"') && registry.includes('sitePath: "/ugmu/"') && /ugmu:[\s\S]*?active:\s*false/.test(registry),
  "UGMU registry active=false",
);
check("currentApiFailClosed",
  closedConfig.universityAccess?.ugmu?.apiRoutingEnabled === true
    && closedConfig.universityAccess?.ugmu?.publicEndpointsEnabled === false
    && closedConfig.universityAccess?.ugmu?.checkoutEnabled === false
    && closedConfig.universityAccess?.ugmu?.trialsEnabled === false
    && closedConfig.universitySiteUrls?.ugmu === ""
    && closedConfig.commercialSalesEnabled === false,
  "default runtime: routing=true; public=false; checkout=false; trials=false; paid URL blank; sales closed",
);
check("dedicatedSalesIsolationDeployed",
  app.includes('if (salesState(config) !== "open")')
    && app.includes('universityCapability(config, context.university, "checkoutEnabled")')
    && globalOnlyConfig.universityAccess?.ugmu?.checkoutEnabled === false
    && ugmuOnlyConfig.universityAccess?.ugmu?.checkoutEnabled === true
    && ugmuOnlyConfig.universityAccess?.kgmu?.checkoutEnabled === false
    && ugmuOnlyConfig.universityAccess?.omgmu?.checkoutEnabled === false
    && ugmuOnlyConfig.universityAccess?.izhgmu?.checkoutEnabled === false
    && salesBlock?.state === "completed"
    && String(salesBlock?.completion || "").includes("32424944030")
    && String(salesBlock?.completion || "").includes("2c3d6d63a6d8102c7f45dcba29619e75c5f991b760198bd770ca823f2e94faae")
    && isolationPhase?.state === "completed",
  "dedicated UGMU sales isolation is implemented and recorded as fail-closed deployed in production",
);
check("landingStillPreviewOnly",
  landingConfig.includes("previewOnly: true")
    && landingConfig.includes("checkoutEnabled: false")
    && landingConfig.includes("publicIcsEnabled: false")
    && !landingApp.includes("fetch("),
  "previewOnly=true; checkout=false; publicIcs=false; no fetch()",
);
check("firstStreamProductionStagingRecorded",
  publicationPackage.includes("fail-closed to ОЛД 101")
    && stageBlock?.state === "completed"
    && String(stageBlock?.completion || "").includes("32421951498")
    && String(stageBlock?.completion || "").includes("32421951401"),
  "12-group production staging and independent read-back are recorded as completed prerequisites",
);
check("publicIcsStaysClosedAtLaunch",
  plan.launchTarget?.publicEndpointsEnabled === false
    && plan.launchTarget?.publicIcsEnabled === false
    && plan.launchTarget?.trialsEnabled === false,
  "paid tokenized subscription launch does not expose free public schedule/ICS or trials",
);
check("rollbackClosesAccessBeforeData",
  plan.rollback?.strategy === "close-access-first-keep-data-inert"
    && plan.rollback?.dataDeletionRequired === false
    && Array.isArray(plan.rollback?.order)
    && plan.rollback.order.length >= 5
    && plan.rollback.order[0].includes("UGMU_SALES_ENABLED=false"),
  `rollbackSteps=${plan.rollback?.order?.length}; dataDeletionRequired=${plan.rollback?.dataDeletionRequired}`,
);

const allBlocks = Array.isArray(plan.mandatoryPreactivationBlocks) ? plan.mandatoryPreactivationBlocks : [];
const blockers = allBlocks
  .filter((item) => item.state !== "completed")
  .map((item) => ({ id: item.id, state: item.state, completion: item.completion }));
const completedBlocks = allBlocks
  .filter((item) => item.state === "completed")
  .map((item) => ({ id: item.id, state: item.state, completion: item.completion }));
const planValid = errors.length === 0;
const executableNow = planValid && blockers.length === 0;
const report = {
  version: 3,
  university: "ugmu",
  mode: "controlled-activation-plan-evidence-only",
  generatedAt: new Date().toISOString(),
  status: !planValid ? "PLAN_INVALID" : executableNow ? "READY_FOR_EXPLICIT_CONTROLLED_ACTIVATION" : "PREACTIVATION_WORK_REQUIRED",
  planValid,
  executableNow,
  activationPerformed: false,
  productionMutationPerformed: false,
  scope: plan.scope,
  launchTarget: plan.launchTarget,
  completedBlocks,
  blockers,
  blockerCount: blockers.length,
  phases: plan.phases,
  rollback: plan.rollback,
  checks,
  errors,
  nextRequiredBoundary: plan.nextRequiredBoundary,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`UGMU controlled activation plan: ${report.status}`);
console.log(`Checks: ${Object.values(checks).filter((item) => item.status === "PASS").length}/${Object.keys(checks).length} PASS`);
console.log(`Completed preactivation blocks: ${completedBlocks.length}`);
console.log(`Remaining preactivation blocks: ${blockers.length}`);
console.log("Activation performed: no");
console.log(`Next boundary: ${report.nextRequiredBoundary}`);
console.log(`Report: ${outputPath}`);
if (!planValid) process.exitCode = 2;
