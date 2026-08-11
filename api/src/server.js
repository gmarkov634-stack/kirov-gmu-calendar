import http from "node:http";
import { createHandler } from "./app.js";
import { loadConfig } from "./config.js";
import { YearAwareStore } from "./year-aware-store.js";
import { createVkCallbackHandler } from "./vk-callback.js";
import { createVkControlHandler } from "./vk-control.js";
import { createVkWallHandler } from "./vk-wall.js";
import { YooKassaService } from "./yookassa.js";
import { ParserReviewQueue } from "./adapters/kgmu/review-queue.mjs";
import { TelegramReviewNotifier } from "./adapters/kgmu/telegram-notifier.mjs";
import { KgmuIngestService } from "./adapters/kgmu/ingest-service.mjs";
import { createKgmuParserHandler } from "./adapters/kgmu/http-handler.mjs";

const config = loadConfig();
const store = new YearAwareStore(config);
const payments = new YooKassaService({ store, config });
const appHandler = createHandler({ store, config, payments });
const vkCallbackHandler = createVkCallbackHandler(process.env, { store });
const vkWallHandler = createVkWallHandler();
const vkControlHandler = createVkControlHandler();
const parserReviewQueue = new ParserReviewQueue(config);
const parserNotifier = new TelegramReviewNotifier(config);
const kgmuIngestService = new KgmuIngestService({ queue: parserReviewQueue, notifier: parserNotifier, config });
const kgmuParserHandler = createKgmuParserHandler({ service: kgmuIngestService, queue: parserReviewQueue, config });

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
  if (url.pathname === "/api/v1/admin/kgmu/ingest" || url.pathname.startsWith("/api/v1/admin/parser-reviews")) {
    return kgmuParserHandler(request, response);
  }
  return appHandler(request, response);
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`medical-calendar-api listening on :${config.port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
