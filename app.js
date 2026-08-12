const data = window.CALENDAR_DATA;
const grid = document.querySelector("#choice-grid");
const title = document.querySelector("#selector-title");
const kicker = document.querySelector("#step-kicker");
const backButton = document.querySelector("#back-button");
const notice = document.querySelector("#notice");
const savedOrders = document.querySelector("#saved-orders");
const savedOrdersList = document.querySelector("#saved-orders-list");
const { validOrderId, validAccessToken, orderPageUrl, findPurchasedOrder } = window.CALENDAR_APP_UTILS;
const state = { step: "faculty", faculty: null, course: null, group: null, plan: "year" };
const stepOrder = ["faculty", "course", "group", "checkout"];
const savedOrderKey = "kgmu-calendar-orders-v2";
const legacySavedOrderKey = "kgmu-calendar-orders-v1";
const groupCatalog = new Map();
let scrollToReadyLink = false;

function readSavedOrders() {
  try {
    const values = JSON.parse(localStorage.getItem(savedOrderKey) || "[]");
    const current = Array.isArray(values)
      ? values.filter((value) => validOrderId(value?.orderId) && (!value.accessToken || validAccessToken(value.accessToken)))
      : [];
    const legacy = JSON.parse(localStorage.getItem(legacySavedOrderKey) || "[]");
    const migrated = Array.isArray(legacy)
      ? legacy.filter(validOrderId).map((orderId) => ({ orderId, accessToken: "" }))
      : [];
    return [...current, ...migrated.filter((old) => !current.some((item) => item.orderId === old.orderId))].slice(0, 10);
  } catch {
    return [];
  }
}

function saveOrder(orderId, accessToken = "") {
  if (!validOrderId(orderId)) return;
  if (accessToken && !validAccessToken(accessToken)) return;
  const existing = readSavedOrders().find((value) => value.orderId === orderId);
  const entry = { orderId, accessToken: accessToken || existing?.accessToken || "" };
  const values = [entry, ...readSavedOrders().filter((value) => value.orderId !== orderId)].slice(0, 10);
  try { localStorage.setItem(savedOrderKey, JSON.stringify(values)); } catch { /* storage can be unavailable */ }
}

function orderHeaders(accessToken) {
  return accessToken ? { "X-Order-Token": accessToken } : {};
}

function selectedPlan() {
  return data.offer.plans[state.plan] || data.offer.plans.year || data.offer.plans.semester;
}

function planLabel(planId) {
  return data.offer.plans[planId]?.label || (planId === "year" ? "Учебный год" : "Семестр");
}

function apiGroupContext() {
  const groupCode = String(state.group);
  return {
    university: data.university || "kgmu",
    program: state.faculty.id,
    course: state.course,
    groupCode,
    groupId: `${data.university || "kgmu"}:${state.faculty.id}:${state.course}:${groupCode}`,
  };
}

function normalizeAcademicYear(value) {
  const match = String(value || "").trim().match(/^(\d{4})[/-](\d{2}|\d{4})$/);
  if (!match) return "";
  const start = Number(match[1]);
  const rawEnd = Number(match[2]);
  const end = match[2].length === 2 ? Math.floor(start / 100) * 100 + rawEnd : rawEnd;
  if (end !== start + 1) return "";
  return `${start}/${String(end).slice(-2)}`;
}

function catalogKey(faculty, course) {
  return `${faculty.id}:${course}`;
}

function catalogEntry(faculty, course) {
  const key = catalogKey(faculty, course);
  if (!groupCatalog.has(key)) {
    groupCatalog.set(key, { status: "idle", groups: [], promise: null });
  }
  return groupCatalog.get(key);
}

async function ensureOfferGroups(faculty, course) {
  const entry = catalogEntry(faculty, course);
  if (entry.status === "loaded") return entry.groups;
  if (entry.status === "loading" && entry.promise) return entry.promise;

  entry.status = "loading";
  entry.promise = (async () => {
    const university = encodeURIComponent(data.university || "kgmu");
    const program = encodeURIComponent(faculty.id);
    const response = await fetch(`${data.apiBase}/api/v2/catalog/${university}/${program}/${course}/groups`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error("catalog_unavailable");
    const body = await response.json();
    const sameYear = normalizeAcademicYear(body.academicYear) === normalizeAcademicYear(data.offer.academicYear);
    const sameSemester = Number(body.semester) === Number(data.offer.semester);
    if (!sameYear || !sameSemester || !Array.isArray(body.groups)) throw new Error("catalog_period_mismatch");

    entry.groups = [...new Set(body.groups
      .map((item) => typeof item?.groupCode === "string" ? item.groupCode.trim() : "")
      .filter(Boolean))];
    faculty.groups[course] = entry.groups;
    entry.status = "loaded";
    return entry.groups;
  })().catch((error) => {
    entry.groups = [];
    entry.status = "error";
    throw error;
  }).finally(() => {
    entry.promise = null;
  });

  return entry.promise;
}

async function selectCourse(faculty, course) {
  state.course = course;
  state.group = null;
  const loading = ensureOfferGroups(faculty, course);
  setStep("group");
  try {
    await loading;
  } catch {
    // renderGroups shows a fail-closed retry state.
  }
  if (state.step === "group" && state.faculty === faculty && state.course === course) render();
}

async function renderSavedOrders() {
  const saved = readSavedOrders();
  if (!saved.length) return;
  const orders = await Promise.all(saved.map(async ({ orderId, accessToken }) => {
    try {
      const response = await fetch(`${data.apiBase}/api/v1/orders/${orderId}`, {
        cache: "no-store",
        headers: orderHeaders(accessToken),
      });
      if (!response.ok) return null;
      const order = await response.json();
      return order.status === "succeeded" ? { id: orderId, accessToken, group: order.group, plan: order.plan || "semester" } : null;
    } catch {
      return null;
    }
  }));
  const completed = orders.filter(Boolean);
  if (!completed.length) return;
  savedOrdersList.replaceChildren(...completed.map((order) => {
    const link = document.createElement("a");
    link.className = "saved-order-link";
    link.href = orderPageUrl(order.id, order.accessToken);
    link.textContent = `Группа ${order.group} · ${planLabel(order.plan)}`;
    link.addEventListener("click", () => { scrollToReadyLink = true; });
    return link;
  }));
  savedOrders.hidden = false;
}

function makeCard({ icon, title: cardTitle, subtitle, className = "", onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `choice-card ${className}`.trim();
  button.innerHTML = `<span class="card-icon" aria-hidden="true">${icon}</span><strong>${cardTitle}</strong><small>${subtitle}</small>`;
  button.addEventListener("click", onClick);
  return button;
}

function setStep(step) {
  state.step = step;
  const activeIndex = stepOrder.indexOf(step);
  document.querySelectorAll("[data-step-indicator]").forEach((element, index) => {
    element.classList.toggle("is-active", index === activeIndex);
    element.classList.toggle("is-complete", index < activeIndex);
  });
  kicker.textContent = `Шаг ${activeIndex + 1} из ${stepOrder.length}`;
  backButton.hidden = step === "faculty";
  notice.hidden = true;
  render();
}

function renderFaculties() {
  title.textContent = "Выберите факультет";
  data.faculties.forEach((faculty) => grid.append(makeCard({
    icon: faculty.icon,
    title: faculty.name,
    subtitle: `${faculty.short} · ${faculty.courses} курсов`,
    onClick: () => { state.faculty = faculty; state.course = null; state.group = null; setStep("course"); },
  })));
}

function renderCourses() {
  title.textContent = state.faculty.name;
  for (let course = 1; course <= state.faculty.courses; course += 1) {
    const entry = catalogEntry(state.faculty, course);
    const subtitle = entry.status === "loaded"
      ? (entry.groups.length ? `${entry.groups.length} групп доступно` : "Расписание ещё не опубликовано")
      : entry.status === "error"
        ? "Проверить ещё раз"
        : "Проверить доступность";
    grid.append(makeCard({
      icon: course,
      title: `${course} курс`,
      subtitle,
      onClick: () => { void selectCourse(state.faculty, course); },
    }));
  }
}

function renderGroups() {
  title.textContent = `${state.faculty.short} · ${state.course} курс`;
  const entry = catalogEntry(state.faculty, state.course);
  if (entry.status === "loading" || entry.status === "idle") {
    notice.hidden = false;
    notice.textContent = `Проверяем опубликованные группы ${data.offer.academicYear}…`;
    return;
  }
  if (entry.status === "error") {
    notice.hidden = false;
    notice.textContent = "Не удалось проверить опубликованные группы. Вернитесь к выбору курса и попробуйте ещё раз.";
    return;
  }
  if (!entry.groups.length) {
    notice.hidden = false;
    notice.textContent = `Для этого курса проверенное расписание ${data.offer.academicYear} пока не опубликовано.`;
    return;
  }
  entry.groups.forEach((group) => {
    grid.append(makeCard({
      icon: "№",
      title: `Группа ${group}`,
      subtitle: "Доступ на семестр или учебный год",
      className: "group-card",
      onClick: () => { state.group = group; state.plan = "year"; setStep("checkout"); },
    }));
  });
}

async function loadSavedOrder(orderId, accessToken) {
  const response = await fetch(`${data.apiBase}/api/v1/orders/${orderId}`, {
    cache: "no-store",
    headers: orderHeaders(accessToken),
  });
  if (!response.ok) throw new Error("order_unavailable");
  return response.json();
}

function renderPurchasedGroup(wrapper, purchased) {
  const orderPlan = purchased.order?.plan || "semester";
  title.textContent = `Группа ${state.group} уже куплена`;
  wrapper.className = "checkout-card result-card";
  wrapper.innerHTML = `
    <div class="success-mark">✓</div>
    <h3>Доступ уже активен</h3>
    <p>Для группы ${state.group} уже оплачен тариф «${planLabel(orderPlan)}». Повторно оплачивать не нужно.</p>
    <a class="pay-button link-button" href="${orderPageUrl(purchased.orderId, purchased.accessToken)}">Открыть календарь</a>`;
  wrapper.querySelector("a").addEventListener("click", () => { scrollToReadyLink = true; });
}

function planButton(plan) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "plan-option";
  button.dataset.plan = plan.id;
  button.setAttribute("aria-pressed", String(state.plan === plan.id));
  button.innerHTML = `
    <span class="plan-option-head">
      <strong>${plan.label}</strong>
      ${plan.badge ? `<span class="plan-badge">${plan.badge}</span>` : ""}
    </span>
    <span class="plan-price">${plan.price}</span>
    <small>${plan.description}</small>`;
  button.addEventListener("click", () => {
    state.plan = plan.id;
    updatePlanSelection(button.closest(".checkout-card"));
  });
  return button;
}

function updatePlanSelection(wrapper) {
  const plan = selectedPlan();
  wrapper.querySelectorAll(".plan-option").forEach((button) => {
    const active = button.dataset.plan === state.plan;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
  wrapper.querySelector("[data-summary-plan]").textContent = plan.label;
  wrapper.querySelector("[data-summary-price]").textContent = plan.price;
  wrapper.querySelector("[data-summary-expiry]").textContent = `Доступ до ${plan.expires}`;
  const payButton = wrapper.querySelector(".pay-button");
  if (payButton && !payButton.disabled) {
    payButton.textContent = `${data.offer.testMode ? "Провести тестовую оплату" : "Перейти к оплате"} · ${plan.price}`;
  }
}

function renderCheckout() {
  title.textContent = `Группа ${state.group}`;
  const wrapper = document.createElement("div");
  wrapper.className = "checkout-card";
  const testNote = data.offer.testMode ? `
    <div class="test-payment-note">
      <strong>Тестовая оплата — деньги не спишутся</strong>
      <span>Карта 5555 5555 5555 4477 · срок 01/30 · CVC 123 · код 3-D Secure 123</span>
    </div>` : "";
  const plans = Object.values(data.offer.plans);
  wrapper.innerHTML = `
    <div class="order-summary">
      <span>${state.faculty.short} · ${state.course} курс · группа ${state.group}</span>
      <span class="summary-plan" data-summary-plan></span>
      <strong data-summary-price></strong>
      <small>${data.offer.academicYear} учебный год</small>
      <small class="summary-note" data-summary-expiry></small>
    </div>
    <form id="checkout-form">
      <div class="plan-section">
        <span class="plan-section-label">Выберите тариф</span>
        <div class="plan-options" role="group" aria-label="Тариф"></div>
      </div>
      <label for="customer-email">Email покупателя</label>
      <input id="customer-email" name="email" type="email" autocomplete="email" inputmode="email" required placeholder="student@example.com" />
      ${testNote}
      <button class="pay-button" type="submit"></button>
      <p class="form-hint">После оплаты персональная ссылка на календарь появится на этой странице.</p>
    </form>`;
  const options = wrapper.querySelector(".plan-options");
  options.replaceChildren(...plans.map(planButton));
  wrapper.querySelector("form").addEventListener("submit", startPayment);
  grid.append(wrapper);
  updatePlanSelection(wrapper);
}

async function startPayment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const wrapper = form.closest(".checkout-card");
  const button = form.querySelector(".pay-button");
  const plan = selectedPlan();
  button.disabled = true;
  button.textContent = "Проверяем покупку…";
  notice.hidden = true;
  try {
    const purchased = await findPurchasedOrder(String(state.group), readSavedOrders(), loadSavedOrder, state.plan);
    if (purchased) {
      renderPurchasedGroup(wrapper, purchased);
      return;
    }

    button.textContent = "Создаём платёж…";
    const response = await fetch(`${data.apiBase}/api/v2/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...apiGroupContext(),
        email: new FormData(form).get("email"),
        plan: state.plan,
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.confirmationUrl) throw new Error(result.error || "payment_unavailable");
    saveOrder(result.orderId, result.accessToken);
    window.location.assign(result.confirmationUrl);
  } catch {
    notice.hidden = false;
    notice.textContent = "Не удалось открыть оплату. Проверьте интернет и попробуйте ещё раз.";
    button.disabled = false;
    button.textContent = `${data.offer.testMode ? "Провести тестовую оплату" : "Перейти к оплате"} · ${plan.price}`;
  }
}

async function renderOrderResult(orderId, accessToken = "") {
  document.querySelector(".steps").hidden = true;
  backButton.hidden = true;
  kicker.textContent = "Результат оплаты";
  title.textContent = "Проверяем платёж";
  grid.replaceChildren();
  const card = document.createElement("div");
  card.className = "checkout-card result-card";
  card.innerHTML = "<div class=\"loading-dot\"></div><p>Обычно это занимает несколько секунд.</p>";
  grid.append(card);

  let resultShown = false;
  const showIncompletePayment = () => {
    if (resultShown) return;
    resultShown = true;
    scrollToReadyLink = false;
    title.textContent = "Платёж не завершён";
    card.innerHTML = "<p>Доступ не выдан. Если вы отменили оплату, вернитесь к выбору. Если уже оплатили, обновите страницу через минуту — повторно оплачивать не нужно.</p><a class=\"copy-button link-button\" href=\"./\">Вернуться к выбору</a>";
  };
  const fallbackTimer = window.setTimeout(showIncompletePayment, 20000);

  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const response = await fetch(`${data.apiBase}/api/v1/orders/${orderId}`, {
        cache: "no-store",
        headers: orderHeaders(accessToken),
      });
      const order = await response.json();
      if (resultShown) return;
      if (!response.ok) throw new Error(order.error);
      if (order.status === "succeeded" && order.subscriptionUrl) {
        resultShown = true;
        window.clearTimeout(fallbackTimer);
        saveOrder(orderId, accessToken);
        title.textContent = order.testMode ? "Тестовая оплата прошла" : "Календарь оплачен";
        const webcalUrl = order.subscriptionUrl.replace(/^https:/, "webcal:");
        const period = order.plan === "year" ? "Учебный год" : "Семестр";
        card.innerHTML = `
          <div class="success-mark">✓</div>
          <h3>Группа ${order.group}</h3>
          <p>${period} оплачен. Персональная ссылка готова — не пересылайте её другим людям.</p>
          <a class="pay-button link-button" href="${webcalUrl}">Подключить на iPhone</a>
          <button class="copy-button" type="button">Скопировать ссылку</button>
          <small>Для Google Календаря добавьте скопированную ссылку через «Другие календари → Добавить по URL».</small>`;
        card.querySelector(".copy-button").addEventListener("click", async (event) => {
          await navigator.clipboard.writeText(order.subscriptionUrl);
          event.currentTarget.textContent = "Ссылка скопирована";
        });
        if (scrollToReadyLink) {
          scrollToReadyLink = false;
          card.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "start",
          });
        }
        return;
      }
      if (order.status === "canceled") {
        resultShown = true;
        window.clearTimeout(fallbackTimer);
        scrollToReadyLink = false;
        title.textContent = "Платёж отменён";
        card.innerHTML = "<p>Деньги не списаны. Вернитесь на главную страницу и попробуйте снова.</p><a class=\"copy-button link-button\" href=\"./\">Вернуться к выбору</a>";
        return;
      }
    } catch {
      // Transient API failures use the same safe fallback after all attempts.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  window.clearTimeout(fallbackTimer);
  showIncompletePayment();
}

function render() {
  grid.replaceChildren();
  if (state.step === "faculty") renderFaculties();
  if (state.step === "course") renderCourses();
  if (state.step === "group") renderGroups();
  if (state.step === "checkout") renderCheckout();
}

backButton.addEventListener("click", () => {
  if (state.step === "checkout") setStep("group");
  else if (state.step === "group") setStep("course");
  else setStep("faculty");
});

function renderCurrentPage() {
  const pageParams = new URLSearchParams(window.location.hash.slice(1) || window.location.search);
  const orderId = pageParams.get("order");
  const accessToken = pageParams.get("access") || "";
  if (validOrderId(orderId)) {
    saveOrder(orderId, accessToken);
    renderOrderResult(orderId, accessToken);
    return;
  }

  document.querySelector(".steps").hidden = false;
  setStep(state.step);
  renderSavedOrders();
}

window.addEventListener("hashchange", renderCurrentPage);
renderCurrentPage();