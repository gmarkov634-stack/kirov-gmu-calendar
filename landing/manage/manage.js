const config = Object.freeze({
  apiBase: "",
  managementEnabled: false,
  managementSessionTransport: "cookie",
  electiveCatalog: {},
  facultativeCatalog: {},
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

function preferencesPath(subscriptionId) {
  return `/management/subscriptions/${encodeURIComponent(subscriptionId)}/preferences`;
}

function normalizeReminders(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => Number.isInteger(item) && item >= 0 && item <= 10080))]
    .sort((a, b) => a - b);
}

function reminderLabel(minutes) {
  if (minutes === 0) return "В момент начала";
  if (minutes < 60) return `За ${minutes} мин`;
  if (minutes === 60) return "За 1 час";
  if (minutes % 1440 === 0) return `За ${minutes / 1440} дн.`;
  if (minutes % 60 === 0) return `За ${minutes / 60} ч.`;
  return `За ${minutes} мин`;
}

function electiveDefinitions(subscription) {
  const groupCatalog = config.electiveCatalog?.[subscription.groupId];
  return Array.isArray(groupCatalog) ? groupCatalog : [];
}

function facultativeDefinitions(subscription) {
  const groupCatalog = config.facultativeCatalog?.[subscription.groupId];
  return Array.isArray(groupCatalog) ? groupCatalog : [];
}

function createReminderEditor(initialValues) {
  const wrapper = document.createElement("div");
  wrapper.className = "preference-field";

  const heading = document.createElement("div");
  heading.className = "preference-heading";
  heading.innerHTML = "<strong>Напоминания</strong><span>Можно выбрать несколько</span>";

  const selected = new Set(normalizeReminders(initialValues));
  const chips = document.createElement("div");
  chips.className = "reminder-chips";

  const customRow = document.createElement("div");
  customRow.className = "custom-reminder-row";
  const customInput = document.createElement("input");
  customInput.type = "number";
  customInput.min = "0";
  customInput.max = "10080";
  customInput.step = "1";
  customInput.placeholder = "Минут до пары";
  customInput.setAttribute("aria-label", "Минут до пары");
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "button button-secondary";
  addButton.textContent = "Добавить";

  function render() {
    chips.replaceChildren();
    if (!selected.size) {
      const empty = document.createElement("span");
      empty.className = "preference-empty";
      empty.textContent = "Без напоминаний";
      chips.append(empty);
      return;
    }
    for (const minutes of [...selected].sort((a, b) => a - b)) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "reminder-chip";
      chip.textContent = `${reminderLabel(minutes)} ×`;
      chip.title = "Удалить напоминание";
      chip.addEventListener("click", () => {
        selected.delete(minutes);
        render();
      });
      chips.append(chip);
    }
  }

  addButton.addEventListener("click", () => {
    const minutes = Number(customInput.value);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) {
      customInput.setCustomValidity("Введите целое число от 0 до 10080 минут.");
      customInput.reportValidity();
      return;
    }
    customInput.setCustomValidity("");
    selected.add(minutes);
    customInput.value = "";
    render();
  });

  customInput.addEventListener("input", () => customInput.setCustomValidity(""));
  customRow.append(customInput, addButton);
  wrapper.append(heading, chips, customRow);
  render();

  return {
    node: wrapper,
    value: () => [...selected].sort((a, b) => a - b)
  };
}

function createElectiveEditor(subscription, initialChoices) {
  const current = initialChoices && typeof initialChoices === "object" && !Array.isArray(initialChoices)
    ? { ...initialChoices }
    : {};
  const definitions = electiveDefinitions(subscription).filter((definition) => (
    definition
    && typeof definition.selectionId === "string"
    && Array.isArray(definition.alternatives)
    && definition.alternatives.some((alternative) => alternative && typeof alternative.value === "string")
  ));

  if (!definitions.length) {
    return { node: null, value: () => current };
  }

  const wrapper = document.createElement("div");
  wrapper.className = "preference-field";
  const heading = document.createElement("div");
  heading.className = "preference-heading";
  heading.innerHTML = "<strong>Дисциплины по выбору</strong><span>В календаре останется выбранный вариант</span>";
  wrapper.append(heading);
  const selects = new Map();

  for (const definition of definitions) {
    const label = document.createElement("label");
    label.textContent = typeof definition.label === "string" ? definition.label : "Выбор дисциплины";
    const select = document.createElement("select");
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Показывать все варианты";
    select.append(empty);
    for (const alternative of definition.alternatives) {
      if (!alternative || typeof alternative.value !== "string") continue;
      const option = document.createElement("option");
      option.value = alternative.value;
      option.textContent = typeof alternative.label === "string" ? alternative.label : alternative.value;
      select.append(option);
    }
    select.value = typeof current[definition.selectionId] === "string" ? current[definition.selectionId] : "";
    label.append(select);
    wrapper.append(label);
    selects.set(definition.selectionId, select);
  }

  return {
    node: wrapper,
    value: () => {
      const next = { ...current };
      for (const [selectionId, select] of selects) {
        if (select.value) next[selectionId] = select.value;
        else delete next[selectionId];
      }
      return next;
    }
  };
}

function createFacultativeEditor(subscription, initialChoices) {
  const wrapper = document.createElement("div");
  wrapper.className = "preference-field";
  const heading = document.createElement("div");
  heading.className = "preference-heading";
  heading.innerHTML = "<strong>Факультативы</strong><span>Отметьте те, которые нужны в календаре</span>";
  wrapper.append(heading);

  const definitions = facultativeDefinitions(subscription);
  const current = initialChoices && typeof initialChoices === "object" && !Array.isArray(initialChoices)
    ? { ...initialChoices }
    : {};
  const controls = new Map();

  if (!definitions.length) {
    const note = document.createElement("p");
    note.className = "preference-empty";
    note.textContent = "Для этой группы каталог факультативов пока не опубликован. Сохранённый выбор, если он уже есть, не изменится.";
    wrapper.append(note);
    return { node: wrapper, value: () => current };
  }

  for (const definition of definitions) {
    if (!definition || typeof definition.facultativeId !== "string" || definition.facultativeId.length === 0) continue;
    const label = document.createElement("label");
    label.className = "facultative-choice";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = current[definition.facultativeId] !== false;
    const text = document.createElement("span");
    text.textContent = typeof definition.label === "string" ? definition.label : definition.facultativeId;
    label.append(input, text);
    wrapper.append(label);
    controls.set(definition.facultativeId, input);
  }

  return {
    node: wrapper,
    value: () => {
      const next = { ...current };
      for (const [facultativeId, input] of controls) {
        next[facultativeId] = input.checked;
      }
      return next;
    }
  };
}

async function loadPreferences(subscriptionId) {
  const { response, payload } = await request(preferencesPath(subscriptionId), { method: "GET" });
  if (response.status === 401) throw new Error("Сессия управления истекла.");
  if (!response.ok || !payload?.preferences) throw new Error("Не удалось загрузить настройки календаря.");
  return payload.preferences;
}

function renderPreferencePanel(card, item) {
  const section = document.createElement("section");
  section.className = "preference-panel";
  section.innerHTML = "<p class=\"preference-loading\">Загружаем настройки календаря…</p>";
  card.append(section);

  loadPreferences(item.subscription.subscriptionId)
    .then((preferences) => {
      section.replaceChildren();

      const electiveEditor = createElectiveEditor(item.subscription, preferences.electiveChoices);
      const facultativeEditor = createFacultativeEditor(item.subscription, preferences.facultativeChoices);
      const reminderEditor = createReminderEditor(preferences.remindersMinutesBefore);
      const save = document.createElement("button");
      save.type = "button";
      save.className = "button button-primary preference-save";
      save.textContent = "Сохранить настройки";

      const localStatus = document.createElement("p");
      localStatus.className = "preference-local-status";
      localStatus.setAttribute("role", "status");
      localStatus.setAttribute("aria-live", "polite");

      save.addEventListener("click", async () => {
        save.disabled = true;
        localStatus.textContent = "Сохраняем…";
        localStatus.className = "preference-local-status";
        try {
          const { response, payload } = await request(preferencesPath(item.subscription.subscriptionId), {
            method: "PATCH",
            body: JSON.stringify({
              electiveChoices: electiveEditor.value(),
              facultativeChoices: facultativeEditor.value(),
              remindersMinutesBefore: reminderEditor.value()
            })
          });
          if (!response.ok || !payload?.preferences) throw new Error("Не удалось сохранить настройки.");
          localStatus.textContent = "Настройки сохранены. Следующая загрузка ICS применит их автоматически.";
          localStatus.className = "preference-local-status success";
        } catch (error) {
          localStatus.textContent = error instanceof Error ? error.message : "Не удалось сохранить настройки.";
          localStatus.className = "preference-local-status error";
        } finally {
          save.disabled = false;
        }
      });

      section.append(...[
        electiveEditor.node,
        facultativeEditor.node,
        reminderEditor.node,
        save,
        localStatus
      ].filter(Boolean));
    })
    .catch((error) => {
      section.replaceChildren();
      const message = document.createElement("p");
      message.className = "preference-local-status error";
      message.textContent = error instanceof Error ? error.message : "Не удалось загрузить настройки календаря.";
      section.append(message);
    });
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
    renderPreferencePanel(card, item);
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