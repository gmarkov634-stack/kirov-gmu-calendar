(() => {
  "use strict";

  const data = window.CALENDAR_DATA;
  const dashboard = document.querySelector("#admin-dashboard");
  const toolbar = document.querySelector(".admin-toolbar");
  const loginForm = document.querySelector("#admin-login");
  const tokenInput = document.querySelector("#admin-token");
  const refreshButton = document.querySelector("#admin-refresh");
  if (!data?.apiBase || !dashboard || !toolbar || !tokenInput) return;

  let windowValue = "7";
  let requestVersion = 0;

  function number(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function integer(value) {
    return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(number(value));
  }

  function rubles(value) {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 2 }).format(number(value));
  }

  function percent(value) {
    return value == null ? "—" : `${new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 1 }).format(number(value))}`;
  }

  function programName(id) {
    const faculty = (data.faculties || []).find((item) => item.id === id);
    return faculty?.short || faculty?.name || id || "—";
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function buildSection() {
    const section = document.createElement("section");
    section.className = "admin-section";
    section.id = "analytics-section";
    section.setAttribute("aria-labelledby", "analytics-title");

    const head = element("div", "analytics-head");
    const copy = document.createElement("div");
    copy.append(element("p", "section-kicker", "Продажи и использование"));
    const title = element("h2", "", "Аналитика");
    title.id = "analytics-title";
    copy.append(title, element("p", "dry-run-note", "Путь студента от лендинга до фактического подключения оплаченного календаря."));

    const periods = element("div", "analytics-periods");
    periods.setAttribute("aria-label", "Период аналитики");
    for (const [value, label] of [["1", "24 часа"], ["7", "7 дней"], ["30", "30 дней"], ["all", "Весь период"]]) {
      const button = element("button", `analytics-period${value === windowValue ? " is-active" : ""}`, label);
      button.type = "button";
      button.dataset.days = value;
      button.addEventListener("click", () => {
        windowValue = value;
        periods.querySelectorAll(".analytics-period").forEach((item) => item.classList.toggle("is-active", item === button));
        loadAnalytics();
      });
      periods.append(button);
    }
    head.append(copy, periods);

    section.append(head);
    section.append(element("div", "analytics-state", "Аналитика загружается…"));
    section.append(element("div", "analytics-funnel"));
    section.append(element("div", "analytics-grid"));
    section.append(element("div", "analytics-columns"));
    section.append(element("p", "analytics-foot", "Коммерческие показатели строятся только по подтверждённым серверным фактам. Тестовые платежи не входят в боевую выручку."));
    toolbar.insertAdjacentElement("afterend", section);
    return section;
  }

  const section = buildSection();
  const stateNode = section.querySelector(".analytics-state");
  const funnelNode = section.querySelector(".analytics-funnel");
  const cardsNode = section.querySelector(".analytics-grid");
  const columnsNode = section.querySelector(".analytics-columns");

  function metricCard(label, value, note = "") {
    const card = element("article", "analytics-card");
    card.append(element("span", "", label), element("strong", "", value));
    if (note) card.append(element("small", "", note));
    return card;
  }

  function funnelStage(label, value, rate) {
    const stage = element("article", "analytics-stage");
    stage.append(element("span", "", label), element("strong", "", integer(value)), element("small", "", rate == null ? "" : `конверсия ${percent(rate)}`));
    return stage;
  }

  function tableBlock(title, headers, rows, mapper) {
    const block = element("section", "analytics-block");
    block.append(element("h3", "", title));
    if (!rows?.length) {
      block.append(element("p", "analytics-empty", "Пока нет данных за выбранный период."));
      return block;
    }
    const table = element("table", "analytics-table");
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const header of headers) headRow.append(element("th", "", header));
    thead.append(headRow);
    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const value of mapper(row)) tr.append(element("td", "", value));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    block.append(table);
    return block;
  }

  function objectRows(object, labels) {
    return Object.entries(object || {}).map(([key, value]) => ({ key, label: labels[key] || key, ...value }));
  }

  function render(payload) {
    const collectionOpen = payload?.collection?.enabled === true;
    stateNode.className = `analytics-state${collectionOpen ? " is-open" : ""}`;
    stateNode.textContent = collectionOpen
      ? "Сбор полной воронки включён. Посещения и действия лендинга связываются с подтверждёнными trial, оплатами и фактическими подключениями."
      : "Сбор верхней части воронки сейчас закрыт feature flag. Серверные trial/оплаты/подключения продолжают отображаться, но посещения и клики будут равны нулю до открытия FUNNEL_ANALYTICS_ENABLED.";

    const upper = payload?.upper || {};
    const journeys = upper.uniqueJourneys || {};
    const facts = upper.linkedServerFacts || {};
    const rates = upper.rates || {};
    funnelNode.replaceChildren(
      funnelStage("Посетили лендинг", journeys.landingView, null),
      funnelStage("Выбрали группу", journeys.groupSelected, rates.landingToGroupSelected),
      funnelStage("Создали trial", facts.trialCreated, rates.groupSelectedToTrialCreated),
      funnelStage("Подключили trial", facts.trialConnected, rates.trialCreatedToConnected),
      funnelStage("Начали оплату", journeys.checkoutStarted, null),
      funnelStage("Оплатили", facts.paymentSucceeded, rates.checkoutToPayment),
      funnelStage("Подключили paid", facts.paidConnected, rates.paymentToPaidConnected),
    );

    const live = payload?.commercial?.live || {};
    const test = payload?.commercial?.test || {};
    const payments = payload?.payments?.all || {};
    cardsNode.replaceChildren(
      metricCard("Боевые продажи", integer(live.orders), `тестовых: ${integer(test.orders)}`),
      metricCard("Выручка", rubles(live.revenueRub), `средний чек: ${rubles(live.averageOrderRub)}`),
      metricCard("Paid подключено", integer(live.connected), `от боевых оплат: ${percent(live.connectRate)}`),
      metricCard("Trial → paid", integer(payments.trialToPaidSucceeded), `из подключённых trial: ${percent(payments.trialToPaidRateFromConnectedTrial)}`),
    );

    const plans = objectRows(payload?.commercial?.plans, { semester: "Семестр", year: "Учебный год" });
    const paths = objectRows(payload?.commercial?.purchasePaths, { direct_purchase: "Прямая покупка", trial_to_paid: "После trial" });
    const sources = payload?.segments?.sources || [];
    const groups = payload?.segments?.groups || [];
    const programs = payload?.segments?.programs || [];
    const courses = payload?.segments?.courses || [];
    const paidChannels = payload?.segments?.channels?.paid || {};
    const trialChannels = payload?.segments?.channels?.trial || {};
    const channels = [
      { label: "Apple / iPhone", trial: number(trialChannels.iphone), paid: number(paidChannels.iphone) },
      { label: "Google Calendar", trial: number(trialChannels.google), paid: number(paidChannels.google) },
      { label: "Другое", trial: number(trialChannels.other), paid: number(paidChannels.other) },
    ].filter((item) => item.trial || item.paid);

    columnsNode.replaceChildren(
      tableBlock("Тарифы", ["Тариф", "Продажи", "Выручка"], plans, (row) => [row.label, integer(row.orders), rubles(row.revenueRub)]),
      tableBlock("Путь к покупке", ["Путь", "Продажи", "Выручка"], paths, (row) => [row.label, integer(row.orders), rubles(row.revenueRub)]),
      tableBlock("Источники", ["Источник", "Визиты", "Продажи", "Выручка"], sources, (row) => [row.source, integer(row.visits), integer(row.orders), rubles(row.revenueRub)]),
      tableBlock("Apple / Google", ["Канал", "Trial", "Paid"], channels, (row) => [row.label, integer(row.trial), integer(row.paid)]),
      tableBlock("Группы с наибольшим спросом", ["Группа", "Выборы", "Продажи", "Выручка"], groups.slice(0, 10), (row) => [`${programName(row.program)} · ${row.course || "—"} курс · ${row.groupCode}`, integer(row.selected), integer(row.orders), rubles(row.revenueRub)]),
      tableBlock("Факультеты / направления", ["Направление", "Выборы", "Продажи", "Выручка"], programs, (row) => [programName(row.program), integer(row.selected), integer(row.orders), rubles(row.revenueRub)]),
      tableBlock("Курсы", ["Курс", "Выборы", "Продажи", "Выручка"], courses, (row) => [`${programName(row.program)} · ${row.course || "—"}`, integer(row.selected), integer(row.orders), rubles(row.revenueRub)]),
    );
  }

  function renderError(status) {
    stateNode.className = "analytics-state";
    stateNode.textContent = status === 403
      ? "Не удалось открыть аналитику: неверный ключ администратора."
      : "Аналитика временно недоступна. Остальные функции админки продолжают работать.";
    funnelNode.replaceChildren();
    cardsNode.replaceChildren();
    columnsNode.replaceChildren();
  }

  async function loadAnalytics() {
    if (!tokenInput.value) return;
    const version = ++requestVersion;
    section.classList.add("analytics-loading");
    const params = new URLSearchParams({
      university: data.university || "kgmu",
      academicYear: data.offer?.academicYear || "",
      semester: String(data.offer?.semester || ""),
      days: windowValue,
    });
    try {
      const response = await fetch(`${data.apiBase}/api/v1/admin/funnel?${params}`, {
        cache: "no-store",
        headers: { "X-Admin-Token": tokenInput.value },
      });
      if (version !== requestVersion) return;
      if (!response.ok) {
        renderError(response.status);
        return;
      }
      render(await response.json());
    } catch (error) {
      console.error("admin analytics request failed", error);
      if (version === requestVersion) renderError(0);
    } finally {
      if (version === requestVersion) section.classList.remove("analytics-loading");
    }
  }

  loginForm?.addEventListener("submit", () => queueMicrotask(loadAnalytics));
  refreshButton?.addEventListener("click", () => queueMicrotask(loadAnalytics));
  window.addEventListener("focus", () => {
    if (!dashboard.hidden && tokenInput.value) loadAnalytics();
  });
})();
