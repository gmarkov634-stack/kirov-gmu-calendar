const data = window.CALENDAR_DATA;
const grid = document.querySelector("#choice-grid");
const title = document.querySelector("#selector-title");
const kicker = document.querySelector("#step-kicker");
const backButton = document.querySelector("#back-button");
const notice = document.querySelector("#notice");
const savedOrders = document.querySelector("#saved-orders");
const savedOrdersList = document.querySelector("#saved-orders-list");
const heroPrimaryCta = document.querySelector("#hero-primary-cta");
const heroRuntimeNote = document.querySelector("#hero-runtime-note");
const howStep2Title = document.querySelector("#how-step2-title");
const howStep2Copy = document.querySelector("#how-step2-copy");
const howStep3Title = document.querySelector("#how-step3-title");
const howStep3Copy = document.querySelector("#how-step3-copy");
const { validOrderId, validAccessToken, orderPageUrl, findPurchasedOrder } = window.CALENDAR_APP_UTILS;

const state = {
  step: "faculty",
  faculty: null,
  course: null,
  group: null,
  groupRecord: null,
  plan: "year",
  preview: null,
  previewStatus: "idle",
  trial: null,
  conversionId: "",
};
const selectionSteps = ["faculty", "course", "group"];
const savedOrderKey = "kgmu-calendar-orders-v2";
const legacySavedOrderKey = "kgmu-calendar-orders-v1";
const trialSessionKey = "kgmu-calendar-trial-v1";
const groupCatalog = new Map();
const runtimeMeta = {
  status: "idle",
  sales: "closed",
  trials: "closed",
  paymentMode: data.offer.testMode ? "test" : "live",
};
let scrollToReadyLink = false;
let orderResultActive = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

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

function saveTrialSession(result) {
  try {
    sessionStorage.setItem(trialSessionKey, JSON.stringify({
      facultyId: state.faculty?.id || "",
      course: state.course,
      groupCode: state.group,
      groupId: state.groupRecord?.groupId || apiGroupContext().groupId,
      displayName: state.groupRecord?.displayName || `Группа ${state.group}`,
      result,
    }));
  } catch { /* session storage can be unavailable */ }
}

function readTrialSession() {
  try {
    const value = JSON.parse(sessionStorage.getItem(trialSessionKey) || "null");
    if (!value || typeof value !== "object") return null;
    if (!/^[A-Za-z0-9_-]{43}$/.test(String(value?.result?.conversionId || ""))) return null;
    if (!/^https:\/\//.test(String(value?.result?.subscriptionUrl || ""))) return null;
    return value;
  } catch {
    return null;
  }
}

function clearTrialSession() {
  try { sessionStorage.removeItem(trialSessionKey); } catch { /* ignore */ }
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
  const groupCode = String(state.group || "");
  return {
    university: data.university || "kgmu",
    program: state.faculty?.id,
    course: state.course,
    groupCode,
    groupId: state.groupRecord?.groupId || `${data.university || "kgmu"}:${state.faculty?.id}:${state.course}:${groupCode}`,
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

    entry.groups = body.groups
      .map((item) => {
        const groupCode = typeof item?.groupCode === "string" ? item.groupCode.trim() : "";
        if (!groupCode) return null;
        return {
          groupCode,
          groupId: typeof item?.groupId === "string" && item.groupId ? item.groupId : `${data.university || "kgmu"}:${faculty.id}:${course}:${groupCode}`,
          displayName: typeof item?.displayName === "string" && item.displayName ? item.displayName : `Группа ${groupCode}`,
        };
      })
      .filter(Boolean)
      .filter((item, index, values) => values.findIndex((candidate) => candidate.groupCode === item.groupCode) === index);
    faculty.groups[course] = entry.groups.map((item) => item.groupCode);
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
  state.groupRecord = null;
  state.preview = null;
  state.previewStatus = "idle";
  state.trial = null;
  state.conversionId = "";
  const loading = ensureOfferGroups(faculty, course);
  setStep("group");
  try {
    await loading;
  } catch {
    // renderGroups shows a fail-closed retry state.
  }
  if (state.step === "group" && state.faculty === faculty && state.course === course) render();
}

function selectGroup(group) {
  state.group = group.groupCode;
  state.groupRecord = group;
  state.plan = "year";
  state.preview = null;
  state.previewStatus = "idle";
  state.trial = null;
  state.conversionId = "";
  clearTrialSession();
  setStep("preview");
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
  if (step === "preview") return "Ваша группа";
  if (step === "trial") return "Бесплатная неделя";
  if (step === "checkout") return state.conversionId ? "Продолжить календарь" : "Полный доступ";
  return "Календарь";
}

function setStep(step) {
  state.step = step;
  updateStepIndicators(step);
  kicker.textContent = stepKicker(step);
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
    onClick: () => {
      state.faculty = faculty;
      state.course = null;
      state.group = null;
      state.groupRecord = null;
      state.conversionId = "";
      setStep("course");
    },
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
      title: group.displayName || `Группа ${group.groupCode}`,
      subtitle: "Посмотреть реальные занятия этой группы",
      className: "group-card",
      onClick: () => selectGroup(group),
    }));
  });
}

function formatDate(value, options = { day: "numeric", month: "short" }) {
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "UTC" }).format(date);
}

function previewEventElement(event) {
  const row = document.createElement("article");
  row.className = "preview-event-row";
  const time = document.createElement("div");
  time.className = "preview-event-time";
  const date = formatDate(event.date, { weekday: "short", day: "numeric", month: "short" });
  const clock = event.allDay ? "Весь день" : [event.startTime, event.endTime].filter(Boolean).join("–");
  time.textContent = `${date}\n${clock}`;
  time.style.whiteSpace = "pre-line";

  const main = document.createElement("div");
  main.className = "preview-event-main";
  const name = document.createElement("strong");
  name.textContent = event.title || "Занятие";
  const meta = document.createElement("div");
  meta.className = "preview-event-meta";
  [event.type, event.location, event.sequence].filter(Boolean).forEach((value) => {
    const chip = document.createElement("span");
    chip.className = "preview-chip";
    chip.textContent = value;
    meta.append(chip);
  });
  main.append(name, meta);
  row.append(time, main);
  return row;
}

async function loadGroupPreview() {
  if (!state.faculty || !state.course || !state.group) return;
  state.previewStatus = "loading";
  const context = apiGroupContext();
  const university = encodeURIComponent(context.university);
  const program = encodeURIComponent(context.program);
  const group = encodeURIComponent(context.groupCode);
  try {
    const response = await fetch(`${data.apiBase}/api/v2/catalog/${university}/${program}/${context.course}/${group}/preview`, {
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.events)) throw new Error(body.error || "preview_unavailable");
    state.preview = body;
    state.previewStatus = "loaded";
  } catch {
    state.preview = null;
    state.previewStatus = "error";
  }
  if (state.step === "preview") render();
}

function actionButton(text, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", onClick);
  return button;
}

function renderGroupPreview() {
  title.textContent = `Группа ${state.group}`;
  const wrapper = document.createElement("section");
  wrapper.className = "group-preview";
  wrapper.innerHTML = `
    <div class="group-preview-head">
      <div><p class="section-kicker">${escapeHtml(state.faculty.short)} · ${escapeHtml(state.course)} курс</p><h3>${escapeHtml(state.groupRecord?.displayName || `Группа ${state.group}`)}</h3></div>
      <span class="verified-badge">Расписание опубликовано и проверено</span>
    </div>`;

  const events = document.createElement("div");
  events.className = "preview-events";
  wrapper.append(events);

  if (state.previewStatus === "idle") {
    const loading = document.createElement("div");
    loading.className = "preview-empty";
    loading.textContent = "Загружаем несколько реальных занятий вашей группы…";
    events.append(loading);
    state.previewStatus = "loading";
    void loadGroupPreview();
  } else if (state.previewStatus === "loading") {
    const loading = document.createElement("div");
    loading.className = "preview-empty";
    loading.textContent = "Загружаем несколько реальных занятий вашей группы…";
    events.append(loading);
  } else if (state.previewStatus === "error") {
    const error = document.createElement("div");
    error.className = "preview-empty";
    error.textContent = "Не удалось загрузить пример занятий. Полный доступ и trial не создаём, пока не подтвердим опубликованное расписание.";
    events.append(error);
    const retry = actionButton("Попробовать ещё раз", "secondary-action", () => {
      state.previewStatus = "idle";
      render();
    });
    retry.style.marginTop = "12px";
    events.append(retry);
  } else if (!state.preview?.events?.length) {
    const empty = document.createElement("div");
    empty.className = "preview-empty";
    empty.textContent = "В опубликованном расписании пока нет занятий, которые можно показать в превью.";
    events.append(empty);
  } else {
    state.preview.events.forEach((event) => events.append(previewEventElement(event)));
  }

  if (state.previewStatus === "loaded" && state.preview?.events?.length) {
    const offer = document.createElement("div");
    offer.className = "preview-offer";
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = runtimeMeta.trials === "open" ? "Попробуйте этот календарь на своей первой учебной неделе" : "Это реальные занятия выбранной группы";
    const p = document.createElement("p");
    p.textContent = runtimeMeta.trials === "open"
      ? "Без карты и автосписаний. Trial показывает фиксированную первую учебную неделю этой группы."
      : "Бесплатная проба появится здесь только после отдельного включения backend. Сейчас можно лишь перейти к полному доступу, если продажи открыты.";
    copy.append(strong, p);

    const actions = document.createElement("div");
    actions.className = "preview-actions";
    if (runtimeMeta.status !== "loaded") {
      const waiting = document.createElement("div");
      waiting.className = "runtime-closed";
      waiting.textContent = "Проверяем доступность бесплатной пробы и оплаты…";
      actions.append(waiting);
    } else {
      if (runtimeMeta.trials === "open") {
        actions.append(actionButton("Попробовать бесплатно", "pay-button", (event) => { void startTrial(event.currentTarget); }));
      }
      if (runtimeMeta.sales === "open") {
        actions.append(actionButton("Купить полный доступ", runtimeMeta.trials === "open" ? "secondary-action" : "pay-button", () => {
          state.conversionId = "";
          state.plan = "year";
          setStep("checkout");
        }));
      }
    }
    offer.append(copy, actions);
    wrapper.append(offer);

    if (runtimeMeta.status === "loaded" && runtimeMeta.trials !== "open" && runtimeMeta.sales !== "open") {
      const closed = document.createElement("div");
      closed.className = "runtime-closed";
      closed.textContent = "Подключение пока закрыто. Эта группа станет доступна для trial или покупки только после явного открытия соответствующего режима сервера.";
      wrapper.append(closed);
    }
  }
  grid.append(wrapper);
}

async function startTrial(button) {
  if (runtimeMeta.trials !== "open") return;
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "Создаём календарь…";
  notice.hidden = true;
  try {
    const response = await fetch(`${data.apiBase}/api/v2/trials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...apiGroupContext(), ...attributionContext() }),
    });
    const result = await response.json();
    if (!response.ok || !result.subscriptionUrl || !/^[A-Za-z0-9_-]{43}$/.test(String(result.conversionId || ""))) {
      throw new Error(result.error || "trial_unavailable");
    }
    state.trial = result;
    state.conversionId = result.conversionId;
    saveTrialSession(result);
    setStep("trial");
  } catch (error) {
    notice.hidden = false;
    notice.textContent = error.message === "trial_window_closed"
      ? "Первая учебная неделя этой группы уже закончилась, поэтому новый trial больше не создаётся."
      : "Не удалось создать бесплатный календарь. Проверьте интернет и попробуйте ещё раз.";
    button.disabled = false;
    button.textContent = original;
  }
}

function renderTrialConnect() {
  const trial = state.trial;
  if (!trial?.subscriptionUrl) {
    setStep("preview");
    return;
  }
  title.textContent = `Календарь группы ${state.group} готов`;
  const wrapper = document.createElement("section");
  wrapper.className = "trial-connect-card";
  const startLabel = formatDate(trial.trialStartDate, { day: "numeric", month: "long" });
  const endDate = new Date(`${trial.trialEndDateExclusive}T12:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const endLabel = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "UTC" }).format(endDate);
  wrapper.innerHTML = `
    <div class="trial-mark">К</div>
    <h3>Подключите календарь один раз</h3>
    <p>Пары первой учебной недели группы ${escapeHtml(state.group)} появятся в обычном календаре телефона. Банковская карта не нужна.</p>
    <span class="trial-window">${escapeHtml(startLabel)} — ${escapeHtml(endLabel)}</span>`;

  const actions = document.createElement("div");
  actions.className = "connect-actions";
  const iphone = document.createElement("a");
  iphone.className = "pay-button link-button";
  iphone.href = trial.subscriptionUrl.replace(/^https:/, "webcal:");
  iphone.textContent = "Подключить на iPhone";
  const google = actionButton("Скопировать для Google Calendar", "copy-button", async (event) => {
    await navigator.clipboard.writeText(trial.subscriptionUrl);
    event.currentTarget.textContent = "Ссылка скопирована";
  });
  actions.append(iphone, google);
  wrapper.append(actions);

  const hint = document.createElement("p");
  hint.textContent = "Для Google Calendar: скопируйте ссылку, затем откройте «Другие календари → Добавить по URL». Не пересылайте персональную ссылку как обычное сообщение.";
  wrapper.append(hint);

  const next = document.createElement("div");
  next.className = "trial-next";
  if (runtimeMeta.sales === "open") {
    next.append(actionButton("Оставить календарь на весь учебный период", "secondary-action", () => {
      state.plan = "year";
      setStep("checkout");
    }));
    const copy = document.createElement("p");
    copy.textContent = "Оплата создаст новую персональную paid-ссылку на весь выбранный период. Бесплатная ссылка не получит платных прав.";
    next.append(copy);
  } else {
    const closed = document.createElement("div");
    closed.className = "runtime-closed";
    closed.textContent = "Коммерческая оплата сейчас закрыта. Бесплатный календарь продолжит работать в пределах своей фиксированной первой недели.";
    next.append(closed);
  }
  wrapper.append(next);
  grid.append(wrapper);
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
    <p>Для группы ${escapeHtml(state.group)} уже оплачен тариф «${escapeHtml(planLabel(orderPlan))}». Повторно оплачивать не нужно.</p>
    <a class="pay-button link-button" href="${escapeHtml(orderPageUrl(purchased.orderId, purchased.accessToken))}">Открыть календарь</a>`;
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
      <strong>${escapeHtml(plan.label)}</strong>
      ${plan.badge ? `<span class="plan-badge">${escapeHtml(plan.badge)}</span>` : ""}
    </span>
    <span class="plan-price">${escapeHtml(plan.price)}</span>
    <small>${escapeHtml(plan.description)}</small>`;
  button.addEventListener("click", () => {
    state.plan = plan.id;
    updatePlanSelection(button.closest(".checkout-card"));
  });
  return button;
}

function isTestPayment() {
  return runtimeMeta.paymentMode === "test";
}

function updatePlanSelection(wrapper) {
  const plan = selectedPlan();
  wrapper.querySelectorAll(".plan-option").forEach((button) => {
    const active = button.dataset.plan === state.plan;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const summaryPlan = wrapper.querySelector("[data-summary-plan]");
  const summaryPrice = wrapper.querySelector("[data-summary-price]");
  const summaryExpiry = wrapper.querySelector("[data-summary-expiry]");
  if (summaryPlan) summaryPlan.textContent = plan.label;
  if (summaryPrice) summaryPrice.textContent = plan.price;
  if (summaryExpiry) summaryExpiry.textContent = `Доступ до ${plan.expires}`;
  const payButton = wrapper.querySelector(".pay-button[type=submit]");
  if (payButton && !payButton.disabled) {
    payButton.textContent = `${isTestPayment() ? "Провести тестовую оплату" : "Перейти к оплате"} · ${plan.price}`;
  }
}

function renderCheckout() {
  title.textContent = `Группа ${state.group}`;
  const wrapper = document.createElement("div");
  wrapper.className = "checkout-card";
  const plan = selectedPlan();

  if (runtimeMeta.status !== "loaded" || runtimeMeta.sales !== "open") {
    wrapper.className = "checkout-card result-card";
    wrapper.innerHTML = `
      <h3>Оплата сейчас закрыта</h3>
      <p>Сервер не разрешает создавать новые платежи. Выбранная группа сохранена только в текущем шаге; повторная оплата не запускается.</p>`;
    grid.append(wrapper);
    return;
  }

  const testNote = isTestPayment() ? `
    <div class="test-payment-note">
      <strong>Тестовая оплата — деньги не спишутся</strong>
      <span>Карта 5555 5555 5555 4477 · срок 01/30 · CVC 123 · код 3-D Secure 123</span>
    </div>` : "";
  const conversionNote = state.conversionId ? `
    <div class="checkout-context">
      Вы продолжаете календарь после бесплатной недели. После оплаты будет создана новая персональная paid-ссылка на весь выбранный период; trial-ссылка не превратится в платную.
    </div>` : "";
  const plans = Object.values(data.offer.plans);
  wrapper.innerHTML = `
    <div class="order-summary">
      <span>${escapeHtml(state.faculty.short)} · ${escapeHtml(state.course)} курс · группа ${escapeHtml(state.group)}</span>
      <span class="summary-plan" data-summary-plan>${escapeHtml(plan.label)}</span>
      <strong data-summary-price>${escapeHtml(plan.price)}</strong>
      <small>${escapeHtml(data.offer.academicYear)} учебный год</small>
      <small class="summary-note" data-summary-expiry>Доступ до ${escapeHtml(plan.expires)}</small>
    </div>
    <form id="checkout-form">
      ${conversionNote}
      <div class="plan-section">
        <span class="plan-section-label">Выберите тариф</span>
        <div class="plan-options" role="group" aria-label="Тариф"></div>
      </div>
      <label for="customer-email">Email покупателя</label>
      <input id="customer-email" name="email" type="email" autocomplete="email" inputmode="email" required placeholder="student@example.com" />
      ${testNote}
      <button class="pay-button" type="submit"></button>
      <p class="form-hint">После оплаты здесь появится новая персональная ссылка на полный календарь.</p>
    </form>`;
  const options = wrapper.querySelector(".plan-options");
  options.replaceChildren(...plans.map(planButton));
  wrapper.querySelector("form").addEventListener("submit", startPayment);
  grid.append(wrapper);
  updatePlanSelection(wrapper);
}

async function startPayment(event) {
  event.preventDefault();
  if (runtimeMeta.sales !== "open") return;
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
        ...(state.conversionId ? { conversionId: state.conversionId } : {}),
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
    button.textContent = `${isTestPayment() ? "Провести тестовую оплату" : "Перейти к оплате"} · ${plan.price}`;
  }
}

async function renderOrderResult(orderId, accessToken = "") {
  orderResultActive = true;
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
  const fallbackTimer = window.setTimeout(showIncompletePayment, 35000);

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
        clearTrialSession();
        title.textContent = "Оплата прошла. Остался один шаг";
        const webcalUrl = order.subscriptionUrl.replace(/^https:/, "webcal:");
        const period = order.plan === "year" ? "Учебный год" : "Семестр";
        const trialNote = order.purchasePath === "trial_to_paid" ? `
          <div class="trial-replace-note">
            Подключите новый полный календарь, затем удалите бесплатный календарь первой недели. Trial-ссылка уже не получает платных прав и после обновления будет пустой.
          </div>` : "";
        card.innerHTML = `
          <div class="success-mark">✓</div>
          <h3>Подключите полный календарь группы ${escapeHtml(order.group)}</h3>
          <p>${escapeHtml(period)} оплачен. Новая персональная ссылка готова — не пересылайте её другим людям.</p>
          <a class="pay-button link-button" href="${escapeHtml(webcalUrl)}">Подключить календарь</a>
          <button class="copy-button" type="button">Скопировать для Google Calendar</button>
          <small>Для Google Calendar добавьте скопированную ссылку через «Другие календари → Добавить по URL».</small>
          ${trialNote}`;
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
  if (state.step === "preview") renderGroupPreview();
  if (state.step === "trial") renderTrialConnect();
  if (state.step === "checkout") renderCheckout();
}

function updateRuntimeCopy() {
  const trialOpen = runtimeMeta.trials === "open";
  if (heroPrimaryCta) heroPrimaryCta.textContent = trialOpen ? "Попробовать свою группу бесплатно →" : "Выбрать свою группу →";
  if (heroRuntimeNote) {
    heroRuntimeNote.textContent = trialOpen
      ? "Первая учебная неделя вашей группы — бесплатно. Без карты и автосписаний."
      : "Сначала выберите группу и посмотрите несколько реальных занятий. Бесплатная проба появится только после отдельного включения сервиса.";
  }
  if (howStep2Title) howStep2Title.textContent = trialOpen ? "Попробуйте первую неделю бесплатно" : "Посмотрите реальные пары";
  if (howStep2Copy) howStep2Copy.textContent = trialOpen
    ? "Подключите реальный календарь первой учебной недели без банковской карты."
    : "Перед оплатой вы увидите несколько занятий именно своей группы.";
  if (howStep3Title) howStep3Title.textContent = trialOpen ? "Если удобно — оставьте календарь" : "Подключите календарь";
  if (howStep3Copy) howStep3Copy.textContent = trialOpen
    ? "После опыта trial выберите семестр или учебный год. Paid-календарь получит весь оплаченный период."
    : "Если формат подходит и продажи открыты, выберите полный период и подключите персональную ссылку.";
}

async function loadRuntimeMeta() {
  if (runtimeMeta.status === "loading") return;
  runtimeMeta.status = "loading";
  try {
    const response = await fetch(`${data.apiBase}/api/v2/meta`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error("meta_unavailable");
    runtimeMeta.sales = body.sales === "open" ? "open" : "closed";
    runtimeMeta.trials = body.trials === "open" ? "open" : "closed";
    runtimeMeta.paymentMode = body.paymentMode === "test" ? "test" : "live";
    runtimeMeta.status = "loaded";
  } catch {
    runtimeMeta.sales = "closed";
    runtimeMeta.trials = "closed";
    runtimeMeta.status = "error";
  }
  updateRuntimeCopy();
  if (!orderResultActive && ["preview", "checkout", "trial"].includes(state.step)) render();
}

backButton.addEventListener("click", () => {
  if (state.step === "checkout") setStep(state.trial ? "trial" : "preview");
  else if (state.step === "trial") setStep("preview");
  else if (state.step === "preview") setStep("group");
  else if (state.step === "group") setStep("course");
  else if (state.step === "course") setStep("faculty");
  else setStep("faculty");
});

function restoreTrialSession(value) {
  const faculty = data.faculties.find((item) => item.id === value?.facultyId);
  const course = Number(value?.course);
  const groupCode = String(value?.groupCode || "");
  if (!faculty || !Number.isInteger(course) || course < 1 || course > faculty.courses || !groupCode) return false;
  state.faculty = faculty;
  state.course = course;
  state.group = groupCode;
  state.groupRecord = {
    groupCode,
    groupId: String(value.groupId || `${data.university || "kgmu"}:${faculty.id}:${course}:${groupCode}`),
    displayName: String(value.displayName || `Группа ${groupCode}`),
  };
  state.trial = value.result;
  state.conversionId = value.result.conversionId;
  state.preview = null;
  state.previewStatus = "idle";
  state.step = "trial";
  return true;
}

async function restoreContinueContext(conversionId) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(String(conversionId || ""))) return false;
  try {
    const response = await fetch(`${data.apiBase}/api/v2/trials/continue/${encodeURIComponent(conversionId)}`, { cache: "no-store" });
    const context = await response.json();
    if (!response.ok) return false;
    const faculty = data.faculties.find((item) => item.id === context.program);
    const course = Number(context.course);
    const groupCode = String(context.groupCode || "");
    if (!faculty || !Number.isInteger(course) || course < 1 || course > faculty.courses || !groupCode) return false;
    state.faculty = faculty;
    state.course = course;
    state.group = groupCode;
    state.groupRecord = {
      groupCode,
      groupId: String(context.groupId || `${data.university || "kgmu"}:${faculty.id}:${course}:${groupCode}`),
      displayName: String(context.groupDisplayName || `Группа ${groupCode}`),
    };
    state.preview = null;
    state.previewStatus = "idle";
    state.trial = null;
    state.conversionId = conversionId;
    state.plan = "year";
    state.step = "checkout";
    return true;
  } catch {
    return false;
  }
}

async function renderCurrentPage() {
  orderResultActive = false;
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const queryParams = new URLSearchParams(window.location.search);
  const orderId = hashParams.get("order") || queryParams.get("order");
  const accessToken = hashParams.get("access") || queryParams.get("access") || "";
  if (validOrderId(orderId)) {
    saveOrder(orderId, accessToken);
    await renderOrderResult(orderId, accessToken);
    return;
  }

  document.querySelector(".steps").hidden = false;
  const conversionId = queryParams.get("continue") || hashParams.get("continue") || "";
  if (conversionId && await restoreContinueContext(conversionId)) {
    updateStepIndicators(state.step);
    kicker.textContent = stepKicker(state.step);
    backButton.hidden = false;
    render();
    void renderSavedOrders();
    return;
  }

  const savedTrial = readTrialSession();
  if (savedTrial && restoreTrialSession(savedTrial)) {
    updateStepIndicators(state.step);
    kicker.textContent = stepKicker(state.step);
    backButton.hidden = false;
    render();
    void renderSavedOrders();
    return;
  }

  state.step = state.faculty ? state.step : "faculty";
  setStep(state.step);
  void renderSavedOrders();
}

window.addEventListener("hashchange", () => { void renderCurrentPage(); });
updateRuntimeCopy();
void loadRuntimeMeta();
void renderCurrentPage();
