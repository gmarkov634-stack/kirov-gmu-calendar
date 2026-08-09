const data = window.CALENDAR_DATA;
const grid = document.querySelector("#choice-grid");
const title = document.querySelector("#selector-title");
const kicker = document.querySelector("#step-kicker");
const backButton = document.querySelector("#back-button");
const notice = document.querySelector("#notice");
const savedOrders = document.querySelector("#saved-orders");
const savedOrdersList = document.querySelector("#saved-orders-list");
const { validOrderId, validAccessToken, orderPageUrl, findPurchasedOrder } = window.CALENDAR_APP_UTILS;
const state = { step: "faculty", faculty: null, course: null, group: null };
const stepOrder = ["faculty", "course", "group", "checkout"];
const savedOrderKey = "kgmu-calendar-orders-v2";
const legacySavedOrderKey = "kgmu-calendar-orders-v1";
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
      return order.status === "succeeded" ? { id: orderId, accessToken, group: order.group } : null;
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
    link.textContent = `Открыть группу ${order.group}`;
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
    onClick: () => { state.faculty = faculty; state.course = null; setStep("course"); },
  })));
}

function renderCourses() {
  title.textContent = state.faculty.name;
  for (let course = 1; course <= state.faculty.courses; course += 1) {
    const groups = state.faculty.groups[course] || [];
    grid.append(makeCard({
      icon: course,
      title: `${course} курс`,
      subtitle: groups.length ? `${groups.length} групп доступно` : "Раздел подготовлен",
      onClick: () => { state.course = course; setStep("group"); },
    }));
  }
}

function renderGroups() {
  title.textContent = `${state.faculty.short} · ${state.course} курс`;
  const groups = state.faculty.groups[state.course] || [];
  if (!groups.length) {
    notice.hidden = false;
    notice.textContent = "Группы этого курса будут добавлены после загрузки соответствующего расписания.";
    return;
  }
  groups.forEach((group) => {
    grid.append(makeCard({
      icon: "№",
      title: `Группа ${group}`,
      subtitle: `Календарь на ${data.offer.semester} семестр`,
      className: "group-card",
      onClick: () => { state.group = group; setStep("checkout"); },
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
  title.textContent = `Группа ${state.group} уже куплена`;
  wrapper.innerHTML = `
    <div class="success-mark">✓</div>
    <h3>Эта группа уже куплена</h3>
    <p>Повторно оплачивать не нужно. Откройте сохранённый доступ к календарю.</p>
    <a class="pay-button link-button" href="${orderPageUrl(purchased.orderId, purchased.accessToken)}">Открыть группу ${state.group}</a>`;
  wrapper.querySelector("a").addEventListener("click", () => { scrollToReadyLink = true; });
}

async function renderCheckout() {
  const selectedGroup = String(state.group);
  title.textContent = `Группа ${state.group}`;
  const wrapper = document.createElement("div");
  wrapper.className = "checkout-card result-card";
  wrapper.innerHTML = "<div class=\"loading-dot\"></div><p>Проверяем сохранённые покупки…</p>";
  grid.append(wrapper);

  const purchased = await findPurchasedOrder(selectedGroup, readSavedOrders(), loadSavedOrder);
  if (state.step !== "checkout" || String(state.group) !== selectedGroup || !wrapper.isConnected) return;
  if (purchased) {
    renderPurchasedGroup(wrapper, purchased);
    return;
  }

  wrapper.className = "checkout-card";
  const testNote = data.offer.testMode ? `
      <div class="test-payment-note">
        <strong>Тестовая оплата — деньги не спишутся</strong>
        <span>Карта 5555 5555 5555 4477 · срок 01/30 · CVC 123 · код 3-D Secure 123</span>
      </div>` : "";
  const payLabel = data.offer.testMode ? "Провести тестовую оплату" : "Перейти к оплате";
  wrapper.innerHTML = `
    <div class="order-summary">
      <span>${state.faculty.short} · ${state.course} курс</span>
      <strong>${data.offer.price}</strong>
      <small>${data.offer.semester} семестр ${data.offer.academicYear} · доступ до ${data.offer.expires}</small>
    </div>
    <form id="checkout-form">
      <label for="customer-email">Email покупателя</label>
      <input id="customer-email" name="email" type="email" autocomplete="email" inputmode="email" required placeholder="student@example.com" />
      ${testNote}
      <button class="pay-button" type="submit">${payLabel} · ${data.offer.price}</button>
      <p class="form-hint">После оплаты вернитесь на эту страницу — персональная ссылка появится автоматически.</p>
    </form>`;
  wrapper.querySelector("form").addEventListener("submit", startPayment);
}

async function startPayment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  button.textContent = "Создаём платёж…";
  notice.hidden = true;
  try {
    const response = await fetch(`${data.apiBase}/api/v1/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        faculty: state.faculty.id,
        course: state.course,
        group: state.group,
        email: new FormData(form).get("email"),
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
    button.textContent = `${data.offer.testMode ? "Провести тестовую оплату" : "Перейти к оплате"} · ${data.offer.price}`;
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
        card.innerHTML = `
          <div class="success-mark">✓</div>
          <h3>Группа ${order.group}</h3>
          <p>Персональная ссылка готова. Не пересылайте её другим людям.</p>
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
