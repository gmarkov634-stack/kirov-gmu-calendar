import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const transportUrl = new URL("../landing/manage/session-transport.js", import.meta.url);
const maxLinkUrl = new URL("../landing/manage/max-account-link.js", import.meta.url);
const API_BASE = "https://176-123-165-120.sslip.io";
const STORAGE_KEY = "kgmu-calendar:max-account-link-v1";

function memoryStorage(seed = new Map()) {
  return {
    getItem(key) { return seed.has(key) ? seed.get(key) : null; },
    setItem(key, value) { seed.set(key, String(value)); },
    removeItem(key) { seed.delete(key); },
    seed
  };
}

async function installPage({ hash = "", storage = memoryStorage(), nativeFetch, loadTransport = true } = {}) {
  const status = { textContent: "", className: "manage-status" };
  const replaced = [];
  const location = {
    origin: "https://gmarkov634-stack.github.io",
    href: `https://gmarkov634-stack.github.io/kirov-gmu-calendar/manage/${hash}`,
    pathname: "/kirov-gmu-calendar/manage/",
    search: "",
    hash
  };
  const window = {
    location,
    localStorage: storage,
    fetch: nativeFetch,
    history: {
      replaceState(_state, _title, url) { replaced.push(url); }
    }
  };
  const config = {
    apiBase: API_BASE,
    managementEnabled: true,
    managementSessionTransport: "bearer"
  };
  const context = {
    window,
    document: { getElementById(id) { return id === "management-status" ? status : null; } },
    KGMU_CALENDAR_CONFIG: config,
    URL,
    URLSearchParams,
    Headers,
    Request,
    Response,
    Date,
    JSON
  };
  if (loadTransport) vm.runInNewContext(await readFile(transportUrl, "utf8"), context);
  vm.runInNewContext(await readFile(maxLinkUrl, "utf8"), context);
  return { window, status, storage, replaced };
}

test("MAX link challenge survives email round-trip and is completed only after authenticated subscriptions load", async () => {
  const linkToken = "L".repeat(43);
  const managementToken = "M".repeat(48);
  const storage = memoryStorage();
  const firstCalls = [];
  const first = await installPage({
    hash: `#link_token=${linkToken}`,
    storage,
    nativeFetch: async (input) => {
      firstCalls.push(String(input));
      return new Response(JSON.stringify({ error: "management_session_required" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  assert.equal(firstCalls.length, 0);
  assert.equal(first.replaced[0], "/kirov-gmu-calendar/manage/");
  assert.ok(storage.getItem(STORAGE_KEY)?.includes(linkToken));
  assert.match(first.status.textContent, /подтвердите email/i);

  const calls = [];
  const second = await installPage({
    hash: `#token=${"E".repeat(43)}`,
    storage,
    nativeFetch: async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const authorization = new Headers(init.headers).get("Authorization");
      calls.push({ path: url.pathname, authorization, body: init.body ?? null });
      if (url.pathname === "/management/verify") {
        return new Response(JSON.stringify({ managementToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.pathname === "/management/max/link") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ subscriptions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await second.window.fetch(`${API_BASE}/management/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ magicToken: "E".repeat(43) })
  });
  assert.equal(calls.some((call) => call.path === "/management/max/link"), false);

  await second.window.fetch(`${API_BASE}/management/subscriptions`);
  const linkCall = calls.find((call) => call.path === "/management/max/link");
  assert.ok(linkCall);
  assert.equal(linkCall.authorization, `Bearer ${managementToken}`);
  assert.deepEqual(JSON.parse(linkCall.body), { linkToken });
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.match(second.status.textContent, /успешно привязан/i);
});

test("MAX challenge is stripped from the URL while an email magic token is preserved", async () => {
  const linkToken = "A".repeat(43);
  const emailToken = "B".repeat(43);
  const page = await installPage({
    hash: `#token=${emailToken}&link_token=${linkToken}`,
    nativeFetch: async () => new Response(null, { status: 401 })
  });
  assert.equal(page.replaced[0], `/kirov-gmu-calendar/manage/#token=${emailToken}`);
  assert.ok(page.storage.getItem(STORAGE_KEY)?.includes(linkToken));
});

test("invalid or duplicate MAX challenge fails closed and is never persisted", async () => {
  for (const hash of ["#link_token=short", `#link_token=${"A".repeat(43)}&link_token=${"B".repeat(43)}`]) {
    const storage = memoryStorage();
    const page = await installPage({
      hash,
      storage,
      nativeFetch: async () => new Response(null, { status: 500 })
    });
    assert.equal(storage.getItem(STORAGE_KEY), null);
    assert.equal(page.replaced.length, 1);
    assert.match(page.status.textContent, /недействительна/i);
  }
});

test("expired pending MAX challenge is removed without a network request", async () => {
  const storage = memoryStorage(new Map([[STORAGE_KEY, JSON.stringify({
    token: "Z".repeat(43),
    capturedAt: Date.now() - 15 * 60 * 1000 - 1
  })]]));
  let calls = 0;
  const page = await installPage({
    storage,
    nativeFetch: async () => {
      calls += 1;
      return new Response(JSON.stringify({ subscriptions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  assert.equal(storage.getItem(STORAGE_KEY), null);
  await page.window.fetch(`${API_BASE}/management/subscriptions`);
  assert.equal(calls, 1);
});

test("management page loads MAX link guard after bearer transport and before management module", async () => {
  const html = await readFile(new URL("../landing/manage/index.html", import.meta.url), "utf8");
  const transportIndex = html.indexOf("session-transport.js");
  const maxLinkIndex = html.indexOf("max-account-link.js");
  const manageIndex = html.indexOf("manage.js");
  assert.ok(transportIndex >= 0);
  assert.ok(maxLinkIndex > transportIndex);
  assert.ok(manageIndex > maxLinkIndex);
});
