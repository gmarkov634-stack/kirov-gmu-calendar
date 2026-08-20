import fs from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../src/config.js";
import { listUniversities } from "../src/universities/registry.mjs";

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    const match = token.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

function checkoutMatrix(config) {
  return Object.fromEntries(
    listUniversities().map((university) => [
      university.id,
      config.universityAccess?.[university.id]?.checkoutEnabled === true,
    ]),
  );
}

function assertCheck(checks, name, value) {
  checks[name] = Boolean(value);
  if (!checks[name]) throw new Error(`UGMU sales isolation check failed: ${name}`);
}

const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(args.report || "data/regression/ugmu-sales-isolation-report.json");
const registered = listUniversities().map((item) => item.id).sort();

const closed = loadConfig({});
const globalOnly = loadConfig({ COMMERCIAL_SALES_ENABLED: "true" });
const ugmuOnly = loadConfig({ UGMU_SALES_ENABLED: "true" });
const both = loadConfig({ COMMERCIAL_SALES_ENABLED: "true", UGMU_SALES_ENABLED: "true" });
const globalFlagAttack = loadConfig({
  COMMERCIAL_SALES_ENABLED: "true",
  ENABLE_PUBLIC_ENDPOINTS: "true",
  TRIALS_ENABLED: "true",
  UGMU_SITE_URL: "https://must-not-open.example",
});

const matrices = {
  closed: checkoutMatrix(closed),
  globalOnly: checkoutMatrix(globalOnly),
  ugmuOnly: checkoutMatrix(ugmuOnly),
  both: checkoutMatrix(both),
};
const checks = {};

assertCheck(checks, "allRegisteredTenantsHaveExplicitCheckoutPolicy",
  registered.every((id) => Object.hasOwn(closed.universityAccess?.[id] || {}, "checkoutEnabled")));
assertCheck(checks, "defaultFailClosed", closed.commercialSalesEnabled === false && Object.values(matrices.closed).every((value) => value === false));
assertCheck(checks, "legacyGlobalBehaviorPreserved",
  globalOnly.globalCommercialSalesEnabled === true &&
  globalOnly.ugmuSalesEnabled === false &&
  matrices.globalOnly.kgmu === true &&
  matrices.globalOnly.omgmu === true &&
  matrices.globalOnly.izhgmu === false &&
  matrices.globalOnly.ugmu === false);
assertCheck(checks, "ugmuCanOpenWithoutLegacyGlobalGate",
  ugmuOnly.globalCommercialSalesEnabled === false &&
  ugmuOnly.ugmuSalesEnabled === true &&
  ugmuOnly.commercialSalesEnabled === true &&
  matrices.ugmuOnly.ugmu === true);
assertCheck(checks, "ugmuOnlyModeDoesNotOpenOtherTenants",
  matrices.ugmuOnly.kgmu === false &&
  matrices.ugmuOnly.omgmu === false &&
  matrices.ugmuOnly.izhgmu === false);
assertCheck(checks, "globalGateCannotOpenUgmu",
  matrices.globalOnly.ugmu === false);
assertCheck(checks, "bothFlagsRemainTenantScoped",
  matrices.both.kgmu === true &&
  matrices.both.omgmu === true &&
  matrices.both.izhgmu === false &&
  matrices.both.ugmu === true);
assertCheck(checks, "ugmuPublicAndTrialsStayClosed",
  globalFlagAttack.universityAccess.ugmu.publicEndpointsEnabled === false &&
  globalFlagAttack.universityAccess.ugmu.trialsEnabled === false);
assertCheck(checks, "ugmuPaidRedirectStaysClosed", globalFlagAttack.universitySiteUrls.ugmu === "");

const report = {
  version: 1,
  kind: "ugmu-commercial-sales-isolation-gate",
  status: "PASS",
  passed: true,
  registeredTenants: registered,
  dedicatedFlag: "UGMU_SALES_ENABLED",
  legacyGlobalFlag: "COMMERCIAL_SALES_ENABLED",
  checkoutMatrices: matrices,
  checks,
  safety: {
    registryActiveChanged: false,
    catalogChanged: false,
    publicEndpointsChanged: false,
    trialsChanged: false,
    paidSiteUrlChanged: false,
    storageMutationPerformed: false,
    cloudruMutationPerformed: false,
    pagesDeployPerformed: false,
    salesActivationPerformed: false,
  },
  launchAuthority: {
    productionSalesAllowedByThisGate: false,
    productionActivationAllowedByThisGate: false,
    nextRequiredBoundary: "fail-closed-commercial-isolation-deploy",
  },
};

await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log("UGMU commercial sales isolation: PASS");
console.log(`Registered tenants: ${registered.join(", ")}`);
console.log(`UGMU-only matrix: ${JSON.stringify(matrices.ugmuOnly)}`);
console.log(`Report: ${reportPath}`);
