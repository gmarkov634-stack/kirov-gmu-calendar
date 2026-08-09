const config = window.OMGMU_CONFIG;
const catalog = window.OMGMU_GROUPS;

const courseSelect = document.querySelector('#course');
const streamSelect = document.querySelector('#stream');
const groupSelect = document.querySelector('#group');
const form = document.querySelector('#order-form');
const status = document.querySelector('#form-status');

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

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.textContent = '';
  if (!courseSelect.value || !groupSelect.value) {
    status.textContent = 'Выберите курс и группу.';
    return;
  }
  if (config.apiBaseUrl.includes('REPLACE_WITH')) {
    status.textContent = 'Адрес API Cloud.ru ещё не настроен.';
    return;
  }

  const payload = {
    university: config.university,
    program: config.program,
    course: Number(courseSelect.value),
    stream: streamSelect.value ? Number(streamSelect.value) : null,
    groupCode: groupSelect.value,
    groupId: `${config.university}:${config.program}:${courseSelect.value}:${groupSelect.value}`,
    timezone: config.timezone,
    calendarType: new FormData(form).get('calendar'),
    returnUrl: window.location.href,
  };

  try {
    const response = await fetch(`${config.apiBaseUrl}${config.paymentPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось создать оплату');
    const redirect = result.confirmationUrl || result.confirmation_url || result.url;
    if (!redirect) throw new Error('API не вернул ссылку на оплату');
    window.location.assign(redirect);
  } catch (error) {
    status.textContent = error.message;
  }
});
