(() => {
  const config = Object.freeze({
    apiBase: "",
    managementSessionTransport: "cookie",
    ...(globalThis.KGMU_CALENDAR_CONFIG ?? {})
  });
  const HANDOFF_KEY = "kgmu-calendar:paid-handoff-v1";
  const nativeFetch = globalThis.fetch.bind(globalThis);
  let managementToken = null;
  let processing = false;

  function apiUrl(path) {
    return new URL(path, config.apiBase || window.location.origin).toString();
  }

  function absoluteCalendarUrl(path) {
    return new URL(path, config.apiBase || window.location.origin).toString();
  }

  function usesBearerSession() {
    return config.managementSessionTransport === "bearer";
  }

  function readHandoff() {
    try {
      const raw = sessionStorage.getItem(HANDOFF_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
      if (typeof parsed.subscriptionId !== "string" || parsed.subscriptionId.length === 0) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function clearHandoff() {
    try {
      sessionStorage.removeItem(HANDOFF_KEY);
    } catch {
      // No persistent browser state is required after management is established.
    }
  }

  function requestUrl(input) {
    if (typeof input === "string") return new URL(input, window.location.href);
    if (input instanceof URL) return input;
    if (input && typeof input.url === "string") return new URL(input.url, window.location.href);
    return null;
  }

  function webcalUrl(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported calendar URL");
    }
    return `webcal://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  async function copyText(button, text) {
    await navigator.clipboard.writeText(text);
    const previous = button.textContent;
    button.textContent = "Скопировано";
    setTimeout(() => { button.textContent = previous; }, 1600);
  }

  function iphoneAction(url) {
    const iphone = document.createElement("a");
    iphone.className = "button button-primary";
    iphone.href = webcalUrl(url);
    iphone.textContent = "Добавить в iPhone";
    return iphone;
  }

  function iphoneReminderGuidance() {
    const note = document.createElement("p");
    note.className = "preference-local-status iphone-reminder-guidance";
    note.setAttribute("data-iphone-reminder-guidance", "true");
    note.textContent = "На iPhone на экране «Сведения о подписке» выключите «Удаление напоминаний». Иначе iOS удалит уведомления из подписного календаря.";
    return note;
  }

  function googleCopyAction(url) {
    const google = document.createElement("button");
    google.type = "button";
    google.className = "button button-secondary";
    google.textContent = "Скопировать для Google Calendar";
    google.addEventListener("click", () => copyText(google, url).catch(() => {
      google.textContent = "Не удалось скопировать";
    }));
    return google;
  }

  function calendarActions(url, { includeGoogle = true } = {}) {
    const actions = document.createElement("div");
    actions.className = "calendar-link-actions";
    actions.append(iphoneAction(url));
    if (includeGoogle) actions.append(googleCopyAction(url));
    return actions;
  }

  function findSubscriptionCard(subscriptionId, subscriptions) {
    const index = subscriptions.findIndex((item) => item?.subscription?.subscriptionId === subscriptionId);
    if (index < 0) return null;
    return document.querySelectorAll("#subscription-list .subscription-item")[index] ?? null;
  }

  function renderInitialLink(url, subscriptionId, subscriptions) {
    const card = findSubscriptionCard(subscriptionId, subscriptions);
    if (!card) {
      setTimeout(() => renderInitialLink(url, subscriptionId, subscriptions), 80);
      return;
    }
    if (card.querySelector("[data-initial-calendar-link]")) return;

    const output = document.createElement("section");
    output.className = "recovery-output initial-calendar-output";
    output.dataset.initialCalendarLink = "true";
    output.dataset.calendarActionsReady = "true";

    const title = document.createElement("strong");
    title.textContent = "Календарь готов к подключению";
    const copy = document.createElement("p");
    copy.textContent = "Ссылка создана после подтверждённой оплаты. Добавьте календарь на iPhone или скопируйте ссылку для Google Calendar.";
    const row = document.createElement("div");
    row.className = "copy-row";
    const input = document.createElement("input");
    input.readOnly = true;
    input.value = url;
    row.append(input);

    output.append(title, copy, row, calendarActions(url), iphoneReminderGuidance());
    card.insertBefore(output, card.querySelector(".preference-panel") ?? null);

    const status = document.querySelector("#management-status");
    if (status) {
      status.textContent = "Оплата подтверждена. Календарь можно подключить сейчас.";
      status.className = "manage-status success";
    }
  }

  function decorateRecoveryOutputs() {
    for (const output of document.querySelectorAll(".recovery-output")) {
      if (output.dataset.calendarActionsReady === "true") continue;
      const input = output.querySelector(".copy-row input");
      if (!input || !/^https?:\/\//.test(input.value)) continue;
      output.dataset.calendarActionsReady = "true";
      const existingCopy = output.querySelector(".copy-row button");
      if (existingCopy) existingCopy.textContent = "Скопировать для Google Calendar";
      output.append(calendarActions(input.value, { includeGoogle: !existingCopy }), iphoneReminderGuidance());
    }
  }

  async function recoverInitialLink(handoff, subscriptions) {
    if (processing || handoff.initialLinkRequired !== true) return;
    const target = subscriptions.find((item) => item?.subscription?.subscriptionId === handoff.subscriptionId);
    if (!target) return;
    processing = true;

    // Consume browser handoff before rotation so a reload cannot automatically
    // rotate a second time if the first response is lost after the server commits.
    clearHandoff();

    const headers = { "Content-Type": "application/json" };
    if (usesBearerSession() && managementToken) {
      headers.Authorization = `Bearer ${managementToken}`;
    }
    try {
      const response = await nativeFetch(apiUrl("/management/recover"), {
        method: "POST",
        mode: "cors",
        credentials: usesBearerSession() ? "omit" : "include",
        cache: "no-store",
        headers,
        body: JSON.stringify({ subscriptionId: handoff.subscriptionId })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || typeof payload?.calendarPath !== "string") {
        throw new Error("initial_calendar_link_failed");
      }
      renderInitialLink(
        absoluteCalendarUrl(payload.calendarPath),
        handoff.subscriptionId,
        subscriptions
      );
    } catch {
      const status = document.querySelector("#management-status");
      if (status) {
        status.textContent = "Оплата подтверждена, но автоматическая выдача ссылки не завершилась. Используйте «Сбросить потерянную ссылку» у этой подписки.";
        status.className = "manage-status error";
      }
    } finally {
      processing = false;
    }
  }

  function showPaidSessionStatus(handoff) {
    clearHandoff();
    const status = document.querySelector("#management-status");
    if (status) {
      status.textContent = "Оплата подтверждена. Управление календарём открыто без повторного подтверждения email.";
      status.className = "manage-status success";
    }
  }

  globalThis.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const response = await nativeFetch(input, init);
    if (!url) return response;

    if (url.pathname.endsWith("/management/verify") && response.ok && usesBearerSession()) {
      try {
        const payload = await response.clone().json();
        if (typeof payload?.managementToken === "string") managementToken = payload.managementToken;
      } catch {
        // The normal management client will surface a malformed verify response.
      }
    }

    if (url.pathname.endsWith("/management/subscriptions") && response.ok) {
      response.clone().json().then((payload) => {
        if (!Array.isArray(payload?.subscriptions)) return;
        const handoff = readHandoff();
        if (!handoff) return;
        setTimeout(() => {
          if (handoff.initialLinkRequired === true) {
            recoverInitialLink(handoff, payload.subscriptions);
          } else {
            showPaidSessionStatus(handoff);
          }
        }, 0);
      }).catch(() => null);
    }

    return response;
  };

  const observer = new MutationObserver(decorateRecoveryOutputs);
  const list = document.querySelector("#subscription-list");
  if (list) observer.observe(list, { childList: true, subtree: true });

  const handoff = readHandoff();
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  if (handoff && fragment.get("token")) {
    const form = document.querySelector("#management-link-form");
    if (form) form.hidden = true;
    const status = document.querySelector("#management-status");
    if (status) status.textContent = "Оплата подтверждается. Открываем управление календарём…";
  }
})();
