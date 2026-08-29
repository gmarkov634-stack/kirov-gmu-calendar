import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const scriptUrl = new URL("../landing/manage/session-transport.js", import.meta.url);

function memorySessionStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

async function installTransport({ storage, nativeFetch }) {
  const source = await readFile(scriptUrl, "utf8");
  const window = {
    fetch: nativeFetch,
    sessionStorage: storage,
    location: {
      origin: "https://gmarkov634-stack.github.io",
      href: "https://gmarkov634-stack.github.io/kirov-gmu-calendar/manage/"
    }
  };
  const context = {
    window,
    URL,
    Headers,
    Request,
    KGMU_CALENDAR_CONFIG: {
      apiBase: "https://176-123-165-120.sslip.io",
      managementSessionTransport: "bearer"
    }
  };
  vm.runInNewContext(source, context);
  return window;
}

test("bearer management session survives a page reload in the same tab", async () => {
  const storage = memorySessionStorage();
  const managementToken = "m".repeat(48);

  const firstWindow = await installTransport({
    storage,
    nativeFetch: async () => new Response(JSON.stringify({ managementToken }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })
  });

  await firstWindow.fetch("https://176-123-165-120.sslip.io/management/verify", {
    method: "POST",
    body: "{}"
  });

  let authorization = null;
  const reloadedWindow = await installTransport({
    storage,
    nativeFetch: async (_input, init) => {
      authorization = new Headers(init.headers).get("Authorization");
      return new Response(JSON.stringify({ subscriptions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await reloadedWindow.fetch("https://176-123-165-120.sslip.io/management/subscriptions", {
    method: "GET"
  });

  assert.equal(authorization, `Bearer ${managementToken}`);
});

test("stored bearer session is cleared on 401 and logout", async () => {
  const storage = memorySessionStorage();
  const managementToken = "x".repeat(48);
  storage.setItem("kgmu.managementSessionToken.v1", managementToken);

  const unauthorizedWindow = await installTransport({
    storage,
    nativeFetch: async () => new Response(JSON.stringify({ error: "management_session_required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    })
  });
  await unauthorizedWindow.fetch("https://176-123-165-120.sslip.io/management/subscriptions");
  assert.equal(storage.getItem("kgmu.managementSessionToken.v1"), null);

  storage.setItem("kgmu.managementSessionToken.v1", managementToken);
  const logoutWindow = await installTransport({
    storage,
    nativeFetch: async () => new Response(null, { status: 204 })
  });
  await logoutWindow.fetch("https://176-123-165-120.sslip.io/management/logout", { method: "POST" });
  assert.equal(storage.getItem("kgmu.managementSessionToken.v1"), null);
});

test("management session script is loaded before manage.js", async () => {
  const html = await readFile(new URL("../landing/manage/index.html", import.meta.url), "utf8");
  const transportIndex = html.indexOf("session-transport.js");
  const manageIndex = html.indexOf("manage.js");
  assert.ok(transportIndex >= 0);
  assert.ok(manageIndex > transportIndex);
});
