(() => {
  "use strict";

  const data = window.CALENDAR_DATA;
  if (!data?.apiBase || !data?.offer) return;

  const originalFetch = window.fetch.bind(window);
  const sessionKey = "kgmu-calendar-journey-v1";
  const sent = new Set();
  const state = {
    journeyId: "",
    context: null,
    purchasePath: null,
    plan: null,
  };

  function randomJourneyId() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }

  function journeyId() {
    if (state.journeyId) return state.journeyId;
    try {
      const saved = sessionStorage.getItem(sessionKey);
      if (/^[a-f0-9]{32}$/.test(saved || "")) {
        state.journeyId = saved;
        return saved;
      }
      const created = randomJourneyId();
      sessionStorage.setItem(sessionKey, created);
      state.journeyId = created;
      return created;
    } catch {
      state.journeyId = randomJourneyId();
      return state.journeyId;
    }
  }

  function attribution() {
    const params = new URLSearchParams(window.location.search);
    const value = (name, fallback = "") => String(params.get(name) || fallback).slice(0, 160);
    return {
      source: value("utm_source", value("source")),
      medium: value("utm_medium", value("medium")),
      campaign: value("utm_campaign", value("campaign")),
      content: value("utm_content", value("content")),
      referral: value("ref", value("referral")),
    };
  }

  function basePayload() {
    return {
      journeyId: journeyId(),
      university: state.context?.university || data.university || "kgmu",
      program: state.context?.program || null,
      course: state.context?.course || null,
      groupCode: state.context?.groupCode || null,
      groupId: state.context?.groupId || null,
      academicYear: data.offer.academicYear,
      semester: data.offer.semester,
      purchasePath: state.purchasePath,
      plan: state.plan,
      ...attribution(),
    };
  }

  function dedupeKey(event, extra = {}) {
    const payload = basePayload();
    return [
      event,
      payload.university,
      payload.program,
      payload.course,
      payload.groupId,
      extra.channel || "",
      extra.plan || payload.plan || "",
      extra.orderId || "",
      extra.conversionId || "",
    ].join("|");
  }

  function postEvent(event, extra = {}, { dedupe = true } = {}) {
    const key = dedupeKey(event, extra);
    if (dedupe && sent.has(key)) return;
    if (dedupe) sent.add(key);
    const body = JSON.stringify({ ...basePayload(), ...extra, event });
    originalFetch(`${data.apiBase}/api/v2/analytics`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      cache: "no-store",
    }).catch(() => {
      // Analytics is best-effort and must never block the product flow.
    });
  }

  function parseUrl(input) {
    try {
      const raw = typeof input === "string" ? input : input?.url;
      return new URL(raw, window.location.href);
    } catch {
      return null;
    }
  }

  function methodOf(input, init) {
    return String(init?.method || input?.method || "GET").toUpperCase();
  }

  function jsonBody(init) {
    if (typeof init?.body !== "string") return {};
    try {
      const value = JSON.parse(init.body);
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function contextFromPreview(body) {
    if (!body?.group?.groupId || !body?.group?.groupCode) return null;
    return {
      university: String(body.university || data.university || "kgmu"),
      program: String(body.program || ""),
      course: Number(body.course),
      groupCode: String(body.group.groupCode),
      groupId: String(body.group.groupId),
    };
  }

  function contextFromFlat(body) {
    const groupCode = body?.groupCode || body?.group;
    if (!body?.university || !body?.program || !body?.course || !groupCode || !body?.groupId) return null;
    return {
      university: String(body.university),
      program: String(body.program),
      course: Number(body.course),
      groupCode: String(groupCode),
      groupId: String(body.groupId),
    };
  }

  async function readClone(response) {
    try {
      return await response.clone().json();
    } catch {
      return null;
    }
  }

  window.fetch = async function trackedFetch(input, init) {
    const url = parseUrl(input);
    const method = methodOf(input, init);
    const pathname = url?.pathname || "";
    const requestBody = jsonBody(init);

    if (method === "POST" && pathname === "/api/v2/trials") {
      state.purchasePath = "trial_to_paid";
      if (requestBody.program && requestBody.groupId) {
        state.context = {
          university: String(requestBody.university || data.university || "kgmu"),
          program: String(requestBody.program),
          course: Number(requestBody.course),
          groupCode: String(requestBody.groupCode || ""),
          groupId: String(requestBody.groupId),
        };
      }
      postEvent("trial_cta_clicked");
    }

    if (method === "POST" && pathname === "/api/v2/payments") {
      state.plan = ["semester", "year"].includes(requestBody.plan) ? requestBody.plan : null;
      state.purchasePath = requestBody.conversionId ? "trial_to_paid" : "direct_purchase";
      if (requestBody.program && requestBody.groupId) {
        state.context = {
          university: String(requestBody.university || data.university || "kgmu"),
          program: String(requestBody.program),
          course: Number(requestBody.course),
          groupCode: String(requestBody.groupCode || ""),
          groupId: String(requestBody.groupId),
        };
      }
      postEvent("checkout_started", { plan: state.plan, purchasePath: state.purchasePath });
    }

    const response = await originalFetch(input, init);

    const previewMatch = pathname.match(/^\/api\/v2\/catalog\/[^/]+\/[^/]+\/\d+\/[^/]+\/preview$/);
    if (method === "GET" && previewMatch && response.ok) {
      const body = await readClone(response);
      const context = contextFromPreview(body);
      if (context) {
        state.context = context;
        postEvent("group_selected");
      }
    }

    if (method === "POST" && pathname === "/api/v2/trials" && response.ok) {
      const body = await readClone(response);
      if (/^[A-Za-z0-9_-]{43}$/.test(String(body?.conversionId || ""))) {
        postEvent("trial_linked", { conversionId: body.conversionId }, { dedupe: false });
      }
    }

    if (method === "GET" && pathname.startsWith("/api/v2/trials/continue/") && response.ok) {
      const body = await readClone(response);
      const context = contextFromFlat(body);
      if (context) state.context = context;
      state.purchasePath = "trial_to_paid";
      postEvent("offer_view", { purchasePath: "trial_to_paid" });
    }

    if (method === "POST" && pathname === "/api/v2/payments" && response.ok) {
      const body = await readClone(response);
      if (/^[A-Za-z0-9_-]{32}$/.test(String(body?.orderId || ""))) {
        postEvent("order_linked", {
          orderId: body.orderId,
          ...(requestBody.conversionId ? { conversionId: requestBody.conversionId } : {}),
        }, { dedupe: false });
      }
    }

    const orderMatch = pathname.match(/^\/api\/v1\/orders\/[A-Za-z0-9_-]{32}$/);
    if (method === "GET" && orderMatch && response.ok) {
      const body = await readClone(response);
      const context = contextFromFlat(body);
      if (context) state.context = context;
      if (body?.purchasePath) state.purchasePath = body.purchasePath;
      if (body?.plan) state.plan = body.plan;
      if (body?.status === "succeeded" && body?.subscriptionUrl) {
        postEvent("paid_link_shown", { purchasePath: state.purchasePath, plan: state.plan });
      }
    }

    return response;
  };

  function checkoutVisible() {
    if (!document.querySelector("#checkout-form") || !state.context) return;
    postEvent("offer_view", { purchasePath: state.purchasePath, plan: state.plan });
  }

  const observer = new MutationObserver(() => checkoutVisible());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("click", (event) => {
    const target = event.target.closest("a, button");
    if (!target) return;
    const text = String(target.textContent || "").trim();
    const trialCard = target.closest(".trial-connect-card");
    const resultCard = target.closest(".result-card");

    if (text.startsWith("Купить полный доступ")) {
      state.purchasePath = "direct_purchase";
      postEvent("direct_purchase_clicked", { purchasePath: "direct_purchase" });
      return;
    }

    if (trialCard && text.startsWith("Подключить на iPhone")) {
      postEvent("trial_connect_clicked", { channel: "iphone", purchasePath: "trial_to_paid" });
      return;
    }
    if (trialCard && text.startsWith("Скопировать для Google Calendar")) {
      postEvent("trial_connect_clicked", { channel: "google", purchasePath: "trial_to_paid" });
      return;
    }

    if (resultCard && text === "Подключить календарь") {
      postEvent("paid_connect_clicked", { channel: "iphone", purchasePath: state.purchasePath, plan: state.plan });
      return;
    }
    if (resultCard && text.startsWith("Скопировать для Google Calendar")) {
      postEvent("paid_connect_clicked", { channel: "google", purchasePath: state.purchasePath, plan: state.plan });
    }
  }, true);

  postEvent("landing_view");
  postEvent("university_view");
})();
