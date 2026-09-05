(() => {
  const originalFetch = window.fetch.bind(window);
  const config = Object.freeze({
    apiBase: "",
    ...(globalThis.KGMU_CALENDAR_CONFIG ?? {})
  });
  let latestSubscriptions = [];

  function absoluteCalendarUrl(calendarPath) {
    return new URL(calendarPath, config.apiBase || window.location.origin).toString();
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
    setTimeout(() => { button.textContent = previous; }, 1800);
  }

  function isSubscriptionsRequest(input, init) {
    try {
      const raw = typeof input === "string" ? input : input?.url;
      const url = new URL(raw, window.location.origin);
      const method = String(init?.method ?? (typeof input === "object" ? input?.method : "GET") ?? "GET").toUpperCase();
      return method === "GET" && url.pathname === "/management/subscriptions";
    } catch {
      return false;
    }
  }

  function hasPaidAccess(item) {
    return Array.isArray(item?.entitlements)
      && item.entitlements.some((entitlement) => entitlement?.status === "active");
  }

  function currentLinkPanel(item) {
    const panel = document.createElement("div");
    panel.className = "recovery-output current-calendar-link";
    panel.dataset.currentCalendarLink = "true";

    const title = document.createElement("strong");
    title.textContent = "Ваша действующая ссылка на календарь";
    panel.append(title);

    if (typeof item?.subscription?.calendarPath !== "string" || !item.subscription.calendarPath) {
      const note = document.createElement("p");
      note.textContent = "Ссылка ещё не сохранена для безопасного показа. Она появится здесь после очередного обновления уже подключённого календаря. Сброс используйте только если ссылка действительно потеряна.";
      panel.append(note);
      return panel;
    }

    const url = absoluteCalendarUrl(item.subscription.calendarPath);
    const explanation = document.createElement("p");
    explanation.textContent = "Это текущая ссылка. Кнопки ниже не меняют её и не сбрасывают подписку.";

    const row = document.createElement("div");
    row.className = "copy-row";
    const input = document.createElement("input");
    input.readOnly = true;
    input.value = url;
    input.setAttribute("aria-label", "Действующая ICS-ссылка");
    row.append(input);

    const actions = document.createElement("div");
    actions.className = "subscription-actions current-calendar-actions";

    const iphone = document.createElement("a");
    iphone.className = "button button-primary";
    iphone.href = webcalUrl(url);
    iphone.textContent = "Добавить в iPhone";

    const google = document.createElement("button");
    google.type = "button";
    google.className = "button button-secondary";
    google.textContent = "Скопировать для Google Calendar";
    google.addEventListener("click", () => {
      copyText(google, url).catch(() => {
        input.focus();
        input.select();
      });
    });

    actions.append(iphone, google);
    panel.append(explanation, row, actions);
    return panel;
  }

  function decorate() {
    const list = document.querySelector("#subscription-list");
    if (!list || !latestSubscriptions.length) return;
    const cards = [...list.querySelectorAll(":scope > .subscription-item")];
    for (let index = 0; index < Math.min(cards.length, latestSubscriptions.length); index += 1) {
      const card = cards[index];
      const item = latestSubscriptions[index];
      if (!hasPaidAccess(item) || card.querySelector("[data-current-calendar-link='true']")) continue;
      const panel = currentLinkPanel(item);
      const destructiveActions = card.querySelector(":scope > .subscription-actions");
      if (destructiveActions) card.insertBefore(panel, destructiveActions);
      else card.append(panel);
    }
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    if (isSubscriptionsRequest(args[0], args[1]) && response.ok) {
      response.clone().json().then((payload) => {
        if (Array.isArray(payload?.subscriptions)) {
          latestSubscriptions = payload.subscriptions;
          queueMicrotask(decorate);
          setTimeout(decorate, 0);
        }
      }).catch(() => {});
    }
    return response;
  };

  const observer = new MutationObserver(decorate);
  const start = () => {
    const list = document.querySelector("#subscription-list");
    if (list) observer.observe(list, { childList: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
