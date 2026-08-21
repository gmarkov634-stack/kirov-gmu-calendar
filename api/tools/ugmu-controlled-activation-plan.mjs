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
const landingHtmlPath = path.resolve(repoRoot, "site/ugmu/index.html");
const packagePath = path.resolve(apiDir, "src/adapters/ugmu/publication-package.mjs");
const outputPath = path.resolve(apiDir, process.env.UGMU_CONTROLLED_ACTIVATION_PLAN_REPORT || "data/regression/ugmu-controlled-activation-plan-report.json");

const [plan, registry, app, landingConfig, landingApp, landingHtml, publicationPackage] = await Promise.all([
  fs.readFile(planPath, "utf8").then(JSON.parse),
  fs.readFile(registryPath, "utf8"),
  fs.readFile(appPath, "utf8"),
  fs.readFile(landingConfigPath, "utf8"),
  fs.readFile(landingAppPath, "utf8"),
  fs.readFile(landingHtmlPath, "utf8"),
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
const globalOnlyConfig = loadConfig({ COMMERCIAL_SALES_ENABLED: "true", UGMU_SITE_URL: "https://ugmu.example.test/" });
const ugmuOnlyConfig = loadConfig({ UGMU_SALES_ENABLED: "true", UGMU_SITE_URL: "https://ugmu.example.test/" });
const blocks = Object.fromEntries((plan.mandatoryPreactivationBlocks || []).map((item) => [item.id, item]));

check("scopeFrozen",
  plan.university === "ugmu" && plan.scope?.sourceSha256 === expectedSha && JSON.stringify(plan.scope?.groups) === JSON.stringify(expectedGroups),
  `groups=${plan.scope?.groups?.length}; sha=${plan.scope?.sourceSha256}`,
);
check("planAuthorityExplicitAndNonAutomatic",
  plan.authority?.automaticActivationAllowed === false
    && plan.authority?.activationPerformedByPlan === false
    && plan.authority?.productionMutationAllowedByPlan === false
    && plan.authority?.requiresExplicitLaunchAuthorization === true
    && plan.authority?.explicitLaunchAuthorizationReceived === true
    && plan.authority?.authorizationCommand === "Далее",
  JSON.stringify(plan.authority),
);
check("registryRuntimeOptIn",
  registry.includes('id: "ugmu"')
    && registry.includes('sitePath: "/ugmu/"')
    && registry.includes('active: process.env.UGMU_ACTIVE === "true"'),
  "UGMU stays inactive by default and requires exact UGMU_ACTIVE=true at runtime",
);
check("defaultRuntimeFailClosed",
  closedConfig.universityAccess?.ugmu?.apiRoutingEnabled === true
    && closedConfig.universityAccess?.ugmu?.publicEndpointsEnabled === false
    && closedConfig.universityAccess?.ugmu?.checkoutEnabled === false
    && closedConfig.universityAccess?.ugmu?.trialsEnabled === false
    && closedConfig.universitySiteUrls?.ugmu === ""
    && closedConfig.commercialSalesEnabled === false,
  "default runtime: routing=true; public=false; checkout=false; trials=false; paid URL blank; sales closed",
);
check("dedicatedSalesIsolation",
  app.includes('if (salesState(config) !== "open")')
    && app.includes('universityCapability(config, context.university, "checkoutEnabled")')
    && globalOnlyConfig.universityAccess?.ugmu?.checkoutEnabled === false
    && globalOnlyConfig.universitySiteUrls?.ugmu === ""
    && ugmuOnlyConfig.universityAccess?.ugmu?.checkoutEnabled === true
    && ugmuOnlyConfig.universityAccess?.kgmu?.checkoutEnabled === false
    && ugmuOnlyConfig.universityAccess?.omgmu?.checkoutEnabled === false
    && ugmuOnlyConfig.universityAccess?.izhgmu?.checkoutEnabled === false
    && ugmuOnlyConfig.universitySiteUrls?.ugmu === "https://ugmu.example.test/"
    && blocks["isolate-global-sales-gate"]?.state === "completed",
  "dedicated UGMU flag controls both tenant checkout and paid return URL without opening non-target tenants",
);
check("landingPreparedRuntimeGated",
  landingConfig.includes('paymentPath: "/api/v2/payments"')
    && landingConfig.includes('defaultPlan: "semester"')
    && !landingConfig.includes("previewOnly")
    && !landingConfig.includes("checkoutEnabled")
    && !landingConfig.includes("publicIcsEnabled")
    && landingApp.includes('/api/v2/meta')
    && landingApp.includes('runtime.sales === "open"')
    && landingApp.includes('runtime.paymentMode === "live"')
    && landingApp.includes('order.subscriptionUrl')
    && !landingApp.includes('/api/v2/catalog/ugmu')
    && !landingApp.includes('/api/v2/schedules/ugmu')
    && landingHtml.includes('type="submit" disabled')
    && landingHtml.includes('name="robots" content="noindex,follow"')
    && blocks["wire-live-ugmu-landing"]?.state === "completed",
  "source landing remains rollback-ready/noindex while launch deployment may transform its production copy after backend smoke",
);
check("firstStreamProductionStagingRecorded",
  publicationPackage.includes("fail-closed to ОЛД 101")
    && blocks["stage-first-stream-production-schedules"]?.state === "completed"
    && String(blocks["stage-first-stream-production-schedules"]?.completion || "").includes("32421951498")
    && String(blocks["stage-first-stream-production-schedules"]?.completion || "").includes("32421951401"),
  "12-group production staging and independent read-back are recorded",
);
check("liveYooKassaReadinessRecorded",
  blocks["validate-live-yookassa-mode"]?.state === "completed"
    && String(blocks["validate-live-yookassa-mode"]?.completion || "").includes("32433470703"),
  "Step 27 live provider proof is completed without a diagnostic payment",
);
check("publicIcsAndTrialsStayClosedAtLaunch",
  plan.launchTarget?.publicEndpointsEnabled === false
    && plan.launchTarget?.publicIcsEnabled === false
    && plan.launchTarget?.trialsEnabled === false
    && plan.launchTarget?.paymentMode === "live",
  "paid launch does not expose free public schedule/ICS or trials",
);
check("rollbackClosesAccessBeforeData",
  plan.rollback?.strategy === "close-access-first-keep-data-inert"
    && plan.rollback?.dataDeletionRequired === false
    && Array.isArray(plan.rollback?.order)
    && plan.rollback.order[0]?.includes("UGMU_SALES_ENABLED=false"),
  `rollbackSteps=${plan.rollback?.order?.length}; dataDeletionRequired=${plan.rollback?.dataDeletionRequired}`,
);

const allBlocks = Array.isArray(plan.mandatoryPreactivationBlocks) ? plan.mandatoryPreactivationBlocks : [];
const blockers = allBlocks.filter((item) => item.state !== "completed").map(({ id, state, completion }) => ({ id, state, completion }));
const completedBlocks = allBlocks.filter((item) => item.state === "completed").map(({ id, state, completion }) => ({ id, state, completion }));
const planValid = errors.length === 0;
const executableNow = planValid && blockers.length === 0 && plan.nextRequiredBoundary === "controlled-launch-activation";
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
