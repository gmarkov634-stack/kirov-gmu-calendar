import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const scriptUrl = new URL("../landing/manage/session-transport.js", import.meta.url);

async function installTransport({ nativeFetch }) {
  const source = await readFile(scriptUrl, "utf8");
  const window = {
    fetch: nativeFetch,
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

test("bearer management session stays in current page memory and is lost on reload", async () => {
  const managementToken = "m".repeat(48);
  const authorizations = [];
  const firstWindow = await installTransport({
    nativeFetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      authorizations.push(new Headers(init.headers).get("Authorization"));
      if (url.pathname === "/management/verify") {
        return new Response(JSON.stringify({ managementToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ subscriptions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await firstWindow.fetch("https://176-123-165-120.sslip.io/management/verify", {
    method: "POST",
    body: "{}"
  });
  await firstWindow.fetch("https://176-123-165-120.sslip.io/management/subscriptions", {
    method: "GET"
  });

  assert.equal(authorizations[0], null);
  assert.equal(authorizations[1], `Bearer ${managementToken}`);

  let reloadedAuthorization = "unexpected";
  const reloadedWindow = await installTransport({
    nativeFetch: async (_input, init) => {
      reloadedAuthorization = new Headers(init.headers).get("Authorization");
      return new Response(JSON.stringify({ subscriptions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await reloadedWindow.fetch("https://176-123-165-120.sslip.io/management/subscriptions", {
    method: "GET"
  });
  assert.equal(reloadedAuthorization, null);
});

test("in-memory bearer session is cleared on 401", async () => {
  const managementToken = "x".repeat(48);
  const authorizations = [];
  let subscriptionCalls = 0;
  const window = await installTransport({
    nativeFetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      authorizations.push(new Headers(init.headers).get("Authorization"));
      if (url.pathname === "/management/verify") {
        return new Response(JSON.stringify({ managementToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      subscriptionCalls += 1;
      if (subscriptionCalls === 1) {
        return new Response(JSON.stringify({ error: "management_session_invalid" }), {
          status: 401,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ subscriptions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await window.fetch("https://176-123-165-120.sslip.io/management/verify", { method: "POST", body: "{}" });
  await window.fetch("https://176-123-165-120.sslip.io/management/subscriptions");
  await window.fetch("https://176-123-165-120.sslip.io/management/subscriptions");

  assert.equal(authorizations[1], `Bearer ${managementToken}`);
  assert.equal(authorizations[2], null);
});

test("in-memory bearer session is cleared after logout", async () => {
  const managementToken = "y".repeat(48);
  const authorizations = [];
  const window = await installTransport({
    nativeFetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      authorizations.push(new Headers(init.headers).get("Authorization"));
      if (url.pathname === "/management/verify") {
        return new Response(JSON.stringify({ managementToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (url.pathname === "/management/logout") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ subscriptions: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  await window.fetch("https://176-123-165-120.sslip.io/management/verify", { method: "POST", body: "{}" });
  await window.fetch("https://176-123-165-120.sslip.io/management/logout", { method: "POST" });
  await window.fetch("https://176-123-165-120.sslip.io/management/subscriptions");

  assert.equal(authorizations[1], `Bearer ${managementToken}`);
  assert.equal(authorizations[2], null);
});

test("management session script is loaded before Google and base management modules", async () => {
  const html = await readFile(new URL("../landing/manage/index.html", import.meta.url), "utf8");
  const transportIndex = html.indexOf("session-transport.js");
  const googleIndex = html.indexOf("google-calendar.js");
  const manageIndex = html.indexOf("manage.js");
  assert.ok(transportIndex >= 0);
  assert.ok(googleIndex > transportIndex);
  assert.ok(manageIndex > googleIndex);
});
