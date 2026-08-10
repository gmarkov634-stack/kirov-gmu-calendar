import http from "node:http";
import { createHandler } from "./app.js";
import { loadConfig } from "./config.js";
import { MultiUniversityStore } from "./university-store.js";
import { createVkCallbackHandler } from "./vk-callback.js";
import { createVkWallHandler } from "./vk-wall.js";
import { YooKassaService } from "./yookassa.js";

const config = loadConfig();
const store = new MultiUniversityStore(config);
const payments = new YooKassaService({ store, config });
const appHandler = createHandler({ store, config, payments });
const vkCallbackHandler = createVkCallbackHandler(process.env, { store });
const vkWallHandler = createVkWallHandler();

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (request.method === "POST" && url.pathname === "/api/v1/vk/callback") {
    return vkCallbackHandler(request, response);
  }
  if (url.pathname === "/api/v1/vk/wall") {
    return vkWallHandler(request, response);
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
