(() => {
  const config = window.UGMU_CONFIG;
  if (!config || config.university !== "ugmu") return;

  const grid = document.querySelector("#choice-grid");
  const title = document.querySelector("#selector-title");
  const kicker = document.querySelector("#step-kicker");
  const backButton = document.querySelector("#back-button");
  const notice = document.querySelector("#notice");
  const heroRuntimeNote = document.querySelector("#hero-runtime-note");
  const savedOrders = document.querySelector("#saved-orders");
  const savedOrdersList = document.querySelector("#saved-orders-list");
  const orderResult = document.querySelector("#order-result");
  if (!grid || !title || !kicker || !backButton || !notice || !orderResult) return;

  const selectionSteps = ["faculty", "course", "group"];
  const groupMap = new Map(config.groups.map((group) => [group.code, group]));
  const savedOrderKey = "ugmu-calendar-orders-v1";
  const trialSessionKey = "ugmu-calendar-trial-v1";

  const state = {
    step: "faculty",
    group: null,
    conversionId: "",
    trial: null,
  };

  const runtime = {
    ready: false,
    trial: "closed",
    sales: "closed",
    paymentMode: "unknown",
    price: "",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function validOrderId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value);
  }

  function validToken(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
  }

  function validHttpsUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  function groupStream(group) {
    return String(group?.stream || config.program.stream || "").trim();
  }

  function streamLabel(group) {
    const stream = groupStream(group);
    return String(config.streams?.[stream]?.label || stream);
  }

  function groupId(group) {
    return `${config.university}:${config.program.id}:${config.program.course}:stream-${groupStream(group)}:${group.code}`;
  }

  function selectedGroup() {
    return state.group ? groupMap.get(state.group) || null : null;
  }

  function rubleLabel(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return "";
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount)} ₽`;
  }

  function attributionContext() {
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

  function trialReady() {
    return runtime.ready && runtime.trial === "open";
  }

  function checkoutReady() {
    return runtime.ready && runtime.sales === "open" && runtime.paymentMode === "live";
  }

  function updateStepIndicators(step) {
    const activeIndex = selectionSteps.indexOf(step);
    document.querySelectorAll("[data-step-indicator]").forEach((element, index) => {
      element.classList.toggle("is-active", activeIndex === index);
      element.classList.toggle("is-complete", activeIndex === -1 || index < activeIndex);
    });
  }

  function stepKicker(step) {
    const index = selectionSteps.indexOf(step);
    if (index >= 0) return `Шаг ${index + 1} из ${selectionSteps.length}`;
    if (step === "access") return "Ваша группа";
    if (step === "trial") return "Бесплатная неделя";
    if (step === "checkout") return "Полный календарь";
    return "Календарь";
  }

  function setStep(step, { updateUrl = true } = {}) {
    state.step = step;
    updateStepIndicators(step);
    kicker.textContent = stepKicker(step);
    backButton.hidden = step === "faculty" || step === "result";
    notice.hidden = true;
    notice.textContent = "";
    orderResult.hidden = true;
    orderResult.replaceChildren();
    if (updateUrl && step !== "result") {
      const params = new URLSearchParams(window.location.search);
      if (state.group) params.set("group", state.group.replace("ОЛД ", ""));
      else params.delete("group");
      params.delete("continue");
      const query = params.toString();
      history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}#selector`);
    }
    render();
  }

  function makeCard({ icon, cardTitle, subtitle, className = "", onClick }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `choice-card ${className}`.trim();
    const iconElement = document.createElement("span");
    iconElement.className = "card-icon";
    iconElement.setAttribute("aria-hidden", "true");
    iconElement.textContent = icon;
    const strong = document.createElement("strong");
    strong.textContent = cardTitle;
    const small = document.createElement("small");
    small.textContent = subtitle;
    button.append(iconElement, strong, small);
    button.addEventListener("click", onClick);
    return button;
  }

  function renderFaculty() {
    title.textContent = "Выберите направление";
    grid.append(makeCard({
      icon: "Л",
      cardTitle: "Лечебное дело",
      subtitle: "1 курс · I–II потоки",
      onClick: () => setStep("course"),
    }));
  }

  function renderCourse() {
    title.textContent = "Лечебное дело";
    grid.append(makeCard({
      icon: "1",
      cardTitle: "1 курс",
      subtitle: "24 группы ОЛД доступны",
      onClick: () => setStep("group"),
    }));
  }

  function renderGroups() {
    title.textContent = "Лечебное дело · 1 курс";
    config.groups.forEach((group) => {
      grid.append(makeCard({
        icon: "№",
        cardTitle: group.code,
        subtitle: `${streamLabel(group)} поток · Подключить расписание этой группы`,
        className: "group-card",
        onClick: () => {
          state.group = group.code;
          state.conversionId = "";
          state.trial = null;
          clearTrialSession();
          setStep("access");
        },
      }));
    });
  }

  function renderAccess() {
    const group = selectedGroup();
    if (!group) {
      setStep("group");
      return;
    }
    title.textContent = group.code;

    const card = document.createElement("section");
    card.className = "access-card";
    const copy = document.createElement("div");
    copy.innerHTML = `
      <p class="section-kicker">Лечебное дело · 1 курс · ${escapeHtml(streamLabel(group))} поток</p>
      <h3>${escapeHtml(group.code)}</h3>
      <p>Подключите первую учебную неделю бесплатно. Если формат понравится, полный календарь можно купить отдельно.</p>
      <div class="access-points"><span>7 дней бесплатно</span><span>Без карты</span><span>Без email</span></div>`;

    const actions = document.createElement("div");
    actions.className = "access-actions";

    const trialButton = document.createElement("button");
    trialButton.id = "trial-start-live";
    trialButton.type = "button";
    trialButton.className = "pay-button";
    if (!runtime.ready) {
      trialButton.disabled = true;
      trialButton.textContent = "Проверяем доступность…";
    } else if (trialReady()) {
      trialButton.textContent = "Попробовать бесплатно";
      trialButton.addEventListener("click", () => { void startTrial(trialButton); });
    } else {
      trialButton.disabled = true;
      trialButton.textContent = "Бесплатная неделя сейчас недоступна";
    }
    actions.append(trialButton);

    const paid = document.createElement("button");
    paid.type = "button";
    paid.className = "secondary-action";
    const price = rubleLabel(runtime.price);
    paid.textContent = price ? `Купить полный календарь · ${price}` : "Купить полный календарь";
    if (checkoutReady()) {
      paid.addEventListener("click", () => setStep("checkout"));
    } else {
      paid.disabled = true;
      paid.setAttribute("aria-disabled", "true");
      paid.title = runtime.ready ? "Покупка временно недоступна" : "Проверяем доступность покупки";
    }
    actions.append(paid);

    const status = document.createElement("p");
    status.className = "access-status";
    if (runtime.ready && trialReady()) status.textContent = checkoutReady()
      ? "Можно попробовать бесплатную неделю или сразу купить полный календарь."
      : "Первая учебная неделя подключается одной персональной ссылкой.";
    else if (!runtime.ready) status.textContent = "";
    else status.textContent = "Выберите другую группу или попробуйте позже.";
    actions.append(status);

    card.append(copy, actions);
    grid.append(card);
  }

  function trialWindowLabel(start, endExclusive) {
    const startDate = new Date(`${start}T12:00:00Z`);
    const endDate = new Date(`${endExclusive}T12:00:00Z`);
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return "";
    endDate.setUTCDate(endDate.getUTCDate() - 1);
    const formatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" });
    return `${formatter.format(startDate)} — ${formatter.format(endDate)}`;
  }

  async function copySubscriptionUrl(url, button) {
    try {
      await navigator.clipboard.writeText(url);
      button.textContent = "Ссылка скопирована";
    } catch {
      window.prompt("Скопируйте ссылку календаря:", url);
    }
  }

  function renderTrial() {
    const group = selectedGroup();
    const trial = state.trial;
    if (!group || !trial?.subscriptionUrl) {
      setStep("access");
      return;
    }
    title.textContent = `Календарь ${group.code} готов`;
    const card = document.createElement("section");
    card.className = "trial-connect-card";
    const windowLabel = trialWindowLabel(trial.trialStartDate, trial.trialEndDateExclusive);
    card.innerHTML = `
      <div class="trial-mark">У</div>
      <h3>Подключите календарь один раз</h3>
      <p>Пары первой учебной недели группы ${escapeHtml(group.code)} появятся в обычном календаре телефона. Банковская карта не нужна.</p>
      ${windowLabel ? `<span class="trial-window">${escapeHtml(windowLabel)}</span>` : ""}`;

    const actions = document.createElement("div");
    actions.className = "connect-actions";
    const apple = document.createElement("a");
    apple.className = "pay-button link-button";
    apple.href = trial.subscriptionUrl.replace(/^https:/, "webcal:");
    apple.textContent = "Подключить на iPhone";
    const google = document.createElement("button");
    google.type = "button";
    google.className = "copy-button";
    google.textContent = "Скопировать для Google Calendar";
    google.addEventListener("click", () => { void copySubscriptionUrl(trial.subscriptionUrl, google); });
    actions.append(apple, google);
    card.append(actions);

    const hint = document.createElement("p");
    hint.textContent = "Для Google Calendar: откройте «Другие календари → Добавить по URL» и вставьте скопированную ссылку.";
    card.append(hint);

    const next = document.createElement("div");
    next.className = "trial-next";
    const paid = document.createElement("button");
    paid.type = "button";
    paid.className = "secondary-action";
    paid.textContent = "Купить полный календарь";
    if (checkoutReady()) {
      paid.addEventListener("click", () => setStep("checkout"));
    } else {
      paid.disabled = true;
      paid.setAttribute("aria-disabled", "true");
    }
    next.append(paid);

    const another = document.createElement("button");
    another.type = "button";
    another.className = "secondary-action";
    another.textContent = "Выбрать другую группу";
    another.addEventListener("click", () => {
      state.group = null;
      state.conversionId = "";
      state.trial = null;
      clearTrialSession();
      setStep("group");
    });
    next.append(another);
    card.append(next);
    grid.append(card);
  }

  function renderCheckout() {
    const group = selectedGroup();
    if (!group) {
      setStep("group");
      return;
    }
    title.textContent = `Полный календарь · ${group.code}`;
    if (!checkoutReady()) {
      const message = document.createElement("div");
      message.className = "runtime-message";
      message.textContent = "Полный календарь сейчас недоступен. Бесплатная неделя, если она открыта, остаётся доступной отдельно.";
      grid.append(message);
      return;
    }

    const card = document.createElement("section");
    card.className = "checkout-card";
    const price = rubleLabel(runtime.price) || "—";
    const summary = document.createElement("div");
    summary.className = "order-summary";
    summary.innerHTML = `<span>${escapeHtml(group.code)}</span><strong>${escapeHtml(price)}</strong><span class="summary-plan">Осенний семестр 2026/27</span><small class="summary-note">Разовая оплата без автосписаний.</small>`;

    const form = document.createElement("form");
    form.id = "checkout-form";
    if (state.conversionId) {
      const context = document.createElement("div");
      context.className = "checkout-context";
      context.textContent = "Вы уже попробовали бесплатную неделю. Полный календарь будет оформлен для этой же группы.";
      form.append(context);
    }
    const label = document.createElement("label");
    label.htmlFor = "checkout-email";
    label.textContent = "Email";
    const input = document.createElement("input");
    input.id = "checkout-email";
    input.type = "email";
    input.autocomplete = "email";
    input.required = true;
    input.placeholder = "student@example.com";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "pay-button";
    submit.textContent = `Перейти к оплате · ${price}`;
    const hint = document.createElement("p");
    hint.className = "form-hint";
    hint.textContent = "Email нужен для заказа полного календаря. Автосписаний нет.";
    const status = document.createElement("p");
    status.className = "form-status";
    form.append(label, input, submit, hint, status);
    form.addEventListener("submit", (event) => { void submitPayment(event, input, submit, status); });

    card.append(summary, form);
    grid.append(card);
  }

  function render() {
    if (state.step === "result") return;
    grid.replaceChildren();
    if (state.step === "faculty") renderFaculty();
    else if (state.step === "course") renderCourse();
    else if (state.step === "group") renderGroups();
    else if (state.step === "access") renderAccess();
    else if (state.step === "trial") renderTrial();
    else if (state.step === "checkout") renderCheckout();
  }

  function friendlyTrialError(code) {
    if (code === "trial_already_claimed") return "Бесплатная неделя на этот семестр уже использована. Если нужен полный календарь, его можно подключить отдельно.";
    if (code === "trial_window_closed") return "Первая учебная неделя уже закончилась, поэтому новый бесплатный календарь для неё больше не создаётся.";
    if (code === "offer_not_found" || code === "trial_not_ready") return "Бесплатная неделя для этой группы сейчас недоступна.";
    if (code === "trials_not_open" || code === "university_trials_not_open") return "Бесплатная неделя сейчас недоступна.";
    return "Не удалось создать календарь. Проверьте интернет и попробуйте ещё раз.";
  }

  async function startTrial(button) {
    if (!trialReady()) return;
    const group = selectedGroup();
    if (!group) return;
    button.disabled = true;
    button.textContent = "Создаём календарь…";
    notice.hidden = true;
    try {
      const response = await fetch(`${config.apiBaseUrl}${config.trialPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          university: config.university,
          program: config.program.id,
          course: config.program.course,
          stream: groupStream(group),
          groupCode: group.code,
          groupId: groupId(group),
          ...attributionContext(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "trial_unavailable");
      if (!validHttpsUrl(result.subscriptionUrl) || !validToken(result.conversionId)) throw new Error("trial_unavailable");
      state.trial = result;
      state.conversionId = result.conversionId;
      saveTrialSession(group, result);
      setStep("trial");
    } catch (error) {
      notice.hidden = false;
      notice.textContent = friendlyTrialError(error.message);
      render();
    }
  }

  function friendlyCheckoutError(code) {
    if (code === "sales_not_open" || code === "university_sales_not_open") return "Полный календарь сейчас недоступен.";
    if (code === "offer_not_found" || code === "offer_not_ready" || code === "offer_expired") return "Полный календарь для этой группы сейчас недоступен.";
    if (code === "trial_context_invalid") return "Не удалось продолжить оформление после бесплатной недели. Обновите страницу и попробуйте ещё раз.";
    return "Не удалось перейти к оплате. Попробуйте ещё раз позднее.";
  }

  async function submitPayment(event, emailInput, submit, status) {
    event.preventDefault();
    status.textContent = "";
    if (!checkoutReady()) {
      status.textContent = "Полный календарь сейчас недоступен.";
      return;
    }
    const group = selectedGroup();
    if (!group) return;
    if (!emailInput.validity.valid) {
      status.textContent = "Укажите корректный email.";
      emailInput.focus();
      return;
    }
    submit.disabled = true;
    submit.textContent = "Переходим к оплате…";
    try {
      const response = await fetch(`${config.apiBaseUrl}${config.paymentPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailInput.value.trim(),
          university_id: config.university,
          program: config.program.id,
          course: config.program.course,
          stream: groupStream(group),
          groupCode: group.code,
          groupId: groupId(group),
          timezone: config.timezone,
          plan: config.defaultPlan,
          ...(state.conversionId ? { conversionId: state.conversionId } : {}),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "payment_unavailable");
      if (!result.confirmationUrl || !validOrderId(result.orderId) || !validToken(result.accessToken)) throw new Error("payment_unavailable");
      saveOrder(result.orderId, result.accessToken);
      window.location.assign(result.confirmationUrl);
    } catch (error) {
      status.textContent = friendlyCheckoutError(error.message);
      submit.disabled = false;
      submit.textContent = `Перейти к оплате · ${rubleLabel(runtime.price) || ""}`.trim();
    }
  }

  function readSavedOrders() {
    try {
      const values = JSON.parse(localStorage.getItem(savedOrderKey) || "[]");
      return Array.isArray(values)
        ? values.filter((item) => validOrderId(item?.orderId) && validToken(item?.accessToken)).slice(0, 10)
        : [];
    } catch {
      return [];
    }
  }

  function saveOrder(orderId, accessToken) {
    if (!validOrderId(orderId) || !validToken(accessToken)) return;
    const values = [
      { orderId, accessToken },
      ...readSavedOrders().filter((item) => item.orderId !== orderId),
    ].slice(0, 10);
    try { localStorage.setItem(savedOrderKey, JSON.stringify(values)); } catch { /* storage can be unavailable */ }
  }

  function latestSavedOrder() {
    return readSavedOrders()[0] || null;
  }

  function saveTrialSession(group, result) {
    if (!group || !validToken(result?.conversionId) || !validHttpsUrl(result?.subscriptionUrl)) return;
    try {
      sessionStorage.setItem(trialSessionKey, JSON.stringify({ groupCode: group.code, result }));
    } catch { /* storage can be unavailable */ }
  }

  function readTrialSession() {
    try {
      const value = JSON.parse(sessionStorage.getItem(trialSessionKey) || "null");
      if (!groupMap.has(value?.groupCode)) return null;
      if (!validToken(value?.result?.conversionId) || !validHttpsUrl(value?.result?.subscriptionUrl)) return null;
      return value;
    } catch {
      return null;
    }
  }

  function clearTrialSession() {
    try { sessionStorage.removeItem(trialSessionKey); } catch { /* ignore */ }
  }

  function orderHeaders(accessToken) {
    return validToken(accessToken) ? { "X-Order-Token": accessToken } : {};
  }

  function renderResultCard({ heading, text, groupLabel = "", subscriptionUrl = "", pendingOrder = null }) {
    state.step = "result";
    updateStepIndicators("result");
    kicker.textContent = "Календарь";
    backButton.hidden = true;
    grid.replaceChildren();
    title.textContent = heading;
    const card = document.createElement("section");
    card.className = "result-card";
    const mark = document.createElement("div");
    mark.className = "success-mark";
    mark.textContent = subscriptionUrl ? "✓" : "…";
    const h3 = document.createElement("h3");
    h3.textContent = heading;
    const p = document.createElement("p");
    p.textContent = text;
    card.append(mark, h3, p);
    if (groupLabel) {
      const group = document.createElement("div");
      group.className = "result-group";
      group.textContent = groupLabel;
      card.append(group);
    }
    const actions = document.createElement("div");
    actions.className = "result-actions";
    if (subscriptionUrl) {
      const apple = document.createElement("a");
      apple.className = "pay-button link-button";
      apple.href = subscriptionUrl.replace(/^https:/, "webcal:");
      apple.textContent = "Подключить на iPhone";
      const google = document.createElement("button");
      google.type = "button";
      google.className = "copy-button";
      google.textContent = "Скопировать для Google Calendar";
      google.addEventListener("click", () => { void copySubscriptionUrl(subscriptionUrl, google); });
      actions.append(apple, google);
    }
    if (pendingOrder) {
      const check = document.createElement("button");
      check.type = "button";
      check.className = "pay-button";
      check.textContent = "Проверить статус";
      check.addEventListener("click", () => { void renderOrderResult(pendingOrder.orderId, pendingOrder.accessToken); });
      actions.append(check);
    }
    const choose = document.createElement("button");
    choose.type = "button";
    choose.className = "secondary-action";
    choose.textContent = "Выбрать группу";
    choose.addEventListener("click", () => {
      state.group = null;
      state.conversionId = "";
      state.trial = null;
      clearTrialSession();
      setStep("group");
    });
    actions.append(choose);
    card.append(actions);
    grid.append(card);
  }

  async function renderOrderResult(orderId, accessToken) {
    renderResultCard({ heading: "Проверяем оплату", text: "Получаем статус заказа…" });
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/v1/orders/${orderId}`, {
          cache: "no-store",
          headers: orderHeaders(accessToken),
        });
        const order = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error("order_unavailable");
        if (order.status === "succeeded" && validHttpsUrl(order.subscriptionUrl)) {
          clearTrialSession();
          renderResultCard({
            heading: "Календарь готов",
            text: "Оплата подтверждена. Подключите персональную ссылку один раз.",
            groupLabel: order.groupDisplayName || order.groupCode || order.group || "",
            subscriptionUrl: order.subscriptionUrl,
          });
          return;
        }
        if (order.status === "canceled") {
          renderResultCard({ heading: "Платёж отменён", text: "Доступ не выдан. Можно выбрать группу и попробовать ещё раз." });
          return;
        }
      } catch { /* transient API error */ }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    renderResultCard({
      heading: "Платёж обрабатывается",
      text: "Повторно платить не нужно. Проверьте статус ещё раз через несколько секунд.",
      pendingOrder: { orderId, accessToken },
    });
  }

  function handlePaymentReturn() {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const orderId = params.get("order");
    const accessToken = params.get("access");
    if (validOrderId(orderId) && validToken(accessToken)) {
      saveOrder(orderId, accessToken);
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}#order-status`);
      void renderOrderResult(orderId, accessToken);
      return true;
    }
    if (hash === "order-status") {
      const saved = latestSavedOrder();
      if (saved) {
        void renderOrderResult(saved.orderId, saved.accessToken);
        return true;
      }
    }
    return false;
  }

  function renderSavedOrderRecovery() {
    const saved = latestSavedOrder();
    if (!saved || !savedOrders || !savedOrdersList) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "saved-order-link";
    button.textContent = "Открыть последний календарь";
    button.addEventListener("click", () => {
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}#order-status`);
      void renderOrderResult(saved.orderId, saved.accessToken);
    });
    savedOrdersList.replaceChildren(button);
    savedOrders.hidden = false;
  }

  async function restoreContinueContext(conversionId) {
    if (!validToken(conversionId)) return false;
    try {
      const response = await fetch(`${config.apiBaseUrl}${config.trialPath}/continue/${encodeURIComponent(conversionId)}`, { cache: "no-store" });
      const context = await response.json().catch(() => ({}));
      if (!response.ok) return false;
      const group = groupMap.get(String(context.groupCode || ""));
      if (!group) return false;
      if (
        context.university !== config.university ||
        context.program !== config.program.id ||
        Number(context.course) !== Number(config.program.course) ||
        String(context.stream || "") !== groupStream(group) ||
        String(context.groupId || "") !== groupId(group)
      ) return false;
      state.group = group.code;
      state.conversionId = conversionId;
      setStep("access", { updateUrl: false });
      return true;
    } catch {
      return false;
    }
  }

  async function loadRuntime() {
    runtime.ready = false;
    if (heroRuntimeNote) heroRuntimeNote.textContent = "Проверяем доступность бесплатной недели…";
    if (state.step !== "result") render();
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/v2/meta`, { cache: "no-store" });
      const meta = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("runtime_unavailable");
      runtime.trial = meta.universityTrials?.ugmu === "open" ? "open" : "closed";
      runtime.sales = meta.sales === "open" ? "open" : "closed";
      runtime.paymentMode = meta.paymentMode === "live" ? "live" : meta.paymentMode === "test" ? "test" : "unknown";
      runtime.price = String(meta.offers?.[config.defaultPlan]?.price || "");
      runtime.ready = true;
      if (heroRuntimeNote) heroRuntimeNote.textContent = trialReady()
        ? "Для ОЛД 101–124 можно бесплатно подключить первую учебную неделю."
        : "Выберите группу, чтобы посмотреть доступные варианты подключения.";
    } catch {
      runtime.ready = false;
      runtime.trial = "closed";
      runtime.sales = "closed";
      runtime.paymentMode = "unknown";
      runtime.price = "";
      if (heroRuntimeNote) heroRuntimeNote.textContent = "Не удалось проверить доступность. Обновите страницу и попробуйте ещё раз.";
    }
    if (state.step !== "result") render();
  }

  backButton.addEventListener("click", () => {
    if (state.step === "course") setStep("faculty");
    else if (state.step === "group") setStep("course");
    else if (state.step === "access") setStep("group");
    else if (state.step === "trial" || state.step === "checkout") setStep("access");
  });

  renderSavedOrderRecovery();
  const paymentHandled = handlePaymentReturn();
  if (!paymentHandled) {
    const params = new URLSearchParams(window.location.search);
    const continueId = params.get("continue") || "";
    const requested = params.get("group") || "";
    if (continueId) {
      void restoreContinueContext(continueId).then((restored) => {
        if (!restored) setStep("faculty", { updateUrl: false });
      });
    } else {
      const savedTrial = readTrialSession();
      if (savedTrial) {
        state.group = savedTrial.groupCode;
        state.trial = savedTrial.result;
        state.conversionId = savedTrial.result.conversionId;
        setStep("trial", { updateUrl: false });
      } else if (/^(10[1-9]|11\d|12[0-4])$/.test(requested)) {
        state.group = `ОЛД ${requested}`;
        setStep("access", { updateUrl: false });
      } else {
        setStep("faculty", { updateUrl: false });
      }
    }
  }
  void loadRuntime();

  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#order-status" || window.location.hash.startsWith("#order=")) handlePaymentReturn();
  });
})();