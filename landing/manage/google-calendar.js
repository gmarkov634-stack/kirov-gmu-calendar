const GOOGLE_OAUTH_MESSAGE_TYPE = "kgmu.google-calendar.oauth.v1";
const GOOGLE_AUTH_ORIGIN = "https://accounts.google.com";
const GOOGLE_AUTH_PATH = "/o/oauth2/v2/auth";

export function parseGoogleOAuthReturn(value) {
  const url = value instanceof URL ? value : new URL(String(value), "https://invalid.local/");
  const statusValues = url.searchParams.getAll("googleCalendar");
  const subscriptionValues = url.searchParams.getAll("subscriptionId");
  if (statusValues.length !== 1 || !["select", "error"].includes(statusValues[0])) return null;
  if (statusValues[0] === "select") {
    if (subscriptionValues.length !== 1 || subscriptionValues[0].length === 0) return null;
    return Object.freeze({ status: "select", subscriptionId: subscriptionValues[0] });
  }
  if (subscriptionValues.length > 1) return null;
  return Object.freeze({ status: "error", subscriptionId: subscriptionValues[0] || null });
}

export function validateGoogleAuthorizationUrl(value) {
  const url = new URL(String(value));
  if (url.origin !== GOOGLE_AUTH_ORIGIN || url.pathname !== GOOGLE_AUTH_PATH || url.protocol !== "https:") {
    throw new Error("Некорректный адрес Google OAuth.");
  }
  if (!url.searchParams.get("state") || !url.searchParams.get("code_challenge")) {
    throw new Error("Некорректный адрес Google OAuth.");
  }
  return url.toString();
}

export function normalizeGoogleCalendarCandidates(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((candidate) => candidate && typeof candidate.id === "string" && candidate.id.length > 0)
    .map((candidate) => Object.freeze({
      id: candidate.id,
      summary: typeof candidate.summary === "string" && candidate.summary.length > 0
        ? candidate.summary
        : candidate.id,
      primary: candidate.primary === true,
      selected: candidate.selected === true
    }));
}

function runtimeConfig() {
  return Object.freeze({
    apiBase: "",
    managementSessionTransport: "cookie",
    googleCalendarEnabled: false,
    ...(globalThis.KGMU_CALENDAR_CONFIG ?? {})
  });
}

function apiUrl(config, path) {
  return new URL(path, config.apiBase || window.location.origin).toString();
}

function googlePath(subscriptionId, action = "") {
  const base = `/management/subscriptions/${encodeURIComponent(subscriptionId)}/google-calendar`;
  return action ? `${base}/${action}` : base;
}

async function apiRequest(config, path, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers ?? {})
  };
  const response = await fetch(apiUrl(config, path), {
    mode: "cors",
    credentials: config.managementSessionTransport === "bearer" ? "omit" : "include",
    cache: "no-store",
    ...options,
    headers
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload };
}

function cleanupOAuthReturn() {
  const url = new URL(window.location.href);
  url.searchParams.delete("googleCalendar");
  url.searchParams.delete("subscriptionId");
  history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

function forwardOAuthPopupReturn() {
  const result = parseGoogleOAuthReturn(window.location.href);
  if (!result || !window.opener || window.opener === window) return false;
  cleanupOAuthReturn();
  window.opener.postMessage({ type: GOOGLE_OAUTH_MESSAGE_TYPE, ...result }, window.location.origin);
  window.close();
  return true;
}

function button(text, className = "button button-secondary") {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = text;
  return node;
}

function statusNode() {
  const node = document.createElement("p");
  node.className = "preference-local-status google-calendar-status";
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  return node;
}

function setPanelStatus(panel, text, kind = "") {
  panel.status.textContent = text;
  panel.status.className = `preference-local-status google-calendar-status${kind ? ` ${kind}` : ""}`;
}

function renderCandidates(panel, candidates, onSelect) {
  panel.candidates.replaceChildren();
  const normalized = normalizeGoogleCalendarCandidates(candidates);
  if (!normalized.length) {
    const empty = document.createElement("p");
    empty.className = "preference-empty";
    empty.textContent = "В аккаунте Google не найдено доступных календарей.";
    panel.candidates.append(empty);
    return;
  }

  const intro = document.createElement("p");
  intro.className = "google-calendar-candidate-help";
  intro.textContent = "Выберите именно тот подписной календарь КГМУ, который вы добавили в Google Calendar. Мы не выбираем календарь автоматически по названию.";
  const choices = document.createElement("div");
  choices.className = "google-calendar-candidates";
  const select = button("Применить к выбранному календарю", "button button-primary");
  select.disabled = true;
  let selectedId = null;

  for (const candidate of normalized) {
    const label = document.createElement("label");
    label.className = "google-calendar-candidate";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = `google-calendar-${panel.subscriptionId}`;
    radio.value = candidate.id;
    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = candidate.summary;
    text.append(title);
    if (candidate.primary) {
      const hint = document.createElement("small");
      hint.textContent = "Основной календарь аккаунта";
      text.append(hint);
    }
    radio.addEventListener("change", () => {
      selectedId = radio.value;
      select.disabled = false;
    });
    label.append(radio, text);
    choices.append(label);
  }

  select.addEventListener("click", () => {
    if (selectedId) onSelect(selectedId, select);
  });
  panel.candidates.append(intro, choices, select);
}

function createPanel(item, config, popupState) {
  const subscriptionId = item.subscription.subscriptionId;
  const section = document.createElement("section");
  section.className = "preference-panel google-calendar-panel";
  section.dataset.googleCalendarPanel = "true";
  section.dataset.subscriptionId = subscriptionId;

  const heading = document.createElement("div");
  heading.className = "preference-heading";
  const strong = document.createElement("strong");
  strong.textContent = "Уведомления Google Calendar / Android";
  const hint = document.createElement("span");
  hint.textContent = "ICS остаётся источником расписания";
  heading.append(strong, hint);

  const description = document.createElement("p");
  description.className = "google-calendar-description";
  description.textContent = "Подключение Google меняет только стандартные уведомления выбранного вами существующего календаря. Ссылка ICS, подписка и доступ не пересоздаются.";

  const actions = document.createElement("div");
  actions.className = "subscription-actions google-calendar-actions";
  const connect = button("Подключить Google Calendar");
  const disconnect = button("Отключить Google", "button button-secondary");
  disconnect.hidden = true;
  actions.append(connect, disconnect);

  const status = statusNode();
  const candidates = document.createElement("div");
  candidates.className = "google-calendar-selection";
  section.append(heading, description, actions, status, candidates);

  const panel = { section, subscriptionId, connect, disconnect, status, candidates };

  async function loadStatus() {
    const { response, payload } = await apiRequest(config, googlePath(subscriptionId), { method: "GET" });
    if (response.status === 401) throw new Error("Сессия управления истекла.");
    if (!response.ok || !payload?.googleCalendar) throw new Error("Не удалось проверить подключение Google.");
    const connected = payload.googleCalendar.connected === true;
    connect.textContent = connected ? "Переподключить Google Calendar" : "Подключить Google Calendar";
    disconnect.hidden = !connected;
    setPanelStatus(
      panel,
      connected
        ? "Google Calendar подключён. Изменения напоминаний синхронизируются после сохранения настроек."
        : "Google Calendar пока не подключён."
    );
  }

  async function loadCandidates() {
    candidates.replaceChildren();
    setPanelStatus(panel, "Получаем список календарей из вашего Google аккаунта…");
    const { response, payload } = await apiRequest(config, googlePath(subscriptionId, "candidates"), { method: "GET" });
    if (response.status === 409) throw new Error("Время выбора календаря истекло. Подключите Google ещё раз.");
    if (!response.ok || !Array.isArray(payload?.candidates)) throw new Error("Не удалось получить список календарей Google.");
    setPanelStatus(panel, "Выберите календарь вручную.");
    renderCandidates(panel, payload.candidates, async (googleCalendarId, selectButton) => {
      selectButton.disabled = true;
      setPanelStatus(panel, "Применяем текущие напоминания к выбранному календарю…");
      try {
        const selected = await apiRequest(config, googlePath(subscriptionId, "select"), {
          method: "POST",
          body: JSON.stringify({ googleCalendarId })
        });
        if (!selected.response.ok || !selected.payload?.googleCalendar?.connected) {
          throw new Error("Не удалось подключить выбранный календарь.");
        }
        candidates.replaceChildren();
        connect.textContent = "Переподключить Google Calendar";
        disconnect.hidden = false;
        const sync = selected.payload.googleCalendar.reminderSync;
        setPanelStatus(
          panel,
          sync === "synced"
            ? "Google Calendar подключён, текущие напоминания применены."
            : "Google Calendar подключён. Первичная синхронизация не завершилась; сохраните настройки напоминаний ещё раз для повтора.",
          sync === "synced" ? "success" : ""
        );
      } catch (error) {
        setPanelStatus(panel, error instanceof Error ? error.message : "Не удалось подключить календарь.", "error");
        selectButton.disabled = false;
      }
    });
  }

  connect.addEventListener("click", async () => {
    const popup = window.open("about:blank", "kgmu-google-calendar-oauth", "popup,width=520,height=720");
    if (!popup) {
      setPanelStatus(panel, "Браузер заблокировал окно Google. Разрешите всплывающие окна и повторите.", "error");
      return;
    }
    popup.document.title = "Подключение Google Calendar";
    popup.document.body.textContent = "Открываем Google…";
    popupState.set(subscriptionId, popup);
    connect.disabled = true;
    candidates.replaceChildren();
    setPanelStatus(panel, "Открываем безопасное подключение Google…");
    try {
      const { response, payload } = await apiRequest(config, googlePath(subscriptionId, "connect"), { method: "POST" });
      if (!response.ok || typeof payload?.authorizationUrl !== "string") throw new Error("Не удалось начать подключение Google.");
      popup.location.replace(validateGoogleAuthorizationUrl(payload.authorizationUrl));
    } catch (error) {
      popupState.delete(subscriptionId);
      popup.close();
      setPanelStatus(panel, error instanceof Error ? error.message : "Не удалось начать подключение Google.", "error");
    } finally {
      connect.disabled = false;
    }
  });

  disconnect.addEventListener("click", async () => {
    disconnect.disabled = true;
    candidates.replaceChildren();
    setPanelStatus(panel, "Отключаем только Google-интеграцию…");
    try {
      const { response, payload } = await apiRequest(config, googlePath(subscriptionId, "disconnect"), { method: "POST" });
      if (!response.ok || payload?.googleCalendar?.connected !== false) throw new Error("Не удалось отключить Google.");
      connect.textContent = "Подключить Google Calendar";
      disconnect.hidden = true;
      setPanelStatus(panel, "Google отключён. Ваша ICS-подписка и её ссылка не изменены.", "success");
    } catch (error) {
      setPanelStatus(panel, error instanceof Error ? error.message : "Не удалось отключить Google.", "error");
    } finally {
      disconnect.disabled = false;
    }
  });

  panel.loadStatus = loadStatus;
  panel.loadCandidates = loadCandidates;
  return panel;
}

function bootstrapGoogleCalendarManagement() {
  if (forwardOAuthPopupReturn()) return;
  const config = runtimeConfig();
  if (!config.googleCalendarEnabled || !config.managementEnabled) return;

  const list = document.querySelector("#subscription-list");
  if (!list) return;
  const panels = new Map();
  const popupState = new Map();
  let decorating = false;

  async function decorate() {
    if (decorating) return;
    const cards = [...list.querySelectorAll(".subscription-item")];
    if (!cards.length) return;
    decorating = true;
    try {
      const { response, payload } = await apiRequest(config, "/management/subscriptions", { method: "GET" });
      if (!response.ok || !Array.isArray(payload?.subscriptions)) return;
      for (let index = 0; index < Math.min(cards.length, payload.subscriptions.length); index += 1) {
        const item = payload.subscriptions[index];
        const subscriptionId = item?.subscription?.subscriptionId;
        if (typeof subscriptionId !== "string" || panels.has(subscriptionId)) continue;
        const panel = createPanel(item, config, popupState);
        panels.set(subscriptionId, panel);
        cards[index].append(panel.section);
        panel.loadStatus().catch((error) => {
          setPanelStatus(panel, error instanceof Error ? error.message : "Не удалось проверить Google.", "error");
        });
      }
    } finally {
      decorating = false;
    }
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || event.data?.type !== GOOGLE_OAUTH_MESSAGE_TYPE) return;
    const subscriptionId = event.data?.subscriptionId;
    if (typeof subscriptionId !== "string" || !panels.has(subscriptionId)) return;
    const popup = popupState.get(subscriptionId);
    if (!popup || event.source !== popup) return;
    popupState.delete(subscriptionId);
    const panel = panels.get(subscriptionId);
    if (event.data.status === "select") {
      panel.loadCandidates().catch((error) => {
        setPanelStatus(panel, error instanceof Error ? error.message : "Не удалось продолжить подключение Google.", "error");
      });
    } else if (event.data.status === "error") {
      setPanelStatus(panel, "Google OAuth не завершён. Повторите подключение.", "error");
    }
  });

  const observer = new MutationObserver(() => void decorate());
  observer.observe(list, { childList: true });
  void decorate();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  bootstrapGoogleCalendarManagement();
}
