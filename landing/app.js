const config = Object.freeze({
  apiBase: "",
  universityId: "kirov-gmu",
  academicYearId: "2026-2027",
  academicPeriodId: "2026-2027-semester-1",
  catalogUrl: "../catalog/2026-2027-semester-1.json",
  annualSalesCutoff: null,
  trialEnabled: false,
  managementEnabled: false,
  checkoutEnabled: false,
  ...(globalThis.KGMU_CALENDAR_CONFIG ?? {})
});

const programMeta = Object.freeze({
  medicine: Object.freeze({ name: "Лечебный факультет", short: "Лечебное дело", icon: "Л" }),
  pediatrics: Object.freeze({ name: "Педиатрический факультет", short: "Педиатрия", icon: "П" }),
  dentistry: Object.freeze({ name: "Стоматологический факультет", short: "Стоматология", icon: "С" })
});

const productMeta = Object.freeze({
  "semester-access": Object.freeze({
    label: "Семестр",
    price: "299 ₽",
    note: "Текущий семестр и все опубликованные обновления расписания."
  }),
  "academic-year-access": Object.freeze({
    label: "Учебный год",
    price: "499 ₽",
    note: "Осенний и весенний семестры. Новый семестр появится по той же ссылке после публикации и проверки расписания КГМУ."
  })
});

const selector = document.querySelector("#selector");
const choiceGrid = document.querySelector("#choice-grid");
const backButton = document.querySelector("#back-button");
const selectorTitle = document.querySelector("#selector-title");
const stepKicker = document.querySelector("#step-kicker");
const notice = document.querySelector("#notice");
const heroRuntimeNote = document.querySelector("#hero-runtime-note");

let catalog = null;
let view = "course";
let selectedProgramId = "medicine";
let selectedCourse = null;
let selectedGroupId = null;
let selectedProductCode = "semester-access";

function apiUrl(path) {
  return new URL(path, config.apiBase || window.location.origin).toString();
}

function calendarUrl(path) {
  return new URL(path, config.apiBase || window.location.origin).toString();
}

function programById(programId) {
  return catalog?.programs?.find((program) => program.programId === programId) ?? null;
}

function setNotice(message = "") {
  if (!notice) return;
  notice.textContent = message;
  notice.hidden = !message;
}

function updateSteps() {
  const order = ["faculty", "course", "group"];
  const current = view === "selected" ? "group" : view;
  const currentIndex = order.indexOf(current);
  document.querySelectorAll("[data-step-indicator]").forEach((node) => {
    const index = order.indexOf(node.dataset.stepIndicator);
    node.classList.toggle("is-complete", index < currentIndex);
    node.classList.toggle("is-active", index === currentIndex);
  });
}

function choiceCard({ icon, title, note, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "choice-card";

  const iconNode = document.createElement("span");
  iconNode.className = "card-icon";
  iconNode.setAttribute("aria-hidden", "true");
  iconNode.textContent = icon;

  const strong = document.createElement("strong");
  strong.textContent = title;

  const small = document.createElement("small");
  small.textContent = note;

  button.append(iconNode, strong, small);
  button.addEventListener("click", onClick);
  return button;
}

function setHeading(kicker, title) {
  if (stepKicker) stepKicker.textContent = kicker;
  if (selectorTitle) selectorTitle.textContent = title;
}

function renderFaculties() {
  view = "faculty";
  selectedCourse = null;
  selectedGroupId = null;
  setNotice();
  setHeading("Шаг 1 из 3", "Выберите факультет");
  if (backButton) backButton.hidden = true;
  updateSteps();
  choiceGrid?.replaceChildren(...catalog.programs.map((program) => {
    const meta = programMeta[program.programId] ?? { name: program.displayName, short: program.displayName, icon: "К" };
    return choiceCard({
      icon: meta.icon,
      title: meta.name,
      note: `${program.courses.length} курсов`,
      onClick: () => {
        selectedProgramId = program.programId;
        renderCourses();
      }
    });
  }));
}

function renderCourses() {
  const program = programById(selectedProgramId);
  if (!program) return renderFaculties();
  view = "course";
  selectedCourse = null;
  selectedGroupId = null;
  setNotice();
  setHeading("Шаг 2 из 3", programMeta[selectedProgramId]?.name ?? program.displayName);
  if (backButton) backButton.hidden = false;
  updateSteps();
  choiceGrid?.replaceChildren(...program.courses.map((entry) => choiceCard({
    icon: String(entry.course),
    title: `${entry.course} курс`,
    note: "Проверить доступность",
    onClick: () => {
      selectedCourse = entry.course;
      renderGroups();
    }
  })));
}

function renderGroups() {
  const program = programById(selectedProgramId);
  const course = program?.courses?.find((entry) => entry.course === selectedCourse);
  if (!program || !course) return renderCourses();
  view = "group";
  selectedGroupId = null;
  setNotice();
  setHeading("Шаг 3 из 3", `${programMeta[selectedProgramId]?.name ?? program.displayName} · ${selectedCourse} курс`);
  if (backButton) backButton.hidden = false;
  updateSteps();
  choiceGrid?.replaceChildren(...course.groupIds.map((groupId) => choiceCard({
    icon: "Г",
    title: `Группа ${groupId}`,
    note: "Выбрать группу",
    onClick: () => {
      selectedGroupId = groupId;
      selectedProductCode = "semester-access";
      renderSelectedGroup();
    }
  })));
}

function annualOfferIsVisible() {
  if (!config.annualSalesCutoff) return true;
  const cutoff = new Date(config.annualSalesCutoff);
  if (Number.isNaN(cutoff.getTime())) return false;
  return Date.now() < cutoff.getTime();
}

function createPlanOptions() {
  if (selectedProductCode === "academic-year-access" && !annualOfferIsVisible()) {
    selectedProductCode = "semester-access";
  }

  const section = document.createElement("div");
  section.className = "plan-section";
  const label = document.createElement("strong");
  label.className = "plan-section-label";
  label.textContent = "Полный доступ";
  const options = document.createElement("div");
  options.className = "plan-options";

  const productCodes = ["semester-access"];
  if (annualOfferIsVisible()) productCodes.push("academic-year-access");

  for (const productCode of productCodes) {
    const meta = productMeta[productCode];
    const button = document.createElement("button");
    button.type = "button";
    button.className = `plan-option${selectedProductCode === productCode ? " is-selected" : ""}`;
    button.disabled = !config.checkoutEnabled;
    button.dataset.productCode = productCode;
    button.innerHTML = `
      <span class="plan-option-head"><strong>${meta.label}</strong>${productCode === "academic-year-access" ? '<span class="plan-badge">Выгоднее</span>' : ""}</span>
      <span class="plan-price">${meta.price}</span>
      <small>${meta.note}</small>`;
    button.addEventListener("click", () => {
      if (!config.checkoutEnabled) return;
      selectedProductCode = productCode;
      renderSelectedGroup();
    });
    options.append(button);
  }

  section.append(label, options);
  return section;
}

function renderSelectedGroup() {
  const program = programById(selectedProgramId);
  if (!program || !selectedGroupId) return renderGroups();
  view = "selected";
  setNotice();
  setHeading("Группа выбрана", `${programMeta[selectedProgramId]?.name ?? program.displayName} · ${selectedCourse} курс · группа ${selectedGroupId}`);
  updateSteps();

  const preview = document.createElement("section");
  preview.className = "group-preview";

  const head = document.createElement("div");
  head.className = "group-preview-head";
  const heading = document.createElement("div");
  heading.innerHTML = `<p class="section-kicker">Вы выбрали</p><h3>${programMeta[selectedProgramId]?.short ?? program.displayName} · группа ${selectedGroupId}</h3>`;
  const badge = document.createElement("span");
  badge.className = "verified-badge";
  badge.textContent = "Проверка на сервере";
  head.append(heading, badge);

  const previewText = document.createElement("div");
  previewText.className = "preview-empty";
  previewText.textContent = "Перед выдачей календаря сервер повторно проверит, что для этой группы опубликована проверенная версия расписания.";

  const offer = document.createElement("div");
  offer.className = "preview-offer";
  const offerCopy = document.createElement("div");
  offerCopy.innerHTML = "<strong>7 дней бесплатно или полный доступ</strong><p>Пароль не нужен. Trial и покупка используют одну стабильную подписку на календарь; переход trial → paid не требует заново добавлять календарь.</p>";
  const actions = document.createElement("div");
  actions.className = "preview-actions";

  const trialButton = document.createElement("button");
  trialButton.type = "button";
  trialButton.className = "pay-button";
  trialButton.textContent = "Попробовать 7 дней бесплатно";
  trialButton.disabled = !config.trialEnabled;
  trialButton.addEventListener("click", renderTrialForm);

  const purchaseButton = document.createElement("button");
  purchaseButton.type = "button";
  purchaseButton.className = "pay-button";
  const selectedProduct = productMeta[selectedProductCode] ?? productMeta["semester-access"];
  purchaseButton.textContent = `Купить ${selectedProduct.label.toLowerCase()} — ${selectedProduct.price}`;
  purchaseButton.disabled = !config.checkoutEnabled;
  purchaseButton.addEventListener("click", renderCheckoutForm);

  const groupsButton = document.createElement("button");
  groupsButton.type = "button";
  groupsButton.className = "secondary-action";
  groupsButton.textContent = "Выбрать другую группу";
  groupsButton.addEventListener("click", renderGroups);
  actions.append(trialButton, purchaseButton, groupsButton);
  offer.append(offerCopy, actions);

  preview.append(head, previewText, createPlanOptions(), offer);
  if (!config.trialEnabled || !config.checkoutEnabled) {
    const closed = document.createElement("div");
    closed.className = "runtime-closed";
    if (!config.trialEnabled && !config.checkoutEnabled) {
      closed.textContent = "Бесплатная проба и покупка пока выключены. Они будут доступны только после публикации проверенного production-расписания и отдельной production-проверки соответствующего backend flow.";
    } else if (!config.trialEnabled) {
      closed.textContent = "Бесплатная проба пока выключена. Покупка доступна только для опубликованного и проверенного расписания.";
    } else {
      closed.textContent = "Покупка пока выключена. Бесплатная проба доступна только для опубликованного и проверенного расписания.";
    }
    preview.append(closed);
  }
  choiceGrid?.replaceChildren(preview);
}

function renderTrialForm() {
  if (!config.trialEnabled || !selectedGroupId) return;
  const card = document.createElement("section");
  card.className = "trial-connect-card";
  card.innerHTML = `
    <div class="trial-mark" aria-hidden="true">7</div>
    <p class="section-kicker">Бесплатная проба</p>
    <h3>Получить календарь группы ${selectedGroupId}</h3>
    <p>Введите email. Он используется для вашей подписки и восстановления доступа к управлению календарём.</p>
    <form id="runtime-trial-form">
      <label for="runtime-trial-email" class="plan-section-label">Email</label>
      <input id="runtime-trial-email" type="email" autocomplete="email" inputmode="email" required placeholder="name@example.com">
      <button class="pay-button" type="submit">Начать 7-дневную пробу</button>
    </form>
    <p id="runtime-trial-status" role="status" aria-live="polite"></p>`;
  choiceGrid?.replaceChildren(card);

  card.querySelector("#runtime-trial-form")?.addEventListener("submit", submitTrial);
}

async function submitTrial(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.querySelector("#runtime-trial-email")?.value?.trim();
  const status = form.parentElement?.querySelector("#runtime-trial-status");
  const submit = form.querySelector('button[type="submit"]');
  if (!email || !selectedGroupId) return;
  submit.disabled = true;
  if (status) status.textContent = "Создаём пробную подписку…";

  try {
    const response = await fetch(apiUrl("/trial"), {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        universityId: config.universityId,
        groupId: selectedGroupId,
        academicYearId: config.academicYearId,
        academicPeriodId: config.academicPeriodId
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 409) {
      if (status) status.innerHTML = config.managementEnabled
        ? 'Пробный период для этой группы уже существует. <a href="./manage/">Открыть управление подпиской</a>.'
        : "Пробный период для этой группы уже существует.";
      return;
    }
    if (!response.ok || typeof payload.calendarPath !== "string") {
      throw new Error(payload.error === "unavailable_trial_scope"
        ? "Проверенное расписание этой группы ещё не опубликовано для пробного доступа."
        : "Не удалось создать пробную подписку. Попробуйте позже.");
    }
    renderTrialResult(calendarUrl(payload.calendarPath), payload.trialExpiresAt);
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : "Не удалось создать пробную подписку.";
  } finally {
    submit.disabled = false;
  }
}

function renderTrialResult(url, expiresAt) {
  const card = document.createElement("section");
  card.className = "trial-connect-card";
  const expiry = expiresAt ? new Date(expiresAt).toLocaleString("ru-RU") : "через 7 дней";
  card.innerHTML = `
    <div class="trial-mark" aria-hidden="true">✓</div>
    <p class="section-kicker">Календарь готов</p>
    <h3>Пробный доступ активирован</h3>
    <span class="trial-window">Действует до ${expiry}</span>
    <p>Не публикуйте персональную ICS-ссылку. При необходимости её можно будет отозвать и заменить после подтверждения email.</p>
    <div class="connect-actions">
      <button class="copy-button" type="button" id="copy-trial-url">Скопировать ссылку</button>
      ${config.managementEnabled ? '<a class="secondary-action" href="./manage/">Управление подпиской</a>' : '<span></span>'}
    </div>`;
  choiceGrid?.replaceChildren(card);
  card.querySelector("#copy-trial-url")?.addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(url);
    event.currentTarget.textContent = "Скопировано";
  });
}

function createCheckoutKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Безопасный генератор случайных значений недоступен в этом браузере.");
  }
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function renderCheckoutForm() {
  if (!config.checkoutEnabled || !selectedGroupId) return;
  const selectedProduct = productMeta[selectedProductCode] ?? productMeta["semester-access"];
  const card = document.createElement("section");
  card.className = "trial-connect-card";
  card.innerHTML = `
    <div class="trial-mark" aria-hidden="true">₽</div>
    <p class="section-kicker">Полный доступ</p>
    <h3>${selectedProduct.label} · группа ${selectedGroupId} · ${selectedProduct.price}</h3>
    <p>Сумма определяется серверным тарифом. После создания платежа вы перейдёте на защищённую страницу ЮKassa. Возврат на сайт сам по себе не подтверждает оплату.</p>
    <form id="runtime-checkout-form">
      <label for="runtime-checkout-email" class="plan-section-label">Email</label>
      <input id="runtime-checkout-email" type="email" autocomplete="email" inputmode="email" required placeholder="name@example.com">
      <button class="pay-button" type="submit">Перейти к оплате ${selectedProduct.price}</button>
    </form>
    <p id="runtime-checkout-status" role="status" aria-live="polite"></p>`;
  choiceGrid?.replaceChildren(card);
  card.querySelector("#runtime-checkout-form")?.addEventListener("submit", submitCheckout);
}

async function submitCheckout(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.querySelector("#runtime-checkout-email")?.value?.trim();
  const status = form.parentElement?.querySelector("#runtime-checkout-status");
  const submit = form.querySelector('button[type="submit"]');
  if (!email || !selectedGroupId || !config.checkoutEnabled) return;

  submit.disabled = true;
  if (status) status.textContent = "Создаём защищённый платёж…";

  try {
    const checkoutKey = createCheckoutKey();
    const response = await fetch(apiUrl("/checkout"), {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": checkoutKey
      },
      body: JSON.stringify({
        email,
        universityId: config.universityId,
        groupId: selectedGroupId,
        academicYearId: config.academicYearId,
        academicPeriodId: config.academicPeriodId,
        productCode: selectedProductCode
      })
    });
    const payload = await response.json().catch(() => ({}));

    if (response.status === 409) {
      if (payload.error === "already_entitled") {
        if (status) status.innerHTML = config.managementEnabled
          ? 'Доступ по этому тарифу уже есть. <a href="./manage/">Открыть управление подпиской</a>.'
          : "Доступ по этому тарифу уже есть.";
        return;
      }
      if (payload.error === "checkout_in_progress") {
        throw new Error("Для этой подписки уже есть незавершённый платёж. Завершите его или попробуйте позже.");
      }
    }

    if (!response.ok || typeof payload.confirmationUrl !== "string") {
      throw new Error(payload.error === "checkout_unavailable"
        ? "Этот тариф или проверенное расписание сейчас недоступны для покупки."
        : "Не удалось создать платёж. Попробуйте позже.");
    }

    const confirmationUrl = new URL(payload.confirmationUrl);
    if (confirmationUrl.protocol !== "https:") {
      throw new Error("Платёжный провайдер вернул небезопасный адрес перенаправления.");
    }
    if (status) status.textContent = "Платёж создан. Перенаправляем в ЮKassa…";
    window.location.assign(confirmationUrl.toString());
  } catch (error) {
    if (status) status.textContent = error instanceof Error ? error.message : "Не удалось создать платёж.";
    submit.disabled = false;
  }
}

function wireSavedInitialCourseView() {
  const buttons = [...(choiceGrid?.querySelectorAll(".choice-card") ?? [])];
  buttons.forEach((button, index) => {
    button.addEventListener("click", () => {
      selectedCourse = index + 1;
      renderGroups();
    });
  });
  backButton?.addEventListener("click", () => {
    if (view === "selected") return renderGroups();
    if (view === "group") return renderCourses();
    if (view === "course") return renderFaculties();
  });
}

async function loadCatalog() {
  const response = await fetch(config.catalogUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`catalog_http_${response.status}`);
  const loaded = await response.json();
  if (loaded?.universityId !== config.universityId || !Array.isArray(loaded?.programs)) {
    throw new Error("invalid_catalog");
  }
  const allowed = new Set(Object.keys(programMeta));
  loaded.programs = loaded.programs.filter((program) => allowed.has(program.programId));
  catalog = loaded;
  wireSavedInitialCourseView();
}

if (heroRuntimeNote && (config.trialEnabled || config.checkoutEnabled)) {
  heroRuntimeNote.textContent = config.trialEnabled && config.checkoutEnabled
    ? "Выберите группу: можно запустить бесплатную пробу на 7 дней или купить полный доступ. Сервер выдаёт календарь только для опубликованной и проверенной версии расписания."
    : config.trialEnabled
      ? "Выберите группу и запустите бесплатную пробу на 7 дней. Сервер выдаёт календарь только для опубликованной и проверенной версии расписания."
      : "Выберите группу и тариф. Покупка доступна только для опубликованной и проверенной версии расписания.";
}

const paymentReturn = new URLSearchParams(window.location.search).get("payment");
if (paymentReturn === "return") {
  setNotice("Вы вернулись со страницы оплаты. Доступ активируется только после серверного подтверждения ЮKassa. Если платёж успешен, проверьте email: ссылка для управления календарём придёт после подтверждения платежа.");
}

loadCatalog().catch(() => {
  setNotice("Не удалось загрузить актуальный каталог групп. Обновите страницу позже.");
  choiceGrid?.querySelectorAll("button").forEach((button) => { button.disabled = true; });
});
