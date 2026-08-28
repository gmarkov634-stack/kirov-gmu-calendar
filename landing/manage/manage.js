const config = Object.freeze({
  apiBase: "",
  managementEnabled: false,
  managementSessionTransport: "cookie",
  ...(globalThis.KGMU_CALENDAR_CONFIG ?? {})
});

const linkForm = document.querySelector("#management-link-form");
const emailInput = document.querySelector("#management-email");
const linkSubmit = document.querySelector("#management-link-submit");
const statusNode = document.querySelector("#management-status");
const sessionSection = document.querySelector("#management-session");
const listNode = document.querySelector("#subscription-list");
const logoutButton = document.querySelector("#management-logout");

let managementToken = null;

function usesBearerSession() {
  return config.managementSessionTransport === "bearer";
}

function apiUrl(path) {
  return new URL(path, config.apiBase || window.location.origin).toString();
}

function absoluteCalendarUrl(calendarPath) {
  return new URL(calendarPath, config.apiBase || window.location.origin).toString();
}

function setStatus(text, kind = "") {
  statusNode.textContent = text;
  statusNode.className = `manage-status${kind ? ` ${kind}` : ""}`;
}

function fragmentToken() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return params.get("token");
}

async function request(path, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers ?? {})
  };
  if (usesBearerSession() && managementToken) {
    headers.Authorization = `Bearer ${managementToken}`;
  }

  const response = await fetch(apiUrl(path), {
    mode: "cors",
    credentials: usesBearerSession() ? "omit" : "include",
    cache: "no-store",
    ...options,
    headers
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, payload };
}

function entitlementLabel(entitlement) {
  if (entitlement.status === "trial") return `Trial до ${new Date(entitlement.trialExpiresAt).toLocaleString("ru-RU")}`;
  if (entitlement.status === "active") return "Активный доступ";
  return entitlement.status ?? "Доступ";
}

async function copyText(button, text) {
  await navigator.clipboard.writeText(text);
  const previous = button.textContent;
  button.textContent = "Скопировано";
  setTimeout(() => { button.textContent = previous; }, 1800);
}

function renderSubscriptions(items) {
  listNode.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.textContent = "Подписок для этого Customer пока нет.";
    listNode.append(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "subscription-item";

    const title = document.createElement("h3");
    title.textContent = `${item.subscription.universityId} · группа ${item.subscription.groupId}`;

    const meta = document.createElement("p");
    meta.className = "subscription-meta";
    meta.textContent = `${item.subscription.academicYearId} · ${item.entitlements.map(entitlementLabel).join(" · ")}`;

    const actions = document.createElement("div");
    actions.className = "subscription-actions";

    const recover = document.createElement("button");
    recover.type = "button";
    recover.className = "button button-secondary";
    recover.textContent = "Сбросить потерянную ссылку";
    recover.addEventListener("click", async () => {
      if (!window.confirm("Старая ICS-ссылка перестанет работать. Создать новую?")) return;
      recover.disabled = true;
      setStatus("Отзываем старую ссылку и создаём новую…");
      try {
        const { response, payload } = await request("/management/recover", {
          method: "POST",
          body: JSON.stringify({ subscriptionId: item.subscription.subscriptionId })
        });
        if (!response.ok || typeof payload?.calendarPath !== "string") {
          throw new Error("Не удалось восстановить ссылку.");
        }
        const url = absoluteCalendarUrl(payload.calendarPath);
        const output = document.createElement("div");
        output.className = "recovery-output";
        output.innerHTML = "<strong>Новая ICS-ссылка создана.</strong><p>Старая ссылка уже отозвана. Скопируйте новую сейчас.</p>";
        const row = document.createElement("div");
        row.className = "copy-row";
        const input = document.createElement("input");
        input.readOnly = true;
        input.value = url;
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "button button-primary";
        copy.textContent = "Скопировать";
        copy.addEventListener("click", () => copyText(copy, url));
        row.append(input, copy);
        output.append(row);
        card.append(output);
        setStatus("Новая ссылка создана.", "success");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Не удалось восстановить ссылку.", "error");
      } finally {
        recover.disabled = false;
      }
    });

    actions.append(recover);
    card.append(title, meta, actions);
    listNode.append(card);
  }
}

async function loadSubscriptions() {
  const { response, payload } = await request("/management/subscriptions", { method: "GET" });
  if (response.status === 401) {
    sessionSection.hidden = true;
    return false;
  }
  if (!response.ok || !Array.isArray(payload?.subscriptions)) {
    throw new Error("Не удалось загрузить подписки.");
  }
  renderSubscriptions(payload.subscriptions);
  sessionSection.hidden = false;
  return true;
}

async function verifyFragment() {
  const token = fragmentToken();
  if (!token) return false;
  history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  setStatus("Подтверждаем одноразовую ссылку…");
  const { response, payload } = await request("/management/verify", {
    method: "POST",
    body: JSON.stringify({ magicToken: token })
  });
  if (!response.ok) {
    setStatus("Ссылка недействительна, использована или истекла.", "error");
    return false;
  }
  if (usesBearerSession()) {
    if (typeof payload?.managementToken !== "string" || payload.managementToken.length < 32) {
      setStatus("Не удалось создать сессию управления.", "error");
      return false;
    }
    managementToken = payload.managementToken;
  }
  setStatus("Email подтверждён.", "success");
  await loadSubscriptions();
  return true;
}

linkForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!config.managementEnabled) {
    setStatus("Управление ещё не включено на production.", "error");
    return;
  }
  linkSubmit.disabled = true;
  setStatus("Отправляем одноразовую ссылку…");
  try {
    const { response } = await request("/management/link", {
      method: "POST",
      body: JSON.stringify({ email: emailInput.value.trim() })
    });
    if (!response.ok) throw new Error("Не удалось отправить ссылку.");
    setStatus("Если этот email зарегистрирован, одноразовая ссылка отправлена. Проверьте почту.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Не удалось отправить ссылку.", "error");
  } finally {
    linkSubmit.disabled = false;
  }
});

logoutButton?.addEventListener("click", async () => {
  await request("/management/logout", { method: "POST" }).catch(() => null);
  managementToken = null;
  sessionSection.hidden = true;
  setStatus("Сессия управления завершена.");
});

if (!config.managementEnabled) {
  linkSubmit.disabled = true;
  setStatus("Management API пока выключен. Страница готова к включению после production deploy.");
} else {
  verifyFragment()
    .then((verified) => verified || loadSubscriptions())
    .catch(() => setStatus("Не удалось открыть управление подпиской.", "error"));
}
