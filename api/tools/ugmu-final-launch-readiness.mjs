import fs from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../src/config.js";
import { getUniversityConfig } from "../src/universities/registry.mjs";

const EXPECTED_SHA = "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8";
const EXPECTED_GROUPS = Array.from({ length: 12 }, (_, i) => `ОЛД ${101 + i}`);
const apiDir = path.resolve(process.cwd());
const rootDir = path.resolve(apiDir, "..");
const outputPath = path.resolve(apiDir, process.env.UGMU_FINAL_LAUNCH_READINESS_REPORT || "data/regression/ugmu-final-launch-readiness-report.json");
const productionBaseUrl = String(process.env.UGMU_PRODUCTION_BASE_URL || "https://kgmu-calendar-api.containerapps.ru").replace(/\/$/, "");
const siteOrigin = String(process.env.UGMU_SITE_ORIGIN || "https://gmarkov634-stack.github.io");

const files = {
  structural: path.resolve(apiDir, process.env.UGMU_STRUCTURAL_REPORT || "data/regression/ugmu-launch-readiness-report.json"),
  payment: path.resolve(apiDir, process.env.UGMU_PAYMENT_E2E_REPORT || "data/regression/ugmu-payment-e2e-report.json"),
  update: path.resolve(apiDir, process.env.UGMU_PURCHASED_UPDATE_E2E_REPORT || "data/regression/ugmu-purchased-update-e2e-report.json"),
  revoke: path.resolve(apiDir, process.env.UGMU_REVOKE_E2E_REPORT || "data/regression/ugmu-subscription-revoke-e2e-report.json"),
  cross: path.resolve(apiDir, process.env.CROSS_UNIVERSITY_HISTORICAL_REPORT || "data/regression/cross-university-historical-regression-report.json"),
  pagesConfig: path.resolve(rootDir, "dist/site/ugmu/config.js"),
  pagesHtml: path.resolve(rootDir, "dist/site/ugmu/index.html"),
  pagesApp: path.resolve(rootDir, "dist/site/ugmu/app.js"),
  deployWorkflow: path.resolve(rootDir, ".github/workflows/deploy-api-cloudru.yml"),
  pagesWorkflow: path.resolve(rootDir, ".github/workflows/omgmu-pages.yml"),
};

async function readJson(filename) {
  return JSON.parse(await fs.readFile(filename, "utf8"));
}
async function readText(filename) {
  return fs.readFile(filename, "utf8");
}
function addCheck(checks, errors, name, passed, detail) {
  checks[name] = { status: passed ? "PASS" : "FAIL", detail };
  if (!passed) errors.push(`${name}: ${detail}`);
}
async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { response, body };
}

const startedAt = new Date().toISOString();
const [structural, payment, update, revoke, cross, pagesConfig, pagesHtml, pagesApp, deployWorkflow, pagesWorkflow] = await Promise.all([
  readJson(files.structural), readJson(files.payment), readJson(files.update), readJson(files.revoke), readJson(files.cross),
  readText(files.pagesConfig), readText(files.pagesHtml), readText(files.pagesApp), readText(files.deployWorkflow), readText(files.pagesWorkflow),
]);

const university = getUniversityConfig("ugmu");
const config = loadConfig(process.env);
const access = config.universityAccess?.ugmu || {};
const checks = {};
const errors = [];

addCheck(checks, errors, "structuralReadiness",
  structural.structuralReady === true
    && structural.status === "STRUCTURALLY_READY_FIRST_STREAM_FAIL_CLOSED"
    && structural.scope?.sourceSha256 === EXPECTED_SHA
    && structural.scope?.groups?.length === 12
    && Object.values(structural.checks || {}).every((item) => item.status === "PASS"),
  `status=${structural.status}; checks=${Object.values(structural.checks || {}).filter((item) => item.status === "PASS").length}/${Object.keys(structural.checks || {}).length}`,
);
addCheck(checks, errors, "paymentE2E",
  payment.passed === true && payment.scope?.sourceSha256 === EXPECTED_SHA && payment.http?.checkoutStatus === 201 && payment.http?.webhookStatus === 200 && payment.http?.icsStatus === 200 && payment.payment?.externalRequests === 0,
  `passed=${payment.passed}; checkout=${payment.http?.checkoutStatus}; webhook=${payment.http?.webhookStatus}; ics=${payment.http?.icsStatus}`,
);
addCheck(checks, errors, "purchasedCalendarUpdateE2E",
  update.passed === true && update.scope?.sourceSha256 === EXPECTED_SHA && update.update?.subscriptionUrlStable === true && update.update?.targetInitialSequence === 0 && update.update?.targetUpdatedSequence === 1 && update.checks?.onePaymentOnly === true && update.checks?.noDuplicateVevent === true,
  `passed=${update.passed}; stableUrl=${update.update?.subscriptionUrlStable}; sequence=${update.update?.targetInitialSequence}->${update.update?.targetUpdatedSequence}`,
);
addCheck(checks, errors, "subscriptionRevokeE2E",
  revoke.passed === true && revoke.scope?.sourceSha256 === EXPECTED_SHA && revoke.http?.unauthorizedRevokeStatus === 403 && revoke.http?.authorizedRevokeStatus === 200 && revoke.http?.revokedAfterEvents === 0 && revoke.http?.otherAfterEvents === 2,
  `passed=${revoke.passed}; revoke=${revoke.http?.unauthorizedRevokeStatus}->${revoke.http?.authorizedRevokeStatus}; revokedEvents=${revoke.http?.revokedAfterEvents}; siblingEvents=${revoke.http?.otherAfterEvents}`,
);
addCheck(checks, errors, "crossUniversityHistoricalRegression",
  cross.status === "PASS" && cross.allPassed === true && Object.values(cross.incumbentChecks || {}).every(Boolean),
  `status=${cross.status}; allPassed=${cross.allPassed}`,
);

const pagesGroupsPresent = EXPECTED_GROUPS.every((group) => pagesConfig.includes(`code: "${group}"`));
const pagesSafe = pagesConfig.includes('university: "ugmu"')
  && pagesConfig.includes('paymentPath: "/api/v2/payments"')
  && pagesConfig.includes('defaultPlan: "semester"')
  && pagesConfig.includes(EXPECTED_SHA)
  && pagesGroupsPresent
  && !pagesConfig.includes("previewOnly")
  && !pagesConfig.includes("checkoutEnabled")
  && !pagesConfig.includes("publicIcsEnabled")
  && pagesHtml.includes('name="robots" content="noindex,follow"')
  && pagesHtml.includes('type="submit" disabled')
  && pagesApp.includes('/api/v2/meta')
  && pagesApp.includes('config.paymentPath')
  && pagesApp.includes('runtime.sales === "open"')
  && pagesApp.includes('runtime.paymentMode === "live"')
  && pagesApp.includes('confirmationUrl')
  && pagesApp.includes('order.subscriptionUrl')
  && !pagesApp.includes('/api/v2/catalog/ugmu')
  && !pagesApp.includes('/api/v2/schedules/ugmu');
addCheck(checks, errors, "productionIdenticalPagesArtifact", pagesSafe,
  `liveCheckoutPrepared=${pagesApp.includes('config.paymentPath')}; startsDisabled=${pagesHtml.includes('type="submit" disabled')}; liveModeRequired=${pagesApp.includes('runtime.paymentMode === "live"')}; groups=${pagesGroupsPresent ? 12 : 0}; noindex=true`,
);

const deploySafe = deployWorkflow.includes("workflow_run.head_branch == 'main'")
  && deployWorkflow.includes("git merge-base --is-ancestor")
  && deployWorkflow.includes("target_image=\"${IMAGE}@${digest}\"")
  && deployWorkflow.includes("protectedTemplateFingerprint")
  && deployWorkflow.includes("non-image production template drift detected")
  && pagesWorkflow.includes("if: github.event_name != 'pull_request'")
  && pagesWorkflow.includes("actions/deploy-pages");
addCheck(checks, errors, "deploymentContracts", deploySafe, `Cloud.ru immutable main-only and Pages deploy main-only=${deploySafe}`);

const failClosed = university.active === false
  && config.universitySiteUrls?.ugmu === ""
  && access.apiRoutingEnabled === true
  && access.publicEndpointsEnabled === false
  && access.checkoutEnabled === false
  && access.trialsEnabled === false;
addCheck(checks, errors, "productionConfigurationFailClosed", failClosed,
  `active=${university.active}; routing=${access.apiRoutingEnabled}; public=${access.publicEndpointsEnabled}; checkout=${access.checkoutEnabled}; trials=${access.trialsEnabled}; paidUrl=${JSON.stringify(config.universitySiteUrls?.ugmu)}`,
);

let production = { health: null, meta: null, cors: false, scheduleStatus: null, scheduleError: null, checkoutStatus: null, checkoutError: null };
try {
  const health = await fetchJson(`${productionBaseUrl}/health`);
  const meta = await fetchJson(`${productionBaseUrl}/api/v2/meta`);
  const cors = await fetch(`${productionBaseUrl}/api/v2/payments`, {
    method: "OPTIONS",
    headers: { Origin: siteOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    signal: AbortSignal.timeout(20000),
  });
  const groupId = encodeURIComponent("ugmu:medicine:1:stream-1:ОЛД 101");
  const schedule = await fetchJson(`${productionBaseUrl}/api/v2/schedules/ugmu/medicine/1/${groupId}/schedule?groupCode=${encodeURIComponent("ОЛД 101")}&stream=1`);
  const checkout = await fetchJson(`${productionBaseUrl}/api/v2/payments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ university_id: "ugmu", program: "medicine", course: 1, stream: "1", groupCode: "ОЛД 101", groupId: "ugmu:medicine:1:stream-1:ОЛД 101", email: "final-readiness@example.com", plan: "semester" }),
  });
  production = {
    health: health.body,
    meta: meta.body,
    cors: cors.headers.get("access-control-allow-origin") === siteOrigin,
    scheduleStatus: schedule.response.status,
    scheduleError: schedule.body?.error || null,
    checkoutStatus: checkout.response.status,
    checkoutError: checkout.body?.error || null,
  };
} catch (error) {
  production.error = String(error);
}
const liveSafe = production.health?.status === "ok"
  && production.health?.service === "medical-calendar-api"
  && production.meta?.sales === "closed"
  && production.meta?.trials === "closed"
  && production.cors === true
  && production.scheduleStatus === 404
  && production.scheduleError === "schedule_not_published"
  && production.checkoutStatus === 409
  && production.checkoutError === "sales_not_open";
addCheck(checks, errors, "liveCloudRuProductionSmoke", liveSafe,
  `health=${production.health?.status}; sales=${production.meta?.sales}; trials=${production.meta?.trials}; paymentMode=${production.meta?.paymentMode}; cors=${production.cors}; schedule=${production.scheduleStatus}/${production.scheduleError}; checkout=${production.checkoutStatus}/${production.checkoutError}`,
);

const launchReady = errors.length === 0;
const report = {
  version: 1,
  university: "ugmu",
  mode: "final-first-stream-launch-readiness",
  startedAt,
  finishedAt: new Date().toISOString(),
  status: launchReady ? "READY_FOR_CONTROLLED_LAUNCH_ACTIVATION_FAIL_CLOSED" : "NOT_READY_FOR_LAUNCH",
  launchReady,
  scope: { program: "medicine", course: 1, stream: "1", groups: EXPECTED_GROUPS, academicYear: "2026/2027", semester: 1, sourceSha256: EXPECTED_SHA },
  checks,
  production,
  launchAuthority: {
    controlledActivationEligible: launchReady,
    automaticActivationAllowed: false,
    activationPerformedByThisGate: false,
    publicationActivatedByThisGate: false,
    salesActivatedByThisGate: false,
    trialsActivatedByThisGate: false,
    catalogVisibilityActivatedByThisGate: false,
    nextRequiredBoundary: launchReady ? "validate-live-yookassa-mode" : "resolve-final-readiness-gaps",
  },
  evidence: Object.fromEntries(Object.entries(files).map(([key, value]) => [key, path.relative(rootDir, value)])),
  errors,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`UGMU final launch readiness: ${report.status}`);
console.log(`Checks: ${Object.values(checks).filter((item) => item.status === "PASS").length}/${Object.keys(checks).length} PASS`);
console.log(`Controlled activation eligible: ${report.launchAuthority.controlledActivationEligible}`);
console.log("Activation performed: no");
console.log(`Report: ${outputPath}`);
if (!launchReady) process.exitCode = 2;
