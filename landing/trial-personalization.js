(() => {
  const config = globalThis.KGMU_CALENDAR_CONFIG ?? {};
  const nativeFetch = globalThis.fetch?.bind(globalThis);
  if (!nativeFetch) return;

  const REMINDERS = Object.freeze([
    Object.freeze({ value: 10, label: "За 10 минут" }),
    Object.freeze({ value: 30, label: "За 30 минут" }),
    Object.freeze({ value: 60, label: "За 1 час" }),
    Object.freeze({ value: 1440, label: "За 1 день" })
  ]);

  function requestUrl(input) {
    if (typeof input === "string") return new URL(input, window.location.href);
    if (input instanceof URL) return input;
    if (input instanceof Request) return new URL(input.url, window.location.href);
    return null;
  }

  function trialGroupId(form) {
    const heading = form?.closest(".trial-connect-card")?.querySelector("h3")?.textContent ?? "";
    return /группы?\s+(\d+)/i.exec(heading)?.[1] ?? null;
  }

  function groupCatalog(catalog, groupId) {
    if (!groupId) return [];
    const periodId = config.academicPeriodId;
    const definitions = catalog?.[periodId]?.[groupId];
    return Array.isArray(definitions) ? definitions : [];
  }

  function createSection(title, note) {
    const section = document.createElement("fieldset");
    section.className = "trial-personalization-section";
    const legend = document.createElement("legend");
    legend.textContent = title;
    const hint = document.createElement("small");
    hint.textContent = note;
    section.append(legend, hint);
    return section;
  }

  function createElectiveControls(groupId) {
    const definitions = groupCatalog(config.electiveCatalog, groupId).filter((definition) => (
      definition
      && typeof definition.selectionId === "string"
      && definition.selectionId.length > 0
      && Array.isArray(definition.alternatives)
      && definition.alternatives.some((alternative) => alternative && typeof alternative.value === "string")
    ));
    if (!definitions.length) return null;

    const section = createSection(
      "Дисциплина по выбору",
      "Выберите свой вариант. Без выбора альтернативные занятия не добавляются в календарь."
    );

    for (const definition of definitions) {
      const label = document.createElement("label");
      label.className = "trial-personalization-field";
      const title = document.createElement("span");
      title.textContent = typeof definition.label === "string" ? definition.label : "Вариант";
      const select = document.createElement("select");
      select.required = true;
      select.dataset.selectionId = definition.selectionId;

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Выберите дисциплину";
      placeholder.disabled = true;
      placeholder.selected = true;
      select.append(placeholder);

      for (const alternative of definition.alternatives) {
        if (!alternative || typeof alternative.value !== "string" || alternative.value.length === 0) continue;
        const option = document.createElement("option");
        option.value = alternative.value;
        option.textContent = typeof alternative.label === "string" ? alternative.label : alternative.value;
        select.append(option);
      }
      label.append(title, select);
      section.append(label);
    }
    return section;
  }

  function createFacultativeControls(groupId) {
    const definitions = groupCatalog(config.facultativeCatalog, groupId).filter((definition) => (
      definition
      && typeof definition.facultativeId === "string"
      && definition.facultativeId.length > 0
    ));
    if (!definitions.length) return null;

    const section = createSection("Факультативы", "Отметьте только те занятия, которые хотите видеть в календаре.");
    for (const definition of definitions) {
      const label = document.createElement("label");
      label.className = "trial-personalization-check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.facultativeId = definition.facultativeId;
      const text = document.createElement("span");
      text.textContent = typeof definition.label === "string" ? definition.label : definition.facultativeId;
      label.append(input, text);
      section.append(label);
    }
    return section;
  }

  function createReminderControls() {
    const section = createSection("Напоминания", "Можно выбрать несколько вариантов.");
    const row = document.createElement("div");
    row.className = "trial-personalization-reminders";
    for (const reminder of REMINDERS) {
      const label = document.createElement("label");
      label.className = "trial-personalization-check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.reminderMinutes = String(reminder.value);
      const text = document.createElement("span");
      text.textContent = reminder.label;
      label.append(input, text);
      row.append(label);
    }
    section.append(row);
    return section;
  }

  function installStyles() {
    if (document.querySelector("style[data-trial-personalization]")) return;
    const style = document.createElement("style");
    style.dataset.trialPersonalization = "";
    style.textContent = `
      .trial-personalization { display:grid; gap:14px; margin:18px 0; padding:16px; border:1px solid rgba(110,123,143,.24); border-radius:16px; }
      .trial-personalization > strong { font-size:16px; }
      .trial-personalization > p { margin:0; opacity:.76; }
      .trial-personalization-section { display:grid; gap:10px; margin:0; padding:0; border:0; min-width:0; }
      .trial-personalization-section legend { font-weight:700; padding:0; }
      .trial-personalization-section small { opacity:.72; }
      .trial-personalization-field { display:grid; gap:6px; }
      .trial-personalization-field select { width:100%; min-height:44px; border-radius:12px; padding:0 12px; }
      .trial-personalization-check { display:flex; align-items:flex-start; gap:9px; cursor:pointer; }
      .trial-personalization-check input { margin-top:3px; }
      .trial-personalization-reminders { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px 12px; }
      @media (max-width:640px) { .trial-personalization-reminders { grid-template-columns:1fr; } }
    `;
    document.head.append(style);
  }

  function ensurePersonalization(form) {
    if (!form || form.querySelector("[data-trial-personalization-root]")) return;
    const groupId = trialGroupId(form);
    if (!groupId) return;

    installStyles();
    const root = document.createElement("div");
    root.className = "trial-personalization";
    root.dataset.trialPersonalizationRoot = "";
    const title = document.createElement("strong");
    title.textContent = "Настройте календарь перед подключением";
    const copy = document.createElement("p");
    copy.textContent = "Настройки сразу сохранятся в пробной подписке и применятся к этой же ICS-ссылке.";
    root.append(title, copy);

    const elective = createElectiveControls(groupId);
    const facultatives = createFacultativeControls(groupId);
    root.append(...[elective, facultatives, createReminderControls()].filter(Boolean));

    const submit = form.querySelector('button[type="submit"]');
    if (submit) form.insertBefore(root, submit);
    else form.append(root);
  }

  function collectPreferences(form) {
    const electiveChoices = {};
    const facultativeChoices = {};
    const remindersMinutesBefore = [];

    form.querySelectorAll("select[data-selection-id]").forEach((select) => {
      if (select.value) electiveChoices[select.dataset.selectionId] = select.value;
    });
    form.querySelectorAll("input[data-facultative-id]").forEach((input) => {
      facultativeChoices[input.dataset.facultativeId] = input.checked;
    });
    form.querySelectorAll("input[data-reminder-minutes]:checked").forEach((input) => {
      const minutes = Number(input.dataset.reminderMinutes);
      if (Number.isInteger(minutes)) remindersMinutesBefore.push(minutes);
    });

    return { electiveChoices, facultativeChoices, remindersMinutesBefore };
  }

  function scan() {
    const form = document.querySelector("#runtime-trial-form");
    if (form) ensurePersonalization(form);
  }

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "runtime-trial-form") return;
    ensurePersonalization(form);
    const missing = form.querySelector("select[data-selection-id][required]:invalid");
    if (!missing) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const status = form.parentElement?.querySelector("#runtime-trial-status");
    if (status) status.textContent = "Сначала выберите свою дисциплину по выбору.";
    missing.reportValidity();
  }, true);

  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan, { once: true });
  else scan();

  globalThis.fetch = (input, init = {}) => {
    const url = requestUrl(input);
    const method = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!url?.pathname.endsWith("/trial") || method !== "POST") {
      return nativeFetch(input, init);
    }

    const form = document.querySelector("#runtime-trial-form");
    if (!form || typeof init.body !== "string") return nativeFetch(input, init);
    try {
      const payload = JSON.parse(init.body);
      const body = JSON.stringify({ ...payload, preferences: collectPreferences(form) });
      return nativeFetch(input, { ...init, body });
    } catch {
      return nativeFetch(input, init);
    }
  };
})();
