import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const scriptUrl = new URL("../landing/manage/max-account-link.js", import.meta.url);

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
}

class FakeBroadcastChannel {
  static channels = new Map();
  constructor(name) {
    this.name = name;
    this.listeners = new Set();
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set();
    peers.add(this);
    FakeBroadcastChannel.channels.set(name, peers);
  }
  addEventListener(type, listener) { if (type === "message") this.listeners.add(listener); }
  postMessage(data) {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer === this) continue;
      queueMicrotask(() => { for (const listener of peer.listeners) listener({ data }); });
    }
  }
  close() {
    const peers = FakeBroadcastChannel.channels.get(this.name);
    peers?.delete(this);
  }
}

function statusNode() {
  return { textContent: "", className: "manage-status" };
}

async function installPage({ hash = "", storage, nativeFetch, status = statusNode() }) {
  const source = await readFile(scriptUrl, "utf8");
  const location = {
    origin: "https://gmarkov634-stack.github.io",
    href: `https://gmarkov634-stack.github.io/kirov-gmu-calendar/manage/${hash}`,
    pathname: "/kirov-gmu-calendar/manage/",
    search: "",
    hash
  };
  const history = {
    replaceState(_a, _b, url) {
      const next = new URL(url, location.origin);
      location.href = next.toString();
      location.pathname = next.pathname;
      location.search = next.search;
      location.hash = next.hash;
    }
  };
  let randomByte = 0;
  const window = { location, fetch: nativeFetch };
  const context = {
    window,
    globalThis: null,
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    Uint8Array,
    Date,
    JSON,
    localStorage: storage,
    history,
    document: { querySelector: (selector) => selector === "#management-status" ? status : null },
    BroadcastChannel: FakeBroadcastChannel,
    crypto: { getRandomValues(bytes) { for (let i = 0; i < bytes.length; i += 1) bytes[i] = (randomByte++ + 17) & 255; return bytes; } },
    queueMicrotask,
    setInterval,
    clearInterval,
    KGMU_CALENDAR_CONFIG: {
      apiBase: "https://176-123-165-120.sslip.io",
      managementEnabled: true,
      managementSessionTransport: "bearer"
    }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return { window, location, status };
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

test("MAX fragment credential is removed immediately and never written to localStorage", async () => {
  FakeBroadcastChannel.channels.clear();
  const token = "A".repeat(43);
  const storage = new MemoryStorage();
  const page = await installPage({
    hash: `#link_token=${token}&token=email-magic-token`,
    storage,
    nativeFetch: async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })
  });

  assert.equal(page.location.hash, "#token=email-magic-token");
  assert.doesNotMatch(storage.getItem("kgmu-calendar:max-link-rendezvous-v1") ?? "", new RegExp(token));
  const rendezvous = JSON.parse(storage.getItem("kgmu-calendar:max-link-rendezvous-v1"));
  assert.match(rendezvous.flowId, /^[a-f0-9]{32}$/);
  assert.ok(rendezvous.expiresAt > Date.now());
});

test("authenticated same-tab session posts in-memory MAX token without storage persistence", async () => {
  FakeBroadcastChannel.channels.clear();
  const token = "B".repeat(43);
  const storage = new MemoryStorage();
  const calls = [];
  const page = await installPage({
    hash: `#link_token=${token}`,
    storage,
    nativeFetch: async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : input);
      calls.push({ path: url.pathname, body: init.body ?? null });
      if (url.pathname === "/management/subscriptions") {
        return new Response(JSON.stringify({ subscriptions: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname === "/management/max/link") return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    }
  });

  await page.window.fetch("https://176-123-165-120.sslip.io/management/subscriptions");
  await tick();
  const linkCall = calls.find((call) => call.path === "/management/max/link");
  assert.ok(linkCall);
  assert.equal(JSON.parse(linkCall.body).linkToken, token);
  assert.equal(storage.getItem("kgmu-calendar:max-link-rendezvous-v1"), null);
  assert.equal(page.status.className, "manage-status success");
});

test("email verification tab receives MAX token only through ephemeral BroadcastChannel", async () => {
  FakeBroadcastChannel.channels.clear();
  const token = "C".repeat(43);
  const storage = new MemoryStorage();
  await installPage({
    hash: `#link_token=${token}`,
    storage,
    nativeFetch: async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })
  });

  const calls = [];
  const receiver = await installPage({
    storage,
    nativeFetch: async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : input);
      calls.push({ path: url.pathname, body: init.body ?? null });
      if (url.pathname === "/management/subscriptions") {
        return new Response(JSON.stringify({ subscriptions: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname === "/management/max/link") return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    }
  });

  await receiver.window.fetch("https://176-123-165-120.sslip.io/management/subscriptions");
  await tick();
  const linkCall = calls.find((call) => call.path === "/management/max/link");
  assert.ok(linkCall);
  assert.equal(JSON.parse(linkCall.body).linkToken, token);
  assert.equal(storage.getItem("kgmu-calendar:max-link-rendezvous-v1"), null);
  assert.equal(receiver.status.className, "manage-status success");
});

test("terminal MAX link rejection clears rendezvous in both tabs without persisting the token", async () => {
  FakeBroadcastChannel.channels.clear();
  const token = "D".repeat(43);
  const storage = new MemoryStorage();
  const sender = await installPage({
    hash: `#link_token=${token}`,
    storage,
    nativeFetch: async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })
  });

  const receiver = await installPage({
    storage,
    nativeFetch: async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/management/subscriptions") {
        return new Response(JSON.stringify({ subscriptions: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.pathname === "/management/max/link") {
        return new Response(JSON.stringify({ error: "max_link_challenge_invalid" }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
      return new Response(null, { status: 404 });
    }
  });

  await receiver.window.fetch("https://176-123-165-120.sslip.io/management/subscriptions");
  await tick();
  assert.equal(storage.getItem("kgmu-calendar:max-link-rendezvous-v1"), null);
  assert.equal(receiver.status.className, "manage-status error");
  assert.equal(sender.status.className, "manage-status error");
});

test("management page loads session transport before MAX rendezvous and base modules", async () => {
  const html = await readFile(new URL("../landing/manage/index.html", import.meta.url), "utf8");
  const transportIndex = html.indexOf("session-transport.js");
  const maxIndex = html.indexOf("max-account-link.js");
  const handoffIndex = html.indexOf("handoff.js");
  const manageIndex = html.indexOf("manage.js");
  assert.ok(transportIndex >= 0);
  assert.ok(maxIndex > transportIndex);
  assert.ok(handoffIndex > maxIndex);
  assert.ok(manageIndex > handoffIndex);
});

test("MAX token is not persisted or placed in query parameters by implementation", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /params\.delete\("link_token"\)/);
  assert.match(source, /\/management\/max\/link/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*linkToken/);
  assert.doesNotMatch(source, /sessionStorage/);
  assert.doesNotMatch(source, /searchParams\.set\([^\n]*link_token/);
});
