const config = window.OMGMU_CONFIG;

const courseSelect = document.querySelector('#course');
const streamSelect = document.querySelector('#stream');
const groupSelect = document.querySelector('#group');
const emailInput = document.querySelector('#email');
const form = document.querySelector('#order-form');
const status = document.querySelector('#form-status');
const orderSection = document.querySelector('#order');
const orderIntro = orderSection.querySelector('.order-copy');
const orderEyebrow = orderIntro.querySelector('.eyebrow');
const formProgramLabel = document.querySelector('.form-title span');
const resultPanel = document.querySelector('#order-result');
const selectionSummary = document.querySelector('#selection-summary');
const priceSummary = document.querySelector('#price-summary');
const restoreOrderButton = document.querySelector('#restore-order');
const submit = form.querySelector('button[type="submit"]');
const testBanner = document.querySelector('#test-banner');
const heroPrice = document.querySelector('#runtime-price');
const heroSaleNote = document.querySelector('#runtime-sale-note');
const programCards = [...document.querySelectorAll('.program-card[data-program]')];
const savedOrderKey = 'omgmu-calendar-orders-v2';

const initialIntroTitle = orderIntro.querySelector('h2')?.textContent || 'Выберите курс и группу';
const introParagraphs = orderIntro.querySelectorAll('p');
const initialIntroText = introParagraphs[introParagraphs.length - 1]?.textContent || '';

const runtime = {
  ready: false,
  sales: 'closed',
  paymentMode: 'unknown',
  price: '',
  programs: new Map(),
};
let selectedProgram = '';
let loadedGroups = [];
let groupById = new Map();

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

function reset(select, label, disabled = true) {
  select.replaceChildren(new Option(label, ''));
  select.disabled = disabled;
}

function programLabel(program = selectedProgram) {
  return config.programs?.[program] || program || 'Направление ОмГМУ';
}

function selectedGroup() {
  return groupById.get(groupSelect.value) || null;
}

function rubleLabel(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(amount)} ₽`;
}

function updateRuntimeUi() {
  const isTest = runtime.paymentMode === 'test';
  document.body.classList.toggle('test-mode', isTest);
  if (testBanner) testBanner.hidden = !isTest;

  const priceLabel = rubleLabel(runtime.price);
  if (heroPrice) heroPrice.textContent = priceLabel || (runtime.ready ? 'Продажи пока закрыты' : 'Проверяем доступность');
  if (heroSaleNote) {
    heroSaleNote.textContent = runtime.sales === 'open'
      ? 'Один раз · обновления включены'
      : 'Подключение откроется только для опубликованных групп';
  }
  priceSummary.textContent = priceLabel || '—';

  submit.disabled = runtime.sales !== 'open';
  if (runtime.sales !== 'open') {
    submit.textContent = runtime.ready ? 'Продажи пока закрыты' : 'Проверяем доступность…';
  } else if (isTest) {
    submit.textContent = priceLabel ? `Провести тестовую оплату · ${priceLabel}` : 'Провести тестовую оплату';
  } else {
    submit.textContent = priceLabel ? `Перейти к оплате · ${priceLabel}` : 'Перейти к оплате';
  }

  let testNote = form.querySelector('.test-note');
  if (isTest && runtime.sales === 'open') {
    if (!testNote) {
      testNote = document.createElement('p');
      testNote.className = 'test-note';
      submit.before(testNote);
    }
    testNote.textContent = 'Тестовый магазин ЮKassa · реальные деньги не списываются';
  } else if (testNote) {
    testNote.remove();
  }
}

function updateProgramCards() {
  for (const card of programCards) {
    const program = card.dataset.program || '';
    const availability = runtime.programs.get(program);
    const badge = card.querySelector('.badge');
    const description = card.querySelector('.program-description');
    const link = card.querySelector('.program-select');
    const available = Boolean(availability?.courses?.length);

    card.classList.toggle('program-card-active', available);
    card.classList.toggle('program-card-soon', !available);
    if (badge) {
      badge.textContent = available ? 'Доступно' : (runtime.ready ? 'Ожидаем расписание' : 'Проверяем доступность');
      badge.classList.toggle('badge-muted', !available);
    }
    if (description) {
      description.textContent = available
        ? `Доступные курсы: ${availability.courses.join(', ')}`
        : 'Для текущего оффера опубликованных групп пока нет';
    }
    if (link) link.hidden = !available;
  }
}

function updateSelectionSummary() {
  if (!selectedProgram) {
    selectionSummary.textContent = 'Сначала выберите направление';
    return;
  }
  const parts = [programLabel()];
  if (courseSelect.value) parts.push(`${courseSelect.value} курс`);
  const group = selectedGroup();
  if (group) parts.push(group.displayName || `Группа ${group.groupCode}`);
  else parts.push('выберите группу');
  selectionSummary.textContent = parts.join(' · ');
}

function fillGroups(groups) {
  groupById = new Map();
  reset(groupSelect, 'Выберите группу');
  const sorted = [...groups].sort((a, b) => a.groupCode.localeCompare(b.groupCode, 'ru', { numeric: true }));
  for (const group of sorted) {
    groupById.set(group.groupId, group);
    groupSelect.add(new Option(group.displayName || `Группа ${group.groupCode}`, group.groupId));
  }
  groupSelect.disabled = sorted.length === 0;
  updateSelectionSummary();
}

function applyStreamFilter() {
  const stream = streamSelect.value;
  fillGroups(loadedGroups.filter((group) => String(group.stream ?? '') === stream));
}

async function loadGroups(course) {
  reset(streamSelect, 'Не требуется');
  reset(groupSelect, 'Загружаем группы…');
  loadedGroups = [];
  groupById = new Map();
  updateSelectionSummary();
  status.textContent = 'Загружаем опубликованные группы…';

  try {
    const url = `${config.apiBaseUrl}/api/v2/catalog/${encodeURIComponent(config.university)}/${encodeURIComponent(selectedProgram)}/${course}/groups`;
    const response = await fetch(url, { cache: 'no-store' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(body.groups)) throw new Error('catalog_unavailable');

    loadedGroups = body.groups
      .map((item) => ({
        groupId: typeof item?.groupId === 'string' ? item.groupId : '',
        groupCode: typeof item?.groupCode === 'string' ? item.groupCode : '',
        displayName: typeof item?.displayName === 'string' ? item.displayName : '',
        stream: item?.stream == null ? null : String(item.stream),
      }))
      .filter((item) => item.groupId && item.groupCode);

    const streams = [...new Set(loadedGroups.map((group) => String(group.stream ?? '')))];
    if (streams.length > 1) {
      streamSelect.replaceChildren(new Option('Выберите поток', ''));
      for (const stream of streams) streamSelect.add(new Option(stream ? `${stream} поток` : 'Без потока', stream));
      streamSelect.disabled = false;
      reset(groupSelect, 'Сначала выберите поток');
    } else {
      const stream = streams[0] ?? '';
      streamSelect.replaceChildren(new Option(stream ? `${stream} поток` : 'Не требуется', stream));
      streamSelect.disabled = true;
      fillGroups(loadedGroups);
    }
    status.textContent = loadedGroups.length ? '' : 'Для этого курса опубликованных групп пока нет.';
  } catch {
    reset(streamSelect, 'Не требуется');
    reset(groupSelect, 'Группы недоступны');
    status.textContent = 'Не удалось подтвердить опубликованные группы. Продажа для них не открывается.';
  }
}

function selectProgram(program) {
  const availability = runtime.programs.get(program);
  if (!availability?.courses?.length) return;
  selectedProgram = program;
  loadedGroups = [];
  groupById = new Map();
  reset(courseSelect, 'Выберите курс', false);
  for (const course of availability.courses) courseSelect.add(new Option(`${course} курс`, String(course)));
  reset(streamSelect, 'Не требуется');
  reset(groupSelect, 'Выберите группу');
  if (orderEyebrow) orderEyebrow.textContent = programLabel(program);
  if (formProgramLabel) formProgramLabel.textContent = programLabel(program);
  updateSelectionSummary();
  status.textContent = '';
  orderSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

for (const card of programCards) {
  card.querySelector('.program-select')?.addEventListener('click', (event) => {
    event.preventDefault();
    selectProgram(card.dataset.program || '');
  });
}

courseSelect.addEventListener('change', () => {
  reset(streamSelect, 'Не требуется');
  reset(groupSelect, 'Выберите группу');
  updateSelectionSummary();
  if (courseSelect.value && selectedProgram) void loadGroups(Number(courseSelect.value));
});
streamSelect.addEventListener('change', applyStreamFilter);
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
  showResultShell('Проверяем платёж', 'Обычно подтверждение занимает несколько секунд.');
  addText('Получаем статус заказа…', 'result-loading');
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/v1/orders/${orderId}`, {
        cache: 'no-store',
        headers: orderHeaders(accessToken),
      });
      const order = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(order.error || 'order_unavailable');
      if (order.status === 'succeeded' && order.subscriptionUrl) {
        showSucceededOrder(order);
        return;
      }
      if (order.status === 'canceled') {
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
  if (!restoreOrderButton) return;
  const saved = latestSavedOrder();
  if (!saved) return;
  restoreOrderButton.hidden = false;
  restoreOrderButton.addEventListener('click', () => {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}#order-status`);
    renderOrderResult(saved.orderId, saved.accessToken);
  });
}

async function loadRuntime() {
  runtime.ready = false;
  runtime.sales = 'closed';
  runtime.paymentMode = 'unknown';
  runtime.price = '';
  runtime.programs.clear();
  updateRuntimeUi();
  updateProgramCards();

  try {
    const [metaResponse, programsResponse] = await Promise.all([
      fetch(`${config.apiBaseUrl}/api/v2/meta`, { cache: 'no-store' }),
      fetch(`${config.apiBaseUrl}/api/v2/catalog/${encodeURIComponent(config.university)}/programs`, { cache: 'no-store' }),
    ]);
    const meta = await metaResponse.json().catch(() => ({}));
    const catalog = await programsResponse.json().catch(() => ({}));
    if (!metaResponse.ok || !programsResponse.ok || !Array.isArray(catalog.programs)) throw new Error('runtime_unavailable');

    runtime.sales = meta.sales === 'open' ? 'open' : 'closed';
    runtime.paymentMode = meta.paymentMode === 'test' ? 'test' : 'live';
    runtime.price = String(meta.offers?.[config.defaultPlan]?.price || '');
    for (const item of catalog.programs) {
      if (typeof item?.program !== 'string' || !Array.isArray(item.courses)) continue;
      runtime.programs.set(item.program, {
        courses: item.courses.filter((course) => Number.isInteger(course) && course >= 1 && course <= 9),
      });
    }
    runtime.ready = true;
    status.textContent = runtime.programs.size ? '' : 'Для текущего оффера ОмГМУ опубликованных групп пока нет.';
  } catch {
    runtime.ready = true;
    runtime.sales = 'closed';
    runtime.programs.clear();
    status.textContent = 'Не удалось подтвердить актуальный каталог. Новые покупки временно недоступны.';
  }
  updateRuntimeUi();
  updateProgramCards();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '';
  if (runtime.sales !== 'open') {
    status.textContent = 'Продажи пока закрыты.';
    return;
  }
  const group = selectedGroup();
  if (!selectedProgram || !courseSelect.value || !group) {
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
    program: selectedProgram,
    course: Number(courseSelect.value),
    stream: group.stream ?? null,
    groupCode: group.groupCode,
    groupId: group.groupId,
    timezone: config.timezone,
    plan: config.defaultPlan,
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
    if (!result.confirmationUrl || !validOrderId(result.orderId) || !validAccessToken(result.accessToken)) {
      throw new Error('API вернул неполные данные оплаты');
    }
    saveOrder(result.orderId, result.accessToken);
    window.location.assign(result.confirmationUrl);
  } catch (error) {
    status.textContent = error.message;
    updateRuntimeUi();
  }
});

reset(courseSelect, 'Сначала выберите направление');
reset(streamSelect, 'Не требуется');
reset(groupSelect, 'Выберите группу');
updateSelectionSummary();
enableSavedOrderRecovery();
const paymentReturnHandled = handlePaymentReturn();
if (!paymentReturnHandled) void loadRuntime();
else void loadRuntime();

window.addEventListener('hashchange', () => {
  if (window.location.hash === '#order-status') {
    handlePaymentReturn();
    return;
  }
  if (window.location.hash === '#order' && form.hidden) restoreOrderForm({ scroll: false });
});
