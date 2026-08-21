(() => {
  const config = window.UGMU_CONFIG;
  if (!config || config.university !== "ugmu") return;

  const groupSelect = document.querySelector("#group-select");
  const groupSummary = document.querySelector("#group-summary");
  const selectionSummary = document.querySelector("#selection-summary");
  const eventCount = document.querySelector("#event-count");
  const lectureCount = document.querySelector("#lecture-count");
  const preview = document.querySelector("#group-preview");
  const sourceState = document.querySelector("#source-state");
  const emailInput = document.querySelector("#email");
  const form = document.querySelector("#order-form");
  const status = document.querySelector("#form-status");
  const submit = form?.querySelector('button[type="submit"]');
  const resultPanel = document.querySelector("#order-result");
  const orderSection = document.querySelector("#order");
  const restoreOrderButton = document.querySelector("#restore-order");
  const priceSummary = document.querySelector("#price-summary");
  const runtimePrice = document.querySelector("#runtime-price");
  const runtimeSaleNote = document.querySelector("#runtime-sale-note");
  const runtimeState = document.querySelector("#runtime-state");
  const testBanner = document.querySelector("#test-banner");
  const groupMap = new Map(config.groups.map((group) => [group.code, group]));
  const savedOrderKey = "ugmu-calendar-orders-v1";

  if (!groupSelect || !form || !submit || !resultPanel || !orderSection) return;

  const runtime = {
    ready: false,
    sales: "closed",
    paymentMode: "unknown",
    price: "",
  };

  function groupId(group) {
    return `${config.university}:${config.program.id}:${config.program.course}:stream-${config.program.stream}:${group.code}`;
  }

  function validOrderId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value);
  }

  function validAccessToken(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
  }

  function readSavedOrders() {
    try {
      const values = JSON.parse(localStorage.getItem(savedOrderKey) || "[]");
      return Array.isArray(values)
        ? values.filter((item) => validOrderId(item?.orderId) && validAccessToken(item?.accessToken)).slice(0, 10)
        : [];
    } catch {
      return [];
    }
  }

  function saveOrder(orderId, accessToken) {
    if (!validOrderId(orderId) || !validAccessToken(accessToken)) return;
    const values = [
      { orderId, accessToken },
      ...readSavedOrders().filter((item) => item.orderId !== orderId),
    ].slice(0, 10);
    try { localStorage.setItem(savedOrderKey, JSON.stringify(values)); } catch { /* storage can be unavailable */ }
  }

  function latestSavedOrder() {
    return readSavedOrders()[0] || null;
  }

  function orderHeaders(accessToken) {
    return validAccessToken(accessToken) ? { "X-Order-Token": accessToken } : {};
  }

  function humanDate(value) {
    const date = new Date(`${value}T00:00:00`);
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  }

  function eventMarkup(date, start, end, title, location, type) {
    const label = type === "lecture" ? `Лекция · ${location}` : location;
    return `<article class="qa-event"><time>${humanDate(date)}<br>${start}–${end}</time><div><strong>${title}</strong><span>${label}</span></div></article>`;
  }

  function rubleLabel(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return "";
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(amount)} ₽`;
  }

  function selectedGroup() {
    return groupMap.get(groupSelect.value) || null;
  }

  function renderGroup(code, { updateUrl = true } = {}) {
    const group = groupMap.get(code) || config.groups[0];
    groupSelect.value = group.code;
    if (groupSummary) groupSummary.textContent = `${group.code} · 1 курс · I поток`;
    if (selectionSummary) selectionSummary.textContent = `${config.program.name} · ${group.code}`;
    if (eventCount) eventCount.textContent = String(group.events);
    if (lectureCount) lectureCount.textContent = String(group.lectures);
    if (preview) {
      preview.innerHTML = [
        eventMarkup("2026-09-01", "08:50", "10:20", "ЛЕКЦ. ХИМИЯ", "Онлайн", "lecture"),
        eventMarkup("2026-09-01", group.firstClass[0], group.firstClass[1], group.firstClass[2], group.firstClass[3], "other"),
        eventMarkup(group.lastClass[0], group.lastClass[1], group.lastClass[2], group.lastClass[3], group.lastClass[4], "other"),
      ].join("");
    }
    if (updateUrl) {
      const params = new URLSearchParams(window.location.search);
      params.set("group", group.code.replace("ОЛД ", ""));
      const hash = window.location.hash && window.location.hash !== "#preview" ? window.location.hash : "#order";
      window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}${hash}`);
    }
  }

  function checkoutReady() {
    return runtime.ready && runtime.sales === "open" && runtime.paymentMode === "live";
  }

  function updateRuntimeUi() {
    const priceLabel = rubleLabel(runtime.price);
    if (runtimePrice) runtimePrice.textContent = priceLabel || (runtime.ready ? "Продажи пока закрыты" : "Проверяем доступность");
    if (priceSummary) priceSummary.textContent = priceLabel || "—";
    if (testBanner) testBanner.hidden = runtime.paymentMode !== "test";

    if (!runtime.ready) {
      submit.disabled = true;
      submit.textContent = "Проверяем доступность…";
      if (runtimeState) runtimeState.textContent = "Проверяем production API";
      if (runtimeSaleNote) runtimeSaleNote.textContent = "Оплата откроется только после подтверждения production-gates";
      return;
    }

    if (runtime.sales !== "open") {
      submit.disabled = true;
      submit.textContent = "Продажи УГМУ пока закрыты";
      if (runtimeState) runtimeState.textContent = "Checkout закрыт";
      if (runtimeSaleNote) runtimeSaleNote.textContent = "Интерфейс готов, но сервер ещё не разрешает продажи";
      return;
    }

    if (runtime.paymentMode !== "live") {
      submit.disabled = true;
      submit.textContent = "Оплата ещё не переведена в live-режим";
      if (runtimeState) runtimeState.textContent = "ЮKassa: тестовый режим";
      if (runtimeSaleNote) runtimeSaleNote.textContent = "Реальная оплата заблокирована до отдельной проверки ЮKassa";
      return;
    }

    submit.disabled = false;
    submit.textContent = priceLabel ? `Перейти к оплате · ${priceLabel}` : "Перейти к оплате";
    if (runtimeState) runtimeState.textContent = "Checkout готов";
    if (runtimeSaleNote) runtimeSaleNote.textContent = "Разовый платёж · обновления календаря входят в подписку";
  }

  async function loadRuntime() {
    runtime.ready = false;
    runtime.sales = "closed";
    runtime.paymentMode = "unknown";
    runtime.price = "";
    updateRuntimeUi();
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/v2/meta`, { cache: "no-store" });
      const meta = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("runtime_unavailable");
      runtime.sales = meta.sales === "open" ? "open" : "closed";
      runtime.paymentMode = meta.paymentMode === "live" ? "live" : meta.paymentMode === "test" ? "test" : "unknown";
      runtime.price = String(meta.offers?.[config.defaultPlan]?.price || "");
      runtime.ready = true;
      status.textContent = "";
    } catch {
      runtime.ready = true;
      runtime.sales = "closed";
      runtime.paymentMode = "unknown";
      runtime.price = "";
      status.textContent = "Не удалось подтвердить production-состояние. Оплата остаётся закрытой.";
    }
    updateRuntimeUi();
  }

  function showResultShell(title, text) {
    form.hidden = true;
    resultPanel.hidden = false;
    resultPanel.replaceChildren();
    const heading = document.createElement("h3");
    heading.textContent = title;
    resultPanel.append(heading);
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = text;
    resultPanel.append(note);
  }

  function restoreOrderForm({ scroll = true } = {}) {
    resultPanel.hidden = true;
    resultPanel.replaceChildren();
    form.hidden = false;
    status.textContent = "";
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#order`);
    if (scroll) orderSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function addText(text, className = "note") {
    const element = document.createElement("p");
    element.className = className;
    element.textContent = text;
    resultPanel.append(element);
    return element;
  }

  function addLink(label, href, className = "primary") {
    const link = document.createElement("a");
    link.className = className;
    link.href = href;
    link.textContent = label;
    resultPanel.append(link);
    return link;
  }

  function addButton(label, handler, className = "secondary") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", handler);
    resultPanel.append(button);
    return button;
  }

  async function copySubscriptionUrl(url, button) {
    try {
      await navigator.clipboard.writeText(url);
      button.textContent = "Ссылка скопирована";
    } catch {
      window.prompt("Скопируйте ссылку календаря:", url);
    }
  }

  function showSucceededOrder(order) {
    showResultShell("Календарь оплачен", "Оплата подтверждена. Персональная подписная ссылка готова.");
    addText("Готово", "result-kicker");
    addText(order.groupDisplayName || `Группа ${order.groupCode || order.group}`, "result-group");
    addText("Ссылка персональная. Не пересылайте её другим людям.");
    const webcalUrl = order.subscriptionUrl.replace(/^https:/, "webcal:");
    addLink("Подключить на iPhone / Apple Calendar", webcalUrl);
    const copyButton = addButton("Скопировать ссылку для Google Calendar", () => copySubscriptionUrl(order.subscriptionUrl, copyButton));
    addText("В Google Calendar откройте «Другие календари → Добавить по URL» и вставьте скопированную ссылку.");
    addLink("Открыть Google Calendar", "https://calendar.google.com/calendar/", "secondary");
    addButton("Вернуться к выбору группы", () => restoreOrderForm());
  }

  function showCanceledOrder() {
    showResultShell("Платёж отменён", "Доступ не выдан.");
    addText("Можно вернуться к форме и попробовать ещё раз.");
    addButton("Вернуться к выбору группы", () => restoreOrderForm());
  }

  function showPendingOrder(orderId, accessToken) {
    showResultShell("Платёж ещё обрабатывается", "Повторно платить не нужно.");
    addButton("Проверить статус", () => renderOrderResult(orderId, accessToken), "primary");
    addButton("Вернуться к выбору группы", () => restoreOrderForm());
  }

  async function renderOrderResult(orderId, accessToken) {
    showResultShell("Проверяем платёж", "Получаем статус заказа…");
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/v1/orders/${orderId}`, {
          cache: "no-store",
          headers: orderHeaders(accessToken),
        });
        const order = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(order.error || "order_unavailable");
        if (order.status === "succeeded" && typeof order.subscriptionUrl === "string") {
          showSucceededOrder(order);
          return;
        }
        if (order.status === "canceled") {
          showCanceledOrder();
          return;
        }
      } catch { /* transient API error */ }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    showPendingOrder(orderId, accessToken);
  }

  function handlePaymentReturn() {
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const orderId = params.get("order");
    const accessToken = params.get("access");
    if (validOrderId(orderId) && validAccessToken(accessToken)) {
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

  function enableSavedOrderRecovery() {
    if (!restoreOrderButton) return;
    const saved = latestSavedOrder();
    if (!saved) return;
    restoreOrderButton.hidden = false;
    restoreOrderButton.addEventListener("click", () => {
      history.replaceState(null, "", `${window.location.pathname}${window.location.search}#order-status`);
      void renderOrderResult(saved.orderId, saved.accessToken);
    });
  }

  function friendlyCheckoutError(code) {
    if (code === "sales_not_open" || code === "university_sales_not_open") return "Продажи УГМУ пока закрыты.";
    if (code === "offer_not_found") return "Эта группа сейчас не доступна для покупки.";
    if (code === "offer_not_ready" || code === "offer_expired") return "Текущий оффер пока недоступен.";
    if (code === "payments_not_configured") return "Платёжный контур ещё не готов.";
    return "Не удалось создать оплату. Попробуйте ещё раз позднее.";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";
    if (!checkoutReady()) {
      status.textContent = runtime.sales !== "open"
        ? "Продажи УГМУ пока закрыты."
        : "Реальная оплата откроется только после перехода ЮKassa в live-режим.";
      return;
    }
    const group = selectedGroup();
    if (!group) {
      status.textContent = "Выберите группу.";
      return;
    }
    if (!emailInput?.validity.valid) {
      status.textContent = "Укажите корректный email.";
      emailInput?.focus();
      return;
    }

    const payload = {
      email: emailInput.value.trim(),
      university_id: config.university,
      program: config.program.id,
      course: config.program.course,
      stream: config.program.stream,
      groupCode: group.code,
      groupId: groupId(group),
      timezone: config.timezone,
      plan: config.defaultPlan,
    };

    submit.disabled = true;
    submit.textContent = "Создаём оплату…";
    try {
      const response = await fetch(`${config.apiBaseUrl}${config.paymentPath}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (result.error === "sales_not_open" || result.error === "university_sales_not_open") runtime.sales = "closed";
        throw new Error(friendlyCheckoutError(result.error));
      }
      if (!result.confirmationUrl || !validOrderId(result.orderId) || !validAccessToken(result.accessToken)) {
        throw new Error("API вернул неполные данные оплаты.");
      }
      saveOrder(result.orderId, result.accessToken);
      window.location.assign(result.confirmationUrl);
    } catch (error) {
      status.textContent = error.message || "Не удалось создать оплату.";
      updateRuntimeUi();
    }
  });

  for (const group of config.groups) {
    const option = document.createElement("option");
    option.value = group.code;
    option.textContent = group.code;
    groupSelect.append(option);
  }

  sourceState.textContent = `Источник проверен · ${config.academicYear} · SHA-256 ${config.sourceSha256.slice(0, 12)}…`;
  const requested = new URLSearchParams(window.location.search).get("group");
  const requestedCode = requested && /^(10[1-9]|11[0-2])$/.test(requested) ? `ОЛД ${requested}` : config.groups[0].code;
  renderGroup(requestedCode, { updateUrl: !window.location.hash.startsWith("#order=") });
  groupSelect.addEventListener("change", () => renderGroup(groupSelect.value));
  enableSavedOrderRecovery();
  const paymentReturnHandled = handlePaymentReturn();
  void loadRuntime();
  if (!paymentReturnHandled && !window.location.hash) history.replaceState(null, "", `${window.location.pathname}${window.location.search}#order`);

  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#order-status" || window.location.hash.startsWith("#order=")) {
      handlePaymentReturn();
      return;
    }
    if (window.location.hash === "#order" && form.hidden) restoreOrderForm({ scroll: false });
  });
})();
