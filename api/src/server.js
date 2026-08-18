import http from "node:http";
import { createHandler } from "./app.js";
import { createArchivePaymentTestHandler } from "./archive-payment-test-handler.js";
import { createPreviewSubscriptionHandler } from "./preview-subscription-handler.js";
import { loadConfig } from "./config.js";
import { FunnelAnalyticsStore } from "./funnel-analytics-store.js";
import { createFunnelAnalyticsHandler } from "./funnel-analytics.js";
import { createFunnelEventHandler } from "./funnel-events.js";
import { createOfferCatalogHandler } from "./offer-catalog.js";
import { createOfferPreviewHandler } from "./offer-preview.js";
import { createKgmuWatchStatusHandler } from "./kgmu-watch-status.js";
import { createOmgmuWatchStatusHandler } from "./omgmu-watch-status.js";
import { createScheduleReviewControlHandler } from "./schedule-review-control.js";
import { ScheduleReviewServiceRouter } from "./schedule/review-service-router.js";
import { createTrialHttpHandler } from "./trial-http-handler.js";
import { TrialService } from "./trial-service.js";
import { createVkCallbackHandler } from "./vk-callback.js";
import { createVkControlHandler } from "./vk-control.js";
import { createVkControlTenantEnv } from "./vk-control-tenant-env.js";
import { createVkOauthCallbackHandler } from "./vk-oauth-callback.js";
import { createVkOauthStartHandler } from "./vk-oauth-start.js";
import { VkTokenManager } from "./vk-token-manager.js";
import { VkTokenVault } from "./vk-token-vault.js";
import { createVkWallHandler } from "./vk-wall.js";
import { YooKassaService } from "./yookassa.js";
import { createIzhgmuSourceProbeHandler } from "./adapters/izhgmu/source-probe.mjs";
import { IzhgmuReviewQueue } from "./adapters/izhgmu/review-queue.mjs";
import { IzhgmuReviewedService } from "./adapters/izhgmu/reviewed-service.mjs";
import { ParserReviewQueue } from "./adapters/kgmu/review-queue.mjs";
import { EmailReviewNotifier } from "./adapters/kgmu/email-notifier.mjs";
import { KgmuIngestServiceV2 } from "./adapters/kgmu/ingest-service-v2.mjs";
import { KgmuReviewedService } from "./adapters/kgmu/reviewed-service.mjs";
import { createKgmuParserHandler } from "./adapters/kgmu/http-handler.mjs";
import { KgmuWatchStore } from "./adapters/kgmu/watch-store.mjs";
import { KgmuSourceWatcher } from "./adapters/kgmu/source-watcher.mjs";
import { createOmgmuSourceProbeHandler } from "./adapters/omgmu/source-probe.mjs";
import { OmgmuReviewQueue } from "./adapters/omgmu/review-queue.mjs";
import { OmgmuReviewedService } from "./adapters/omgmu/reviewed-service.mjs";
import { OmgmuSourceObserver } from "./adapters/omgmu/source-observer.mjs";
import { OmgmuWatchStore } from "./adapters/omgmu/watch-store.mjs";
import { OmgmuSourceWatcher } from "./adapters/omgmu/source-watcher.mjs";
import { createOmgmuReviewHandler } from "./adapters/omgmu/http-handler.mjs";
import { createSchedulePublishHandler } from "./schedule/publish-handler.js";

const config = loadConfig();
const store = new FunnelAnalyticsStore(config);
const payments = new YooKassaService({ store, config });
const trials = new TrialService({ store, config });
const trialHttpHandler = createTrialHttpHandler({ store, config, trials });
const funnelAnalyticsHandler = createFunnelAnalyticsHandler({ store, config });
const funnelEventHandler = createFunnelEventHandler({ store, config });
const appHandler = createHandler({ store, config, payments });
const archivePaymentTestHandler = createArchivePaymentTestHandler({ store, config, payments });
const previewSubscriptionHandler = createPreviewSubscriptionHandler({ store, config });
const offerCatalogHandler = createOfferCatalogHandler({ store, config });
const offerPreviewHandler = createOfferPreviewHandler({ store, config });
const vkTokenVault = new VkTokenVault(config);
const vkTokenManager = new VkTokenManager({ vault: vkTokenVault });
const vkCallbackHandler = createVkCallbackHandler(process.env, { store });
const vkWallHandler = createVkWallHandler(process.env, { tokenManager: vkTokenManager });
const vkControlHandler = createVkControlHandler(process.env, { tokenManager: vkTokenManager });
const omgmuVkControlEnv = createVkControlTenantEnv(process.env, "OMGMU");
const omgmuVkControlHandler = createVkControlHandler(omgmuVkControlEnv);
const izhgmuVkControlEnv = createVkControlTenantEnv(process.env, "IZHGMU");
const izhgmuVkControlHandler = createVkControlHandler(izhgmuVkControlEnv);
const vkOauthCallbackHandler = createVkOauthCallbackHandler(process.env, { tokenManager: vkTokenManager });
const vkOauthStartHandler = createVkOauthStartHandler();
const izhgmuSourceProbeHandler = createIzhgmuSourceProbeHandler();
const omgmuSourceProbeHandler = createOmgmuSourceProbeHandler();
const schedulePublishHandler = createSchedulePublishHandler({ store, config });
const parserReviewQueue = new ParserReviewQueue(config);
const parserNotifier = new EmailReviewNotifier(config);
const kgmuIngestService = new KgmuIngestServiceV2({
  queue: parserReviewQueue,
  notifier: parserNotifier,
  config,
  scheduleStore: store,
});
const kgmuReviewedService = new KgmuReviewedService({
  queue: parserReviewQueue,
  notifier: parserNotifier,
  config,
  scheduleStore: store,
});
const kgmuWatchStore = new KgmuWatchStore(config);
const kgmuWatcher = new KgmuSourceWatcher({
  config,
  ingestService: kgmuIngestService,
  sourceObserver: kgmuReviewedService,
  stateStore: kgmuWatchStore,
});
const kgmuWatchStatusHandler = createKgmuWatchStatusHandler({ stateStore: kgmuWatchStore, config });
const kgmuParserHandler = createKgmuParserHandler({
  service: kgmuIngestService,
  reviewedService: kgmuReviewedService,
  queue: parserReviewQueue,
  watcher: kgmuWatcher,
  notifier: parserNotifier,
  config,
});
const omgmuReviewQueue = new OmgmuReviewQueue(config);
const omgmuReviewedService = new OmgmuReviewedService({ queue: omgmuReviewQueue, scheduleStore: store });
const omgmuSourceObserver = new OmgmuSourceObserver({ queue: omgmuReviewQueue });
const omgmuWatchStore = new OmgmuWatchStore(config);
const omgmuWatcher = new OmgmuSourceWatcher({
  config,
  observer: omgmuSourceObserver,
  stateStore: omgmuWatchStore,
});
const omgmuWatchStatusHandler = createOmgmuWatchStatusHandler({ stateStore: omgmuWatchStore, reviewQueue: omgmuReviewQueue, config });
const omgmuReviewHandler = createOmgmuReviewHandler({ queue: omgmuReviewQueue, watcher: omgmuWatcher, config });
const izhgmuReviewQueue = new IzhgmuReviewQueue(config);
const izhgmuReviewedService = new IzhgmuReviewedService({ queue: izhgmuReviewQueue, scheduleStore: store });
const reviewServiceRouter = new ScheduleReviewServiceRouter([kgmuReviewedService, omgmuReviewedService, izhgmuReviewedService]);
const scheduleReviewControlHandler = createScheduleReviewControlHandler({ reviewedService: reviewServiceRouter });

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (request.method === "POST" && url.pathname === "/api/v1/vk/callback") {
    return vkCallbackHandler(request, response);
  }
  if (url.pathname === "/api/v1/vk/oauth/start" || url.pathname === "/api/v1/vk/oauth/begin") {
    return vkOauthStartHandler(request, response);
  }
  if (url.pathname === "/api/v1/vk/oauth/callback") {
    return vkOauthCallbackHandler(request, response);
  }
  if (url.pathname === "/api/v1/vk/wall") {
    return vkWallHandler(request, response);
  }
  if (url.pathname === "/api/v1/vk/control") {
    return vkControlHandler(request, response);
  }
  if (url.pathname === "/api/v1/vk/omgmu/control") {
    return omgmuVkControlHandler(request, response);
  }
  if (url.pathname === "/api/v1/vk/izhgmu/control") {
    return izhgmuVkControlHandler(request, response);
  }
  if (url.pathname === "/api/v1/schedule-review/control") {
    return scheduleReviewControlHandler(request, response);
  }
  if (url.pathname === "/api/v1/admin/izhgmu/source-probe") {
    return izhgmuSourceProbeHandler(request, response);
  }
  if (url.pathname === "/api/v1/admin/omgmu/source-probe") {
    return omgmuSourceProbeHandler(request, response);
  }
  if (url.pathname === "/api/v1/admin/funnel") {
    return funnelAnalyticsHandler(request, response);
  }
  if (url.pathname === "/api/v2/analytics") {
    return funnelEventHandler(request, response);
  }
  if (url.pathname === "/api/v2/status/kgmu-watcher") {
    return kgmuWatchStatusHandler(request, response);
  }
  if (url.pathname === "/api/v2/status/omgmu-watcher") {
    return omgmuWatchStatusHandler(request, response);
  }
  if (url.pathname.match(/^\/api\/v2\/catalog\/[^/]+\/[^/]+\/\d+\/[^/]+\/preview$/)) {
    return offerPreviewHandler(request, response);
  }
  if (url.pathname.startsWith("/api/v2/catalog/")) {
    return offerCatalogHandler(request, response);
  }
  if (url.pathname === "/api/v2/trials" || url.pathname.startsWith("/api/v2/trials/continue/")) {
    return trialHttpHandler.handleApi(request, response);
  }
  if (url.pathname === "/api/v1/admin/payments/test-archive") {
    return archivePaymentTestHandler(request, response);
  }
  if (url.pathname === "/api/v1/admin/subscriptions/preview") {
    return previewSubscriptionHandler(request, response);
  }
  if (url.pathname === "/api/v1/admin/schedules/publish") {
    return schedulePublishHandler(request, response);
  }
  if (url.pathname === "/api/v1/admin/omgmu/watch" || url.pathname.startsWith("/api/v1/admin/omgmu/parser-reviews")) {
    return omgmuReviewHandler(request, response);
  }
  if (
    url.pathname === "/api/v1/admin/kgmu/reviewed-bundle" ||
    url.pathname === "/api/v1/admin/kgmu/dry-run" ||
    url.pathname === "/api/v1/admin/kgmu/ingest" ||
    url.pathname === "/api/v1/admin/kgmu/watch" ||
    url.pathname === "/api/v1/admin/kgmu/email-test" ||
    url.pathname.startsWith("/api/v1/admin/parser-reviews")
  ) {
    return kgmuParserHandler(request, response);
  }
  if (url.pathname.match(/^\/api\/v1\/subscriptions\/[A-Za-z0-9_-]{43}\/calendar\.ics$/)) {
    const handled = await trialHttpHandler.handleSubscription(request, response);
    if (handled) return;
  }
  return appHandler(request, response);
});

let kgmuWatchTimer = null;
let omgmuWatchTimer = null;

async function runKgmuWatch(reason) {
  try {
    const result = await kgmuWatcher.run();
    console.log("KGMU source watch", reason, JSON.stringify({
      status: result.status,
      mode: result.mode,
      targetCount: result.targetCount,
      observedCount: result.observedCount,
      ingestedCount: result.ingestedCount,
      unchangedCount: result.unchangedCount,
      errorCount: result.errorCount,
    }));
  } catch (error) {
    console.error("KGMU source watch failed", reason, error);
  }
}

async function runOmgmuWatch(reason) {
  try {
    const result = await omgmuWatcher.run();
    console.log("OMGMU source watch", reason, JSON.stringify({
      status: result.status,
      targetCount: result.targetCount,
      newReviewCount: result.newReviewCount,
      changedReviewCount: result.changedReviewCount,
      unchangedCount: result.unchangedCount,
      missingCount: result.missingCount,
      errorCount: result.errorCount,
    }));
  } catch (error) {
    console.error("OMGMU source watch failed", reason, error);
  }
}

server.listen(config.port, "0.0.0.0", () => {
  console.log(`medical-calendar-api listening on :${config.port}`);
  console.log(parserNotifier.enabled
    ? "KGMU schedule notifications: Email"
    : "KGMU schedule email notifications are not configured");
  console.log(config.kgmuManualNormalization
    ? "KGMU normalization mode: reviewed JSON (server XLSX parsing disabled)"
    : "KGMU normalization mode: legacy server parser");
  console.log(config.trialsEnabled
    ? "Trial subscriptions enabled"
    : "Trial subscriptions disabled");
  console.log(config.funnelAnalyticsEnabled
    ? "Funnel analytics enabled"
    : "Funnel analytics disabled");
  console.log("IzhGMU review control: source-set-bound / explicit publication only");
  if (config.kgmuWatchEnabled) {
    void runKgmuWatch("startup");
    kgmuWatchTimer = setInterval(() => { void runKgmuWatch("interval"); }, config.kgmuWatchIntervalMs);
    kgmuWatchTimer.unref();
    console.log(`KGMU source watcher enabled: ${config.kgmuWatchIntervalMs} ms`);
  }
  if (config.omgmuWatchEnabled) {
    void runOmgmuWatch("startup");
    omgmuWatchTimer = setInterval(() => { void runOmgmuWatch("interval"); }, config.omgmuWatchIntervalMs);
    omgmuWatchTimer.unref();
    console.log(`OMGMU source watcher enabled: ${config.omgmuWatchIntervalMs} ms (observation/review only)`);
  }
});

function shutdown() {
  if (kgmuWatchTimer) clearInterval(kgmuWatchTimer);
  if (omgmuWatchTimer) clearInterval(omgmuWatchTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
