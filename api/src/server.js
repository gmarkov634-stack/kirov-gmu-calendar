import http from "node:http";
import { createHandler } from "./app.js";
import { loadConfig } from "./config.js";
import { ScheduleStore } from "./store.js";
import { YooKassaService } from "./yookassa.js";

const config = loadConfig();
const store = new ScheduleStore(config);
const payments = new YooKassaService({ store, config });
const server = http.createServer(createHandler({ store, config, payments }));

server.listen(config.port, "0.0.0.0", () => {
  console.log(`kgmu-calendar-api listening on :${config.port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
