import http from "node:http";
import { createHandler } from "./app.js";
import { loadConfig } from "./config.js";
import { YearAwareStore } from "./year-aware-store.js";
import { createOfferCatalogHandler } from "./offer-catalog.js";
import { createKgmuWatchStatusHandler } from "./kgmu-watch-status.js";
import { createVkCallbackHandler } from "./vk-callback.js";
import { createVkControlHandler } from "./vk-control.js";
import { createVkWallHandler } from "./vk-wall.js";
import { YooKassaService } from "./yookassa.js";
import { ParserReviewQueue } from "./adapters/kgmu/review-queue.mjs";
import { MaxReviewNotifier } from "./adapters/kgmu/max-notifier.mjs";
import { TelegramReviewNotifier } from "./adapters/kgmu/telegram-notifier.mjs";
import { KgmuIngestServiceV2 } from "./adapters/kgmu/ingest-service-v2.mjs";
import { createKgmuParserHandler } from "./adapters/kgmu/http-handler.mjs";
import { KgmuWatchStore } from "./adapters/kgmu/watch-store.mjs";
import { KgmuSourceWatcher } from "./adapters/kgmu/source-watcher.mjs";

const config = loadConfig();
const store = new YearAwareStore(config);
const payments = new YooKassaService({ store, config });
const appHandler = createHandler({ store, config, payments });
const offerCatalogHandler = createOfferCatalogHandler({ store, config });
const vkCallbackHandler = createVkCallbackHandler(process.env, { store });
const vkWallHandler = createVkWallHandler();
const vkControlHandler = createVkControlHandler();
const parserReviewQueue = new ParserReviewQueue(config);
const maxNotifier = new MaxReviewNotifier(config);
const telegramNotifier = new TelegramReviewNotifier(config);
const parserNotifier = maxNotifier.enabled ? maxNotifier : telegramNotifier;
const kgmuIngestService = new KgmuIngestServiceV2({
  queue: parserReviewQueue,
  notifier: parserNotifier,
  config,
  scheduleStore: store,
});
const kgmuWatchStore = new KgmuWatchStore(config);
const kgmuWatcher = new KgmuSourceWatcher({
  config,
  ingestService: kgmuIngestService,
  stateStore: kgmuWatchStore,
});
const kgmuWatchStatusHandler = createKgmuWatchStatusHandler({ stateStore: kgmuWatchStore, config });
const kgmuParserHandler = createKgmuParserHandler({
  service: kgmuIngestService,
  queue: parserReviewQueue,
  watcher: kgmuWatcher,
  notifier: parserNotifier,
  maxNotifier,
  telegramNotifier,
  config,
});

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (request.method === "POST" && url.pathname === "/api/v1/vk/callback") {
    return vkCallbackHandler(request, response);
  }
  if (url.pathname === "/api/v1/vk/wall") {
    return vkWallHandler(request, response);
  }
  if (url.pathname === "/api/v1/vk/control") {
    return vkControlHandler(request, response);
  }
  if (url.pathname === "/api/v2/status/kgmu-watcher") {
    return kgmuWatchStatusHandler(request, response);
  }
  if (url.pathname.startsWith("/api/v2/catalog/")) {
    return offerCatalogHandler(request, response);
  }
  if (
    url.pathname === "/api/v1/admin/kgmu/ingest" ||
    url.pathname === "/api/v1/admin/kgmu/watch" ||
    url.pathname === "/api/v1/admin/kgmu/max-test" ||
    url.pathname === "/api/v1/admin/kgmu/max-discover" ||
    url.pathname === "/api/v1/admin/kgmu/telegram-test" ||
    url.pathname.startsWith("/api/v1/admin/parser-reviews")
  ) {
    return kgmuParserHandler(request, response);
  }
  return appHandler(request, response);
});

let kgmuWatchTimer = null;

async function runKgmuWatch(reason) {
  try {
    const result = await kgmuWatcher.run();
    console.log("KGMU source watch", reason, JSON.stringify({
      status: result.status,
      targetCount: result.targetCount,
      ingestedCount: result.ingestedCount,
      unchangedCount: result.unchangedCount,
      errorCount: result.errorCount,
    }));
  } catch (error) {
    console.error("KGMU source watch failed", reason, error);
  }
}

server.listen(config.port, "0.0.0.0", () => {
  console.log(`medical-calendar-api listening on :${config.port}`);
  if (maxNotifier.enabled) console.log("KGMU parser notifications: MAX");
  else if (telegramNotifier.enabled) console.log("KGMU parser notifications: Telegram fallback");
  else console.log("KGMU parser notifications are not configured");
  if (config.kgmuWatchEnabled) {
    void runKgmuWatch("startup");
    kgmuWatchTimer = setInterval(() => { void runKgmuWatch("interval"); }, config.kgmuWatchIntervalMs);
    kgmuWatchTimer.unref();
    console.log(`KGMU source watcher enabled: ${config.kgmuWatchIntervalMs} ms`);
  }
});

function shutdown() {
  if (kgmuWatchTimer) clearInterval(kgmuWatchTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
