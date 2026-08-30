(() => {
  const config = Object.freeze({
    apiBase: "",
    academicPeriodId: "2026-2027-semester-1",
    academicPeriodLabels: {},
    electiveCatalog: {},
    facultativeCatalog: {},
    managementEnabled: false,
    ...(globalThis.KGMU_CALENDAR_CONFIG ?? {})
  });

  const CHECKOUT_CONTEXT_KEY = "kgmu-calendar:pending-checkout-v2";
  const PAID_HANDOFF_KEY = "kgmu-calendar:paid-handoff-v1";
  const nativeFetch = globalThis.fetch.bind(globalThis);

  const state = {
    groupId: null,
    preferences: {
      electiveChoices: {},
      facultativeChoices: {},
      remindersMinutesBefore: []
    },
    lastCalendarUrl: null
  };

  function apiUrl(path) {
    return new URL(path, config.apiBase || window.location.origin).toString();
  }

  function absoluteCalendarUrl(path) {
    return new URL(path, config.apiBase || window.location.origin).toString();
  }

  function webcalUrl(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Неподдерживаемая ссылка календаря.");
    }
    return `webcal://${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
  }

  function safeStorageGet(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function safeStorageRemove(key) {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Storage is an optional convenience layer only.
    }
  }

  function clonePreferences() {
    return {
      electiveChoices: { ...state.preferences.electiveChoices },
      facultativeChoices: { ...state.preferences.facultativeChoices },
      remindersMinutesBefore: [...state.preferences.remindersMinutesBefore]
    };
  }

  function resetPreferences(groupId) {
    state.groupId = groupId;
    state.preferences = {
      electiveChoices: {},
      facultativeChoices: {},
      remindersMinutesBefore: []
    };
  }

  function extractGroupId(preview) {
    const text = preview?.querySelector(".group-preview-head h3")?.textContent ?? "";
    return /группа\s+(\d+)/i.exec(text)?.[1] ?? null;
  }

  function groupCatalog(catalog, groupId) {
    const definitions = catalog?.[config.academicPeriodId]?.[groupId];
    return Array.isArray(definitions) ? definitions : [];
  }

  function periodLabel() {
    const configured = config.academicPeriodLabels?.[config.academicPeriodId];
    return typeof configured === "string" && configured.length > 0
      ? configured
      : "текущий семестр";
  }

  function createFieldHeading(title, note) {
    const head = document.createElement("div");
    head.className = "acquisition-pref-heading";
    const strong = document.createElement("strong");
    strong.textContent = title;
    const small = document.createElement("span");
    small.textContent = note;
    head.append(strong, small);
    return head;
  }

  function selectedFacultativeLabels(groupId) {
    const definitions = groupCatalog(config.facultativeCatalog, groupId);
    return definitions
      .filter((definition) => state.preferences.facultativeChoices[definition?.facultativeId] === true)
      .map((definition) => definition.label ?? definition.facultativeId);
  }

  function reminderLabel(minutes) {
    if (minutes === 15) return "за 15 мин";
    if (minutes === 30) return "за 30 мин";
    if (minutes === 60) return "за 1 час";
    return `за ${minutes} мин`;
  }

  function updatePreferenceSummary(summary, groupId) {
    const facultatives = selectedFacultativeLabels(groupId);
    const reminders = state.preferences.remindersMinutesBefore.map(reminderLabel);
    const parts = [];
    parts.push(facultatives.length
      ? `Факультативы: ${facultatives.join(", ")}`
      : "Факультативы: не выбраны");
    parts.push(reminders.length
      ? `Напоминания: ${reminders.join(", ")}`
      : "Напоминания: выключены");
    summary.textContent = `${parts.join(" · ")}. Эти настройки попадут в календарь сразу при пробе или покупке.`;
  }

  function buildPersonalizationPanel(preview, groupId) {
    const section = document.createElement("section");
    section.className = "acquisition-personalization";
    section.dataset.acquisitionPersonalization = groupId;

    const intro = document.createElement("div");
    intro.className = "acquisition-personalization-head";
    const kicker = document.createElement("p");
    kicker.className = "section-kicker";
    kicker.textContent = "Персонализация до подключения";
    const heading = document.createElement("h4");
    heading.textContent = "Сразу настройте свой календарь";
    const lead = document.createElement("p");
    lead.textContent = `Настройки для группы ${groupId}, ${periodLabel()}. Вы увидите уже настроенный календарь — повторно выбирать после подключения не нужно.`;
    intro.append(kicker, heading, lead);
    section.append(intro);

    const electiveDefinitions = groupCatalog(config.electiveCatalog, groupId).filter((definition) => (
      definition
      && typeof definition.selectionId === "string"
      && definition.selectionId.length > 0
      && Array.isArray(definition.alternatives)
    ));
    if (electiveDefinitions.length) {
      const field = document.createElement("div");
      field.className = "acquisition-pref-field";
      field.append(createFieldHeading("Дисциплины по выбору", "Выберите вариант, который должен быть в календаре"));
      for (const definition of electiveDefinitions) {
        const label = document.createElement("label");
        label.className = "acquisition-select-label";
        const title = document.createElement("span");
        title.textContent = definition.label ?? "Дисциплина по выбору";
        const select = document.createElement("select");
        const empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "Показывать все варианты";
        select.append(empty);
        for (const alternative of definition.alternatives) {
          if (!alternative || typeof alternative.value !== "string") continue;
          const option = document.createElement("option");
          option.value = alternative.value;
          option.textContent = alternative.label ?? alternative.value;
          select.append(option);
        }
        select.value = state.preferences.electiveChoices[definition.selectionId] ?? "";
        select.addEventListener("change", () => {
          if (select.value) state.preferences.electiveChoices[definition.selectionId] = select.value;
          else delete state.preferences.electiveChoices[definition.selectionId];
        });
        label.append(title, select);
        field.append(label);
      }
      section.append(field);
    }

    const facultatives = groupCatalog(config.facultativeCatalog, groupId).filter((definition) => (
      definition && typeof definition.facultativeId === "string" && definition.facultativeId.length > 0
    ));
    if (facultatives.length) {
      const field = document.createElement("div");
      field.className = "acquisition-pref-field";
      field.append(createFieldHeading("Факультативы", "Отметьте только те, которые посещаете"));
      const choices = document.createElement("div");
      choices.className = "acquisition-check-list";
      for (const definition of facultatives) {
        const label = document.createElement("label");
        label.className = "acquisition-check-choice";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = state.preferences.facultativeChoices[definition.facultativeId] === true;
        input.addEventListener("change", () => {
          state.preferences.facultativeChoices[definition.facultativeId] = input.checked;
          updatePreferenceSummary(summary, groupId);
        });
        const text = document.createElement("span");
        text.textContent = definition.label ?? definition.facultativeId;
        label.append(input, text);
        choices.append(label);
      }
      field.append(choices);
      section.append(field);
    }

    const reminderField = document.createElement("div");
    reminderField.className = "acquisition-pref-field";
    reminderField.append(createFieldHeading("Напоминания", "Можно выбрать несколько"));
    const reminderChoices = document.createElement("div");
    reminderChoices.className = "acquisition-reminder-list";
    for (const minutes of [15, 30, 60]) {
      const label = document.createElement("label");
      label.className = "acquisition-reminder-choice";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = state.preferences.remindersMinutesBefore.includes(minutes);
      input.addEventListener("change", () => {
        const selected = new Set(state.preferences.remindersMinutesBefore);
        if (input.checked) selected.add(minutes);
        else selected.delete(minutes);
        state.preferences.remindersMinutesBefore = [...selected].sort((a, b) => a - b);
        updatePreferenceSummary(summary, groupId);
      });
      const text = document.createElement("span");
      text.textContent = minutes === 60 ? "За 1 час" : `За ${minutes} минут`;
      label.append(input, text);
      reminderChoices.append(label);
    }
    reminderField.append(reminderChoices);
    section.append(reminderField);

    const summary = document.createElement("p");
    summary.className = "acquisition-pref-summary";
    summary.setAttribute("aria-live", "polite");
    updatePreferenceSummary(summary, groupId);
    section.append(summary);

    const offer = preview.querySelector(".preview-offer");
    if (offer) preview.insertBefore(section, offer);
  }

  function ensurePersonalization() {
    const preview = document.querySelector(".group-preview");
    if (!preview) return;
    const groupId = extractGroupId(preview);
    if (!groupId) return;
    if (state.groupId !== groupId) resetPreferences(groupId);
    if (preview.querySelector(`[data-acquisition-personalization="${CSS.escape(groupId)}"]`)) return;
    buildPersonalizationPanel(preview, groupId);
  }

  async function copyCalendar(button, url) {
    await navigator.clipboard.writeText(url);
    const previous = button.textContent;
    button.textContent = "Скопировано";
    setTimeout(() => { button.textContent = previous; }, 1600);
  }

  function ensureCalendarActions() {
    const copy = document.querySelector("#copy-trial-url");
    if (!copy || copy.dataset.calendarActionsReady === "true" || !state.lastCalendarUrl) return;
    copy.dataset.calendarActionsReady = "true";
    copy.textContent = "Скопировать для Google Calendar";
    copy.onclick = null;
    copy.addEventListener("click", (event) => {
      event.preventDefault();
      copyCalendar(copy, state.lastCalendarUrl).catch(() => {
        copy.textContent = "Не удалось скопировать";
      });
    }, { capture: true });

    const actions = copy.closest(".connect-actions");
    if (!actions) return;
    const iphone = document.createElement("a");
    iphone.className = "pay-button calendar-device-action";
    iphone.href = webcalUrl(state.lastCalendarUrl);
    iphone.textContent = "Добавить в iPhone";
    actions.insertBefore(iphone, copy);
  }

  function requestUrl(input) {
    if (typeof input === "string") return new URL(input, window.location.href);
    if (input instanceof URL) return input;
    if (input && typeof input.url === "string") return new URL(input.url, window.location.href);
    return null;
  }

  function headerValue(headers, name) {
    const normalized = new Headers(headers ?? {});
    return normalized.get(name);
  }

  globalThis.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const method = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let nextInit = init;
    const isTrial = url?.pathname.endsWith("/trial") && method === "POST";
    const isCheckout = url?.pathname.endsWith("/checkout") && method === "POST";

    if ((isTrial || isCheckout) && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if (body && typeof body === "object" && !Array.isArray(body)) {
          body.preferences = clonePreferences();
          nextInit = { ...init, body: JSON.stringify(body) };
          if (isCheckout) {
            const checkoutKey = headerValue(init.headers, "Idempotency-Key");
            if (checkoutKey) {
              safeStorageSet(CHECKOUT_CONTEXT_KEY, {
                checkoutKey,
                groupId: body.groupId ?? state.groupId,
                createdAt: new Date().toISOString()
              });
            }
          }
        }
      } catch {
        // Preserve the original request; the backend will validate malformed JSON.
      }
    }

    const response = await nativeFetch(input, nextInit);

    if (isTrial && response.ok) {
      response.clone().json().then((payload) => {
        if (typeof payload?.calendarPath === "string") {
          state.lastCalendarUrl = absoluteCalendarUrl(payload.calendarPath);
          queueMicrotask(ensureCalendarActions);
        }
      }).catch(() => null);
    }

    if (isCheckout && response.ok) {
      const clone = response.clone();
      const payload = await clone.json().catch(() => null);
      if (payload?.status === "paid" && payload.confirmationUrl == null) {
        const immediateReturn = new URL(window.location.href);
        immediateReturn.searchParams.set("payment", "return");
        return new Response(JSON.stringify({
          ...payload,
          confirmationUrl: immediateReturn.toString()
        }), {
          status: response.status,
          statusText: response.statusText,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
        });
      }
    }

    return response;
  };

  function returnCard() {
    const card = document.createElement("section");
    card.className = "trial-connect-card payment-handoff-card";
    card.innerHTML = `
      <div class="trial-mark" aria-hidden="true">₽</div>
      <p class="section-kicker">Возврат после оплаты</p>
      <h3>Подтверждаем платёж</h3>
      <p id="payment-handoff-status">Проверяем статус напрямую у ЮKassa. Переход назад на сайт сам по себе не считается подтверждением оплаты.</p>
      <div class="loading-dot" id="payment-handoff-loader" aria-hidden="true"></div>
      <div class="connect-actions" id="payment-handoff-actions" hidden></div>`;
    return card;
  }

  function showReturnFallback(card, message, allowRetry = false) {
    const status = card.querySelector("#payment-handoff-status");
    const loader = card.querySelector("#payment-handoff-loader");
    const actions = card.querySelector("#payment-handoff-actions");
    if (status) status.textContent = message;
    if (loader) loader.hidden = true;
    if (!actions) return;
    actions.hidden = false;
    actions.replaceChildren();
    if (allowRetry) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "pay-button";
      retry.textContent = "Проверить ещё раз";
      retry.addEventListener("click", () => {
        actions.hidden = true;
        if (loader) loader.hidden = false;
        pollPaymentReturn(card, 0).catch(() => showReturnFallback(
          card,
          "Не удалось проверить платёж. Попробуйте ещё раз.",
          true
        ));
      });
      actions.append(retry);
    }
    if (config.managementEnabled) {
      const manage = document.createElement("a");
      manage.className = "secondary-action";
      manage.href = "./manage/";
      manage.textContent = "Открыть управление";
      actions.append(manage);
    }
  }

  async function pollPaymentReturn(card, attempt) {
    const context = safeStorageGet(CHECKOUT_CONTEXT_KEY);
    if (!context || typeof context.checkoutKey !== "string") {
      showReturnFallback(
        card,
        "Не удалось восстановить данные этого платежа в браузере. Откройте управление подпиской; email остаётся резервным способом входа.",
        false
      );
      return;
    }

    const response = await nativeFetch(apiUrl("/checkout/return"), {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkoutKey: context.checkoutKey })
    });
    const payload = await response.json().catch(() => ({}));

    if (response.status === 200 && payload?.status === "paid" && typeof payload.magicToken === "string") {
      safeStorageRemove(CHECKOUT_CONTEXT_KEY);
      safeStorageSet(PAID_HANDOFF_KEY, {
        subscriptionId: payload.subscriptionId ?? null,
        initialLinkRequired: payload.initialLinkRequired === true,
        createdAt: new Date().toISOString()
      });
      const status = card.querySelector("#payment-handoff-status");
      if (status) status.textContent = "Оплата подтверждена. Открываем управление календарём…";
      window.location.replace(`./manage/#token=${encodeURIComponent(payload.magicToken)}`);
      return;
    }

    if (response.status === 202 && payload?.status === "pending") {
      if (attempt < 9) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return pollPaymentReturn(card, attempt + 1);
      }
      showReturnFallback(
        card,
        "Платёж ещё обрабатывается. Деньги повторно списывать не нужно — можно проверить статус ещё раз.",
        true
      );
      return;
    }

    if (response.status === 409 || payload?.status === "canceled") {
      safeStorageRemove(CHECKOUT_CONTEXT_KEY);
      showReturnFallback(card, "ЮKassa сообщает, что платёж отменён. Доступ не активирован.", false);
      return;
    }

    showReturnFallback(
      card,
      "Не удалось подтвердить платёж. Повторная оплата не требуется, пока статус не проверен.",
      true
    );
  }

  function renderPaymentReturn() {
    if (new URLSearchParams(window.location.search).get("payment") !== "return") return;
    const grid = document.querySelector("#choice-grid");
    if (!grid) return;
    const card = returnCard();
    grid.replaceChildren(card);
    const title = document.querySelector("#selector-title");
    const kicker = document.querySelector("#step-kicker");
    const back = document.querySelector("#back-button");
    const notice = document.querySelector("#notice");
    if (title) title.textContent = "Результат оплаты";
    if (kicker) kicker.textContent = "Оплата";
    if (back) back.hidden = true;
    if (notice) notice.hidden = true;
    pollPaymentReturn(card, 0).catch(() => showReturnFallback(
      card,
      "Не удалось проверить платёж. Попробуйте ещё раз.",
      true
    ));
  }

  const grid = document.querySelector("#choice-grid");
  if (grid) {
    const observer = new MutationObserver(() => {
      ensurePersonalization();
      ensureCalendarActions();
    });
    observer.observe(grid, { childList: true, subtree: true });
    ensurePersonalization();
  }

  window.addEventListener("DOMContentLoaded", renderPaymentReturn, { once: true });
})();
