const config = window.OMGMU_CONFIG;
const catalog = window.OMGMU_GROUPS;

const courseSelect = document.querySelector('#course');
const streamSelect = document.querySelector('#stream');
const groupSelect = document.querySelector('#group');
const emailInput = document.querySelector('#email');
const form = document.querySelector('#order-form');
const status = document.querySelector('#form-status');
const orderSection = document.querySelector('#order');
const orderIntro = orderSection.querySelector(':scope > div');
const savedOrderKey = 'omgmu-calendar-orders-v2';

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

const courses = [...new Set(catalog.map((item) => item.course))].sort((a, b) => a - b);
for (const course of courses) courseSelect.add(new Option(`${course} курс`, String(course)));

function reset(select, label) {
  select.replaceChildren(new Option(label, ''));
  select.disabled = true;
}

function entriesForCourse() {
  return catalog.filter((item) => String(item.course) === courseSelect.value);
}

function fillGroups(entries) {
  reset(groupSelect, 'Выберите группу');
  const groups = entries.flatMap((item) => item.groups).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }));
  for (const group of groups) groupSelect.add(new Option(`Группа ${group}`, group));
  groupSelect.disabled = groups.length === 0;
}

courseSelect.addEventListener('change', () => {
  reset(streamSelect, 'Не требуется');
  reset(groupSelect, 'Выберите группу');
  const entries = entriesForCourse();
  const streams = entries.map((item) => item.stream).filter(Boolean);
  if (streams.length > 1) {
    streamSelect.replaceChildren(new Option('Выберите поток', ''));
    for (const stream of streams) streamSelect.add(new Option(`${stream} поток`, String(stream)));
    streamSelect.disabled = false;
  } else {
    fillGroups(entries);
  }
});

streamSelect.addEventListener('change', () => {
  fillGroups(entriesForCourse().filter((item) => String(item.stream || '') === streamSelect.value));
});

function buildGroupId({ course, stream, groupCode }) {
  return [
    config.university,
    config.program,
    String(course),
    stream ? `stream-${stream}` : null,
    groupCode,
  ].filter(Boolean).join(':');
}

function setIntro(title, text) {
  const heading = orderIntro.querySelector('h2');
  const paragraphs = orderIntro.querySelectorAll('p');
  if (heading) heading.textContent = title;
  if (paragraphs.length) paragraphs[paragraphs.length - 1].textContent = text;
}

function clearResultForm() {
  form.replaceChildren();
  form.removeAttribute('novalidate');
}

function addText(text, className = 'note') {
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  form.append(element);
  return element;
}

function addLink(label, href, className = 'primary') {
  const link = document.createElement('a');
  link.className = className;
  link.href = href;
  link.textContent = label;
  form.append(link);
  return link;
}

function addButton(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary';
  button.textContent = label;
  button.addEventListener('click', handler);
  form.append(button);
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
  clearResultForm();
  setIntro(
    order.testMode ? 'Тестовая оплата прошла' : 'Календарь оплачен',
    order.testMode
      ? 'Тестовый платёж завершён. Деньги не списывались.'
      : 'Оплата подтверждена. Персональная ссылка на календарь готова.',
  );
  addText(`Группа ${order.groupCode || order.group}. Не пересылайте персональную ссылку другим людям.`);
  const webcalUrl = order.subscriptionUrl.replace(/^https:/, 'webcal:');
  addLink('Подключить на iPhone / Apple Calendar', webcalUrl);
  const copyButton = addButton('Скопировать ссылку для Google Calendar', () => copySubscriptionUrl(order.subscriptionUrl, copyButton));
  addText('Для Google Calendar откройте «Другие календари → Добавить по URL» и вставьте скопированную ссылку.');
  addLink('Открыть Google Calendar', 'https://calendar.google.com/calendar/', 'primary');
  addLink('Вернуться к выбору группы', './#order', 'primary');
}

function showCanceledOrder() {
  clearResultForm();
  setIntro('Платёж отменён', 'Доступ не выдан. В тестовом режиме деньги не списываются.');
  addLink('Вернуться к выбору группы', './#order');
}

function showPendingOrder(orderId, accessToken) {
  clearResultForm();
  setIntro('Платёж ещё обрабатывается', 'Если оплата уже завершена, повторно платить не нужно.');
  addText('Нажмите «Проверить статус» через несколько секунд.');
  addButton('Проверить статус', () => renderOrderResult(orderId, accessToken));
  addLink('Вернуться к выбору группы', './#order');
}

async function renderOrderResult(orderId, accessToken) {
  clearResultForm();
  setIntro('Проверяем платёж', 'Обычно подтверждение занимает несколько секунд.');
  addText('Получаем статус заказа…');

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
    } catch {
      // A transient API error is retried below.
    }
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

const submit = form.querySelector('button[type="submit"]');
if (config.checkoutEnabled !== true) {
  submit.disabled = true;
  submit.textContent = 'Продажи временно приостановлены';
} else if (config.testMode === true) {
  submit.textContent = `Провести тестовую оплату · ${config.priceRub} ₽`;
  const testNote = document.createElement('p');
  testNote.className = 'note';
  testNote.textContent = 'Тестовый магазин ЮKassa: деньги не списываются.';
  submit.before(testNote);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '';

  if (config.checkoutEnabled !== true) {
    status.textContent = 'Продажи временно приостановлены до завершения проверки.';
    return;
  }
  if (!courseSelect.value || !groupSelect.value) {
    status.textContent = 'Выберите курс и группу.';
    return;
  }
  if (!emailInput.validity.valid) {
    status.textContent = 'Укажите корректный email.';
    emailInput.focus();
    return;
  }
  if (config.apiBaseUrl.includes('REPLACE_WITH')) {
    status.textContent = 'Адрес API Cloud.ru ещё не настроен.';
    return;
  }

  const course = Number(courseSelect.value);
  const stream = streamSelect.value || null;
  const groupCode = groupSelect.value;
  const payload = {
    email: emailInput.value.trim(),
    university: config.university,
    program: config.program,
    course,
    stream,
    groupCode,
    groupId: buildGroupId({ course, stream, groupCode }),
    timezone: config.timezone,
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
    submit.disabled = false;
    submit.textContent = config.testMode === true
      ? `Провести тестовую оплату · ${config.priceRub} ₽`
      : 'Перейти к оплате';
  }
});

handlePaymentReturn();
window.addEventListener('hashchange', () => {
  if (window.location.hash === '#order-status') {
    handlePaymentReturn();
    return;
  }
  if (window.location.hash === '#order' && !form.querySelector('#course')) {
    window.location.reload();
  }
});
