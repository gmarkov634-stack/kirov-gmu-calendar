const config = window.OMGMU_CONFIG;

const programGrid = document.querySelector('#program-grid');
const programSelect = document.querySelector('#program');
const courseSelect = document.querySelector('#course');
const groupSelect = document.querySelector('#group');
const emailInput = document.querySelector('#email');
const form = document.querySelector('#order-form');
const status = document.querySelector('#form-status');
const orderSection = document.querySelector('#order');
const orderIntro = orderSection.querySelector('.order-copy');
const resultPanel = document.querySelector('#order-result');
const selectionSummary = document.querySelector('#selection-summary');
const priceSummary = document.querySelector('#price-summary');
const heroPriceValue = document.querySelector('#hero-price-value');
const offerPeriod = document.querySelector('#offer-period');
const restoreOrderButton = document.querySelector('#restore-order');
const testBanner = document.querySelector('#test-banner');
const submit = form.querySelector('button[type="submit"]');
const savedOrderKey = 'omgmu-calendar-orders-v2';

const initialIntroTitle = orderIntro.querySelector('h2')?.textContent || 'Выберите направление, курс и группу';
const introParagraphs = orderIntro.querySelectorAll('p');
const initialIntroText = introParagraphs[introParagraphs.length - 1]?.textContent || '';

const state = {
  offer: null,
  programs: [],
  groups: [],
  semesterPlan: null,
  ready: false,
};

function validOrderId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32}$/.test(value);
}

function validAccessToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function readSavedOrders() {
  try {
    const values = JSON.parse(localStorage.getItem(savedOrderKey) || '[]');
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
  return validAccessToken(accessToken) ? { 'X-Order-Token': accessToken } : {};
}

function reset(select, label) {
  select.replaceChildren(new Option(label, ''));
  select.disabled = true;
}

function programLabel(program) {
  return config.programLabels?.[program] || { title: program };
}

function formatPrice(plan) {
  const amount = Number(plan?.price);
  return Number.isFinite(amount) ? `${amount.toLocaleString('ru-RU')} ₽` : '—';
}

async function fetchJson(path) {
  const response = await fetch(`${config.apiBaseUrl}${path}`, { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'catalog_unavailable');
  return body;
}

function updateSelectionSummary() {
  if (!selectionSummary) return;
  const parts = [];
  if (programSelect.value) parts.push(programLabel(programSelect.value).title);
  if (courseSelect.value) parts.push(`${courseSelect.value} курс`);
  const selected = state.groups.find((item) => item.groupId === groupSelect.value);
  if (selected) parts.push(selected.displayName || `Группа ${selected.groupCode}`);
  selectionSummary.textContent = parts.length ? parts.join(' · ') : 'Выберите направление, курс и группу';
}

function renderProgramGrid() {
  const available = new Map(state.programs.map((item) => [item.program, item]));
  const known = Object.keys(config.programLabels || {});
  for (const program of available.keys()) if (!known.includes(program)) known.push(program);
  programGrid.replaceChildren();

  for (const program of known) {
    const info = programLabel(program);
    const published = available.get(program);
    const card = document.createElement('article');
    card.className = published ? 'program-card program-card-active' : 'program-card program-card-soon';

    const top = document.createElement('div');
    top.className = 'program-card-top';
    const badge = document.createElement('span');
    badge.className = published ? 'badge' : 'badge badge-muted';
    badge.textContent = published ? 'Доступно' : 'Ожидаем расписание';
    top.append(badge);
    if (info.code) {
      const code = document.createElement('span');
      code.className = 'program-code';
      code.textContent = info.code;
      top.append(code);
    }
    card.append(top);

    const title = document.createElement('h3');
    title.textContent = info.title;
    card.append(title);
    if (info.subtitle) {
      const subtitle = document.createElement('p');
      subtitle.className = 'program-subtitle';
      subtitle.textContent = info.subtitle;
      card.append(subtitle);
    }
    if (published) {
      const description = document.createElement('p');
      description.className = 'program-description';
      description.textContent = `Доступные курсы: ${published.courses.join(', ')}`;
      card.append(description);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary program-select';
      button.textContent = 'Выбрать курс и группу →';
      button.addEventListener('click', () => {
        programSelect.value = program;
        programSelect.dispatchEvent(new Event('change'));
        orderSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      card.append(button);
    }
    programGrid.append(card);
  }
}

function renderCheckoutState() {
  const price = formatPrice(state.semesterPlan);
  priceSummary.textContent = price;
  heroPriceValue.textContent = price;
  testBanner.hidden = state.offer?.paymentMode !== 'test';
  const salesOpen = state.offer?.sales === 'open';
  const canCheckout = state.ready && salesOpen && Boolean(state.semesterPlan) && state.programs.length > 0;
  submit.disabled = !canCheckout;
  if (!state.ready) submit.textContent = 'Проверяем доступность…';
  else if (!salesOpen) submit.textContent = 'Продажи временно приостановлены';
  else if (!state.semesterPlan) submit.textContent = 'Тариф семестра недоступен';
  else if (state.offer.paymentMode === 'test') submit.textContent = `Провести тестовую оплату · ${price}`;
  else submit.textContent = `Перейти к оплате · ${price}`;
}

async function loadCatalog() {
  try {
    const [offer, catalog] = await Promise.all([
      fetchJson(`/api/v2/catalog/${encodeURIComponent(config.university)}/offer`),
      fetchJson(`/api/v2/catalog/${encodeURIComponent(config.university)}/programs`),
    ]);
    if (offer.university !== config.university || catalog.university !== config.university) throw new Error('catalog_context_mismatch');
    if (offer.academicYear !== catalog.academicYear || offer.semester !== catalog.semester) throw new Error('catalog_period_mismatch');
    state.offer = offer;
    state.programs = Array.isArray(catalog.programs) ? catalog.programs : [];
    state.semesterPlan = Array.isArray(offer.plans) ? offer.plans.find((item) => item.id === 'semester') || null : null;
    state.ready = true;
    offerPeriod.textContent = `${offer.academicYear} · ${offer.semester} семестр`;

    reset(programSelect, 'Выберите направление');
    for (const entry of state.programs) {
      programSelect.add(new Option(programLabel(entry.program).title, entry.program));
    }
    programSelect.disabled = state.programs.length === 0;
    renderProgramGrid();
    renderCheckoutState();
    if (state.programs.length === 0) status.textContent = 'Для текущего периода пока нет опубликованных групп ОмГМУ.';
  } catch {
    state.ready = false;
    reset(programSelect, 'Расписание пока недоступно');
    reset(courseSelect, 'Выберите курс');
    reset(groupSelect, 'Выберите группу');
    programGrid.replaceChildren();
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'Не удалось подтвердить актуальный каталог. Продажа недоступна до восстановления проверки.';
    programGrid.append(note);
    offerPeriod.textContent = 'Каталог недоступен';
    status.textContent = 'Продажа закрыта: не удалось получить подтверждённый каталог.';
    renderCheckoutState();
  }
}

programSelect.addEventListener('change', () => {
  reset(courseSelect, 'Выберите курс');
  reset(groupSelect, 'Выберите группу');
  state.groups = [];
  const entry = state.programs.find((item) => item.program === programSelect.value);
  if (entry) {
    for (const course of entry.courses) courseSelect.add(new Option(`${course} курс`, String(course)));
    courseSelect.disabled = entry.courses.length === 0;
  }
  updateSelectionSummary();
});

courseSelect.addEventListener('change', async () => {
  reset(groupSelect, 'Выберите группу');
  state.groups = [];
  updateSelectionSummary();
  if (!programSelect.value || !courseSelect.value) return;
  try {
    const body = await fetchJson(`/api/v2/catalog/${encodeURIComponent(config.university)}/${encodeURIComponent(programSelect.value)}/${encodeURIComponent(courseSelect.value)}/groups`);
    if (body.university !== config.university || body.program !== programSelect.value || String(body.course) !== courseSelect.value) throw new Error('catalog_context_mismatch');
    if (body.academicYear !== state.offer.academicYear || body.semester !== state.offer.semester) throw new Error('catalog_period_mismatch');
    state.groups = Array.isArray(body.groups) ? body.groups.filter((item) => item.groupId && item.groupCode) : [];
    for (const group of state.groups) groupSelect.add(new Option(group.displayName || `Группа ${group.groupCode}`, group.groupId));
    groupSelect.disabled = state.groups.length === 0;
    if (state.groups.length === 0) status.textContent = 'Для выбранного курса опубликованных групп пока нет.';
  } catch {
    status.textContent = 'Не удалось подтвердить список опубликованных групп.';
  }
});

groupSelect.addEventListener('change', updateSelectionSummary);

function setIntro(title, text) {
  const heading = orderIntro.querySelector('h2');
  const paragraphs = orderIntro.querySelectorAll('p');
  if (heading) heading.textContent = title;
  if (paragraphs.length) paragraphs[paragraphs.length - 1].textContent = text;
}

function showResultShell(title, text) {
  form.hidden = true;
  resultPanel.hidden = false;
  resultPanel.replaceChildren();
  setIntro(title, text);
}

function restoreOrderForm({ scroll = true } = {}) {
  resultPanel.hidden = true;
  resultPanel.replaceChildren();
  form.hidden = false;
  status.textContent = '';
  setIntro(initialIntroTitle, initialIntroText);
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}#order`);
  if (scroll) orderSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function addText(text, className = 'note') {
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  resultPanel.append(element);
  return element;
}

function addLink(label, href, className = 'primary') {
  const link = document.createElement('a');
  link.className = className;
  link.href = href;
  link.textContent = label;
  resultPanel.append(link);
  return link;
}

function addButton(label, handler, className = 'primary') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', handler);
  resultPanel.append(button);
  return button;
}

async function copySubscriptionUrl(url, button) {
  try {
    await navigator.clipboard.writeText(url);
    button.textContent = 'Ссылка скопирована';
  } catch {
    window.prompt('Скопируйте ссылку календаря:', url);
  }
}

function showSucceededOrder(order) {
  showResultShell(
    order.testMode ? 'Тестовая оплата прошла' : 'Календарь оплачен',
    order.testMode ? 'Тестовый платёж завершён. Деньги не списывались.' : 'Оплата подтверждена. Персональная ссылка на календарь готова.',
  );
  addText('Готово', 'result-kicker');
  addText(`Группа ${order.groupCode || order.group}`, 'result-group');
  addText('Персональная ссылка создана. Не пересылайте её другим людям.');
  const webcalUrl = order.subscriptionUrl.replace(/^https:/, 'webcal:');
  addLink('Подключить на iPhone / Apple Calendar', webcalUrl);
  const copyButton = addButton('Скопировать ссылку для Google Calendar', () => copySubscriptionUrl(order.subscriptionUrl, copyButton));
  addText('В Google Calendar откройте «Другие календари → Добавить по URL» и вставьте скопированную ссылку.');
  addLink('Открыть Google Calendar', 'https://calendar.google.com/calendar/', 'secondary');
  addButton('Вернуться к выбору группы', () => restoreOrderForm(), 'secondary');
}

function showCanceledOrder() {
  showResultShell('Платёж отменён', 'Доступ не выдан.');
  addText('Платёж не завершён. Можно вернуться к форме и попробовать ещё раз.');
  addButton('Вернуться к выбору группы', () => restoreOrderForm(), 'secondary');
}

function showPendingOrder(orderId, accessToken) {
  showResultShell('Платёж ещё обрабатывается', 'Если оплата уже завершена, повторно платить не нужно.');
  addText('Проверьте статус ещё раз.');
  addButton('Проверить статус', () => renderOrderResult(orderId, accessToken));
  addButton('Вернуться к выбору группы', () => restoreOrderForm(), 'secondary');
}

async function renderOrderResult(orderId, accessToken) {
  showResultShell('Проверяем платёж', 'Получаем актуальный статус заказа.');
  addText('Получаем статус заказа…', 'result-loading');
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/v1/orders/${orderId}`, { cache: 'no-store', headers: orderHeaders(accessToken) });
      const order = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(order.error || 'order_unavailable');
      if (order.status === 'succeeded' && order.subscriptionUrl) return showSucceededOrder(order);
      if (order.status === 'canceled') return showCanceledOrder();
    } catch { /* transient status failures are retried */ }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  showPendingOrder(orderId, accessToken);
}

function handlePaymentReturn() {
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  const orderId = params.get('order');
  const accessToken = params.get('access');
  if (validOrderId(orderId) && validAccessToken(accessToken)) {
    saveOrder(orderId, accessToken);
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#order-status`);
    renderOrderResult(orderId, accessToken);
    return true;
  }
  if (hash === 'order-status') {
    const saved = latestSavedOrder();
    if (saved) {
      renderOrderResult(saved.orderId, saved.accessToken);
      return true;
    }
  }
  return false;
}

function enableSavedOrderRecovery() {
  const saved = latestSavedOrder();
  if (!restoreOrderButton || !saved) return;
  restoreOrderButton.hidden = false;
  restoreOrderButton.addEventListener('click', () => {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#order-status`);
    renderOrderResult(saved.orderId, saved.accessToken);
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '';
  if (!state.ready || state.offer?.sales !== 'open' || !state.semesterPlan) {
    status.textContent = 'Продажи временно приостановлены до завершения проверки.';
    return;
  }
  const selectedGroup = state.groups.find((item) => item.groupId === groupSelect.value);
  if (!programSelect.value || !courseSelect.value || !selectedGroup) {
    status.textContent = 'Выберите направление, курс и группу.';
    return;
  }
  if (!emailInput.validity.valid) {
    status.textContent = 'Укажите корректный email.';
    emailInput.focus();
    return;
  }
  const payload = {
    email: emailInput.value.trim(),
    university: config.university,
    program: programSelect.value,
    course: Number(courseSelect.value),
    stream: null,
    groupCode: selectedGroup.groupCode,
    groupId: selectedGroup.groupId,
    plan: 'semester',
  };
  submit.disabled = true;
  submit.textContent = 'Создаём оплату…';
  try {
    const response = await fetch(`${config.apiBaseUrl}${config.paymentPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || 'Не удалось создать оплату');
    if (!result.confirmationUrl || !validOrderId(result.orderId) || !validAccessToken(result.accessToken)) throw new Error('API вернул неполные данные оплаты');
    saveOrder(result.orderId, result.accessToken);
    window.location.assign(result.confirmationUrl);
  } catch (error) {
    status.textContent = error.message;
    renderCheckoutState();
  }
});

updateSelectionSummary();
enableSavedOrderRecovery();
renderCheckoutState();
void loadCatalog();
handlePaymentReturn();
window.addEventListener('hashchange', () => {
  if (window.location.hash === '#order-status') return void handlePaymentReturn();
  if (window.location.hash === '#order' && form.hidden) restoreOrderForm({ scroll: false });
});
