(() => {
  const config = window.IZHGMU_CONFIG;
  if (!config) return;

  const university = String(config.university || "izhgmu");
  const program = String(config.program || "medicine");
  const approvedCourses = new Set((config.prelaunchCourses || []).map(Number).filter(Number.isInteger));
  const courseSelect = document.querySelector("#course-select");
  const groupSelect = document.querySelector("#group-select");
  const catalogStatus = document.querySelector("#catalog-status");
  const selectionStatus = document.querySelector("#selection-status");
  const runtimeStatus = document.querySelector("#runtime-status");
  const subscriptionActions = document.querySelector("#subscription-actions");
  const trialButton = document.querySelector("#trial-button");
  const paymentForm = document.querySelector("#payment-form");
  const planSelect = document.querySelector("#plan-select");
  const emailInput = document.querySelector("#customer-email");
  const payButton = document.querySelector("#pay-button");
  const resultPanel = document.querySelector("#subscription-result");
  const prelaunchLock = document.querySelector("#prelaunch-lock");

  if (!courseSelect || !groupSelect || !catalogStatus || !selectionStatus) return;

  const groupById = new Map();
  const runtime = {
    status: "loading",
    sales: "closed",
    trials: "closed",
    universityCommercial: "closed",
    paymentMode: "unknown",
    offers: {},
  };
  let conversionId = "";

  function apiUrl(path) {
    return `${String(config.apiBaseUrl || "").replace(/\/+$/, "")}${path}`;
  }

  function setCatalogStatus(text, tone = "muted") {
    catalogStatus.textContent = text;
    catalogStatus.dataset.tone = tone;
  }

  function resetSelect(select, label, disabled = true) {
    select.replaceChildren(new Option(label, ""));
    select.disabled = disabled;
  }

  function validOrderId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value);
  }

  function validAccessToken(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
  }

  function validConversionId(value) {
    return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
  }

  function validSubscriptionUrl(value) {
    try {
      const url = new URL(String(value || ""));
      const api = new URL(config.apiBaseUrl);
      if (url.protocol !== "https:" || url.origin !== api.origin) return "";
      if (!/^\/api\/v1\/subscriptions\/[A-Za-z0-9_-]{43}\/calendar\.ics$/.test(url.pathname)) return "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function selectedGroup() {
    return groupById.get(groupSelect.value) || null;
  }

  function selectedGroupContext() {
    const group = selectedGroup();
    const course = Number(courseSelect.value);
    if (!group || !approvedCourses.has(course)) return null;
    return {
      university,
      program,
      course,
      stream: group.stream ?? null,
      groupCode: group.groupCode,
      groupId: group.groupId,
    };
  }

  function priceLabel(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return "";
    return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(number)} ₽`;
  }

  function populatePlans() {
    if (!planSelect) return;
    planSelect.replaceChildren();
    for (const id of ["semester", "year"]) {
      const price = runtime.offers?.[id]?.price;
      if (!/^\d+\.\d{2}$/.test(String(price || "")) || Number(price) <= 0) continue;
      const label = id === "year" ? "Учебный год" : "Семестр";
      planSelect.add(new Option(`${label} · ${priceLabel(price)}`, id));
    }
    if (planSelect.options.length === 0) {
      planSelect.add(new Option("Тариф пока недоступен", ""));
      planSelect.disabled = true;
      return;
    }
    planSelect.disabled = false;
    const preferred = String(config.defaultPlan || "semester");
    if ([...planSelect.options].some((option) => option.value === preferred)) planSelect.value = preferred;
  }

  function commercialOpen() {
    return runtime.status === "loaded" && runtime.universityCommercial === "open";
  }

  function trialOpen() {
    return commercialOpen() && runtime.trials === "open";
  }

  function salesOpen() {
    return commercialOpen() && runtime.sales === "open";
  }

  function updateRuntimeActions() {
    if (!runtimeStatus || !subscriptionActions) return;
    const context = selectedGroupContext();
    const hasGroup = Boolean(context);
    subscriptionActions.hidden = !hasGroup;
    if (!hasGroup) {
      runtimeStatus.textContent = "Сначала выберите группу из серверного каталога.";
      return;
    }

    if (!commercialOpen()) {
      runtimeStatus.textContent = runtime.status === "error"
        ? "Не удалось подтвердить серверный статус запуска. Подключение остаётся закрытым."
        : "Коммерческий запуск ИжГМУ закрыт отдельным серверным gate.";
      if (trialButton) {
        trialButton.hidden = true;
        trialButton.disabled = true;
      }
      if (paymentForm) paymentForm.hidden = true;
      if (prelaunchLock) prelaunchLock.hidden = false;
      return;
    }

    if (prelaunchLock) prelaunchLock.hidden = trialOpen() || salesOpen();
    if (trialButton) {
      trialButton.hidden = !trialOpen();
      trialButton.disabled = !trialOpen();
    }
    if (paymentForm) paymentForm.hidden = !salesOpen();

    if (trialOpen() && salesOpen()) runtimeStatus.textContent = "Для этой опубликованной группы доступны пробная неделя и полный календарь.";
    else if (trialOpen()) runtimeStatus.textContent = "Для этой опубликованной группы доступна пробная неделя.";
    else if (salesOpen()) runtimeStatus.textContent = "Для этой опубликованной группы доступен полный календарь.";
    else runtimeStatus.textContent = "Группа опубликована, но подключение пока закрыто глобальными серверными gate.";
  }

  function clearResult() {
    if (!resultPanel) return;
    resultPanel.hidden = true;
    resultPanel.replaceChildren();
  }

  function copyButton(url) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary subscription-copy";
    button.textContent = "Скопировать для Google Calendar";
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
        button.textContent = "Ссылка скопирована";
      } catch {
        window.prompt("Скопируйте персональную ссылку календаря:", url);
      }
    });
    return button;
  }

  function showSubscriptionResult({ title, text, subscriptionUrl, groupCode, allowPaid = false }) {
    if (!resultPanel) return;
    const url = validSubscriptionUrl(subscriptionUrl);
    if (!url) return;
    resultPanel.hidden = false;
    resultPanel.replaceChildren();
    resultPanel.className = "subscription-result result-card";

    const heading = document.createElement("h4");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = text;
    const group = document.createElement("strong");
    group.className = "result-group";
    group.textContent = `Группа ${groupCode || selectedGroup()?.groupCode || ""}`;
    const apple = document.createElement("a");
    apple.className = "primary subscription-link";
    apple.href = url.replace(/^https:/, "webcal:");
    apple.textContent = "Подключить на iPhone / Apple Calendar";
    const canonical = document.createElement("a");
    canonical.className = "subscription-https-link";
    canonical.href = url;
    canonical.textContent = "Персональная ссылка календаря";
    canonical.hidden = true;

    resultPanel.append(heading, group, copy, apple, canonical, copyButton(url));

    if (allowPaid && salesOpen() && paymentForm) {
      const paid = document.createElement("button");
      paid.type = "button";
      paid.className = "secondary";
      paid.textContent = "Оставить календарь на полный период";
      paid.addEventListener("click", () => {
        paymentForm.hidden = false;
        emailInput?.focus();
      });
      resultPanel.append(paid);
    }
  }

  async function loadRuntimeMeta() {
    runtime.status = "loading";
    try {
      const response = await fetch(apiUrl(`/api/v2/meta?university=${encodeURIComponent(university)}`), { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.university !== university) throw new Error("meta_unavailable");
      runtime.sales = data.sales === "open" ? "open" : "closed";
      runtime.trials = data.trials === "open" ? "open" : "closed";
      runtime.universityCommercial = data.universityCommercial === "open" ? "open" : "closed";
      runtime.paymentMode = data.paymentMode === "test" ? "test" : "live";
      runtime.offers = data.offers && typeof data.offers === "object" ? data.offers : {};
      runtime.status = "loaded";
    } catch {
      runtime.sales = "closed";
      runtime.trials = "closed";
      runtime.universityCommercial = "closed";
      runtime.offers = {};
      runtime.status = "error";
    }
    populatePlans();
    updateRuntimeActions();
  }

  async function loadGroups(course) {
    resetSelect(groupSelect, "Загружаем группы…");
    groupById.clear();
    selectionStatus.hidden = true;
    clearResult();
    updateRuntimeActions();
    try {
      const response = await fetch(apiUrl(`/api/v2/catalog/${encodeURIComponent(university)}/${encodeURIComponent(program)}/${course}/groups`), { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data?.groups)) throw new Error(data?.error || "catalog_unavailable");

      const groups = data.groups
        .map((item) => ({
          groupId: typeof item?.groupId === "string" ? item.groupId : "",
          groupCode: typeof item?.groupCode === "string" ? item.groupCode : "",
          displayName: typeof item?.displayName === "string" ? item.displayName : "",
          stream: item?.stream == null ? null : String(item.stream),
        }))
        .filter((item) => item.groupId && item.groupCode)
        .sort((a, b) => a.groupCode.localeCompare(b.groupCode, "ru", { numeric: true }));

      resetSelect(groupSelect, groups.length ? "Выберите группу" : "Опубликованных групп пока нет", groups.length === 0);
      for (const group of groups) {
        groupById.set(group.groupId, group);
        groupSelect.add(new Option(group.displayName || `Группа ${group.groupCode}`, group.groupId));
      }
      if (groups.length) setCatalogStatus(`Курс ${course}: сервер подтвердил ${groups.length} опубликованных групп.`, "success");
      else setCatalogStatus(`Для ${course} курса целевого периода пока нет опубликованных групп.`, "warning");
    } catch (error) {
      resetSelect(groupSelect, "Группы недоступны");
      if (error.message === "catalog_not_available") setCatalogStatus("Каталог ИжГМУ ещё не открыт сервером. Группы и подключение недоступны.", "warning");
      else setCatalogStatus("Не удалось подтвердить группы через сервер. Ничего не подставляем автоматически.", "warning");
    }
  }

  async function loadCatalog() {
    resetSelect(courseSelect, "Проверяем каталог…");
    resetSelect(groupSelect, "Группы появятся после проверки расписания 2026/27");
    groupById.clear();
    setCatalogStatus("Проверяем серверный каталог целевого периода…");
    try {
      const response = await fetch(apiUrl(`/api/v2/catalog/${encodeURIComponent(university)}/programs`), { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "catalog_unavailable");
      const medicine = Array.isArray(data?.programs)
        ? data.programs.find((item) => item?.program === program)
        : null;
      const courses = Array.isArray(medicine?.courses)
        ? medicine.courses.map(Number).filter((course) => approvedCourses.has(course)).sort((a, b) => a - b)
        : [];

      if (!courses.length) {
        resetSelect(courseSelect, "Курсы пока недоступны");
        setCatalogStatus("Официальный каталог 2026/27 ещё не содержит готовых лечебных групп 1–3 курсов.", "warning");
        return;
      }

      resetSelect(courseSelect, "Выберите курс", false);
      for (const course of courses) courseSelect.add(new Option(`${course} курс`, String(course)));
      setCatalogStatus("Каталог целевого периода доступен. Выберите курс, чтобы получить группы с сервера.", "success");
    } catch (error) {
      resetSelect(courseSelect, "Каталог пока закрыт");
      if (error.message === "catalog_not_available") setCatalogStatus("Каталог ИжГМУ намеренно закрыт до отдельного запуска 2026/27.", "warning");
      else setCatalogStatus("Не удалось подтвердить каталог через API. Выбор остаётся заблокирован.", "warning");
    }
  }

  courseSelect.addEventListener("change", () => {
    groupById.clear();
    selectionStatus.hidden = true;
    conversionId = "";
    clearResult();
    updateRuntimeActions();
    const course = Number(courseSelect.value);
    if (approvedCourses.has(course)) void loadGroups(course);
    else resetSelect(groupSelect, "Сначала выберите курс");
  });

  groupSelect.addEventListener("change", () => {
    conversionId = "";
    clearResult();
    const group = selectedGroup();
    if (!group) {
      selectionStatus.hidden = true;
      updateRuntimeActions();
      return;
    }
    selectionStatus.hidden = false;
    selectionStatus.textContent = `Выбрана ${group.displayName || `группа ${group.groupCode}`}. Это точная запись из серверного каталога.`;
    updateRuntimeActions();
  });

  async function createTrial() {
    const context = selectedGroupContext();
    if (!context || !trialOpen() || !trialButton) return;
    trialButton.disabled = true;
    const original = trialButton.textContent;
    trialButton.textContent = "Создаём календарь…";
    clearResult();
    try {
      const response = await fetch(apiUrl("/api/v2/trials"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(context),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "trial_unavailable");
      const url = validSubscriptionUrl(data?.subscriptionUrl);
      if (!url || !validConversionId(data?.conversionId)) throw new Error("trial_unavailable");
      conversionId = data.conversionId;
      showSubscriptionResult({
        title: "Бесплатный календарь готов",
        text: "Первая учебная неделя добавляется отдельной персональной ссылкой. Банковская карта не нужна.",
        subscriptionUrl: url,
        groupCode: data.groupCode || context.groupCode,
        allowPaid: true,
      });
    } catch (error) {
      if (resultPanel) {
        resultPanel.hidden = false;
        resultPanel.textContent = error.message === "university_commercial_not_open"
          ? "Коммерческий запуск ИжГМУ ещё не открыт сервером."
          : "Не удалось создать пробный календарь. Подключение не выполнено.";
      }
    } finally {
      trialButton.textContent = original;
      trialButton.disabled = !trialOpen();
    }
  }

  trialButton?.addEventListener("click", () => { void createTrial(); });

  paymentForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const context = selectedGroupContext();
    const plan = planSelect?.value || "";
    if (!context || !salesOpen() || !payButton || !emailInput?.validity.valid || !plan) {
      if (runtimeStatus) runtimeStatus.textContent = salesOpen() ? "Проверьте email и тариф." : "Оплата для ИжГМУ пока закрыта сервером.";
      return;
    }

    payButton.disabled = true;
    const original = payButton.textContent;
    payButton.textContent = "Создаём оплату…";
    try {
      const response = await fetch(apiUrl(config.paymentPath || "/api/v2/payments"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...context,
          email: emailInput.value.trim(),
          plan,
          ...(conversionId ? { conversionId } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "payment_unavailable");
      if (!validOrderId(data?.orderId) || !validAccessToken(data?.accessToken)) throw new Error("payment_unavailable");
      const confirmation = new URL(String(data?.confirmationUrl || ""));
      if (confirmation.protocol !== "https:") throw new Error("payment_unavailable");
      sessionStorage.setItem("izhgmu-order-v1", JSON.stringify({ orderId: data.orderId, accessToken: data.accessToken }));
      window.location.assign(confirmation.toString());
    } catch (error) {
      if (runtimeStatus) runtimeStatus.textContent = error.message === "university_commercial_not_open"
        ? "Коммерческий запуск ИжГМУ ещё не открыт сервером."
        : "Не удалось открыть оплату. Покупка не создана.";
      payButton.disabled = false;
      payButton.textContent = original;
    }
  });

  function paymentReturnContext() {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    let orderId = hash.get("order") || "";
    let accessToken = hash.get("access") || "";
    if (!validOrderId(orderId) || !validAccessToken(accessToken)) {
      try {
        const saved = JSON.parse(sessionStorage.getItem("izhgmu-order-v1") || "null");
        orderId = saved?.orderId || "";
        accessToken = saved?.accessToken || "";
      } catch {
        orderId = "";
        accessToken = "";
      }
    }
    return validOrderId(orderId) && validAccessToken(accessToken) ? { orderId, accessToken } : null;
  }

  async function renderOrderResult(orderId, accessToken) {
    if (!resultPanel) return;
    resultPanel.hidden = false;
    resultPanel.className = "subscription-result result-card";
    resultPanel.textContent = "Проверяем статус оплаты…";
    for (let attempt = 0; attempt < 15; attempt += 1) {
      try {
        const response = await fetch(apiUrl(`/api/v1/orders/${encodeURIComponent(orderId)}`), {
          cache: "no-store",
          headers: { "X-Order-Token": accessToken },
        });
        const order = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(order?.error || "order_unavailable");
        if (order.status === "succeeded") {
          const url = validSubscriptionUrl(order.subscriptionUrl);
          if (!url) throw new Error("subscription_unavailable");
          sessionStorage.removeItem("izhgmu-order-v1");
          showSubscriptionResult({
            title: order.testMode ? "Тестовая оплата подтверждена" : "Календарь оплачен",
            text: "Персональная ссылка готова. Она будет получать обновления опубликованного расписания по той же подписке.",
            subscriptionUrl: url,
            groupCode: order.groupCode || order.group,
          });
          return;
        }
        if (order.status === "canceled") {
          sessionStorage.removeItem("izhgmu-order-v1");
          resultPanel.textContent = "Платёж отменён. Доступ не выдан.";
          return;
        }
      } catch {
        // Retry transient status/read errors; no second payment is created here.
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    resultPanel.textContent = "Платёж ещё обрабатывается. Повторно оплачивать не нужно; обновите страницу позже.";
  }

  async function restoreContinueContext(value) {
    if (!validConversionId(value)) return false;
    try {
      const response = await fetch(apiUrl(`/api/v2/trials/continue/${encodeURIComponent(value)}`), { cache: "no-store" });
      const context = await response.json().catch(() => ({}));
      const course = Number(context?.course);
      if (!response.ok || context?.university !== university || context?.program !== program || !approvedCourses.has(course)) return false;
      if (courseSelect.disabled || ![...courseSelect.options].some((option) => Number(option.value) === course)) return false;
      courseSelect.value = String(course);
      await loadGroups(course);
      const match = [...groupById.values()].find((group) => group.groupId === context.groupId && group.groupCode === context.groupCode);
      if (!match) return false;
      groupSelect.value = match.groupId;
      conversionId = value;
      selectionStatus.hidden = false;
      selectionStatus.textContent = `Продолжаем календарь группы ${match.groupCode}. Группа повторно подтверждена текущим серверным каталогом.`;
      updateRuntimeActions();
      return true;
    } catch {
      return false;
    }
  }

  async function init() {
    resetSelect(courseSelect, "Проверяем каталог…");
    resetSelect(groupSelect, "Группы появятся после проверки расписания 2026/27");
    updateRuntimeActions();

    const order = paymentReturnContext();
    if (window.location.hash.includes("order=") && order) {
      await loadRuntimeMeta();
      await renderOrderResult(order.orderId, order.accessToken);
      return;
    }

    await Promise.all([loadRuntimeMeta(), loadCatalog()]);
    const continueId = new URLSearchParams(window.location.search).get("continue") || "";
    if (validConversionId(continueId)) {
      const restored = await restoreContinueContext(continueId);
      if (!restored && runtimeStatus) runtimeStatus.textContent = "Не удалось безопасно восстановить группу из пробной ссылки. Подключение не открыто.";
    }
  }

  void init();
})();