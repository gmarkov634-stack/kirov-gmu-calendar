const config = Object.freeze({
  universityId: 'kirov-gmu',
  academicYearId: '2026-2027',
  academicPeriodId: '2026-2027-semester-1',
  trialEnabled: false,
  managementEnabled: false,
  commerceEnabled: false,
  publishedGroupIds: [],
  vkUrl: '',
  supportUrl: '',
  ...(window.MEDCAL_KGMU_CONFIG || {})
});

const state = { catalog: null, program: null, course: null, groupId: null };
const $ = (id) => document.getElementById(id);
const published = new Set(Array.isArray(config.publishedGroupIds) ? config.publishedGroupIds : []);

function apiUrl(path) {
  return new URL(path, window.location.origin).toString();
}

function option(value, label) {
  const node = document.createElement('option');
  node.value = String(value);
  node.textContent = label;
  return node;
}

function setResult(message, kind = '') {
  const target = $('trial-result');
  target.className = `form-result ${kind}`.trim();
  target.textContent = message;
}

function setupRuntimeLinks() {
  const runtimeNote = $('runtime-note');
  runtimeNote.textContent = config.trialEnabled
    ? 'Trial включён только для групп с опубликованной и проверенной версией расписания.'
    : 'Публичный trial пока выключен. Лендинг работает в режиме предпросмотра.';

  for (const [key, id] of [['vkUrl', 'vk-link'], ['supportUrl', 'support-link']]) {
    const link = $(id);
    if (config[key]) {
      link.href = config[key];
      link.hidden = false;
    }
  }

  for (const button of document.querySelectorAll('.commerce-button')) {
    button.disabled = !config.commerceEnabled;
    button.title = config.commerceEnabled ? '' : 'Оплата будет включена после подключения ЮKassa';
  }
}

function renderPrograms() {
  const grid = $('program-grid');
  grid.replaceChildren();
  for (const program of state.catalog.programs) {
    const groups = program.courses.flatMap((course) => course.groupIds);
    const available = groups.filter((id) => published.has(id)).length;
    const article = document.createElement('article');
    const maxCourse = Math.max(...program.courses.map((item) => item.course));
    article.innerHTML = `<span class="status">${available ? `Доступно групп: ${available}` : 'Проверяем расписание'}</span><h3>${program.displayName}</h3><p>Курсы 1–${maxCourse}. В каталоге ${groups.length} групп.</p>`;
    grid.append(article);
  }
}

function populatePrograms() {
  const select = $('program-select');
  for (const program of state.catalog.programs) {
    select.append(option(program.programId, program.displayName));
  }
}

function chooseProgram(programId) {
  state.program = state.catalog.programs.find((item) => item.programId === programId) || null;
  state.course = null;
  state.groupId = null;
  const courseSelect = $('course-select');
  const groupSelect = $('group-select');
  courseSelect.replaceChildren(option('', state.program ? 'Выберите курс' : 'Сначала направление'));
  groupSelect.replaceChildren(option('', 'Сначала курс'));
  courseSelect.disabled = !state.program;
  groupSelect.disabled = true;
  if (state.program) {
    for (const course of state.program.courses) {
      courseSelect.append(option(course.course, `${course.course} курс`));
    }
  }
  updateSelection();
}

function chooseCourse(courseNumber) {
  state.course = state.program?.courses.find((item) => item.course === Number(courseNumber)) || null;
  state.groupId = null;
  const select = $('group-select');
  select.replaceChildren(option('', state.course ? 'Выберите группу' : 'Сначала курс'));
  select.disabled = !state.course;
  if (state.course) {
    for (const groupId of state.course.groupIds) {
      select.append(option(groupId, `Группа ${groupId}`));
    }
  }
  updateSelection();
}

function updateSelection() {
  const status = $('selection-status');
  const panel = $('trial-panel');
  if (!state.groupId) {
    status.textContent = 'Группа не выбрана.';
    panel.hidden = true;
    return;
  }
  const isPublished = published.has(state.groupId);
  status.textContent = `${state.program.displayName}, ${state.course.course} курс, группа ${state.groupId}. ${isPublished ? 'Trial доступен.' : 'Расписание группы пока не опубликовано для публичного trial.'}`;
  panel.hidden = false;
  const submit = $('trial-form').querySelector('button[type="submit"]');
  submit.disabled = !(config.trialEnabled && isPublished);
  setResult(
    config.trialEnabled
      ? (isPublished ? 'Можно запустить 7-дневный trial.' : 'Эта группа пока недоступна для trial.')
      : 'Trial ещё не включён на production.'
  );
}

async function startTrial(event) {
  event.preventDefault();
  if (!state.groupId || !config.trialEnabled || !published.has(state.groupId)) return;
  const email = $('trial-email').value.trim();
  setResult('Создаём trial…');
  try {
    const response = await fetch(apiUrl('/trial'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        universityId: config.universityId,
        groupId: state.groupId,
        academicYearId: config.academicYearId,
        academicPeriodId: config.academicPeriodId
      })
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 201 && typeof data.calendarPath === 'string') {
      const url = new URL(data.calendarPath, window.location.origin).toString();
      const target = $('trial-result');
      target.className = 'form-result success';
      target.replaceChildren();
      const box = document.createElement('div');
      box.className = 'calendar-link-result';
      const text = document.createElement('strong');
      text.textContent = 'Календарь готов';
      const code = document.createElement('code');
      code.textContent = url;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'button secondary';
      copy.textContent = 'Скопировать ссылку';
      copy.addEventListener('click', async () => {
        await navigator.clipboard.writeText(url);
        copy.textContent = 'Скопировано';
      });
      box.append(text, code, copy);
      target.append(box);
      return;
    }
    if (response.status === 409) {
      setResult('Trial для этой группы уже существует. Откройте «Управление подпиской» и запросите ссылку на email.', 'error');
      return;
    }
    if (data.error === 'unavailable_trial_scope') {
      setResult('Расписание этой группы пока не опубликовано для trial.', 'error');
      return;
    }
    if (response.status === 429) {
      setResult('Слишком много попыток. Попробуйте позже.', 'error');
      return;
    }
    setResult('Не удалось создать trial. Попробуйте позже.', 'error');
  } catch {
    setResult('Сервис временно недоступен.', 'error');
  }
}

async function init() {
  setupRuntimeLinks();
  try {
    const response = await fetch('./data/2026-2027-semester-1.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('catalog unavailable');
    state.catalog = await response.json();
    renderPrograms();
    populatePrograms();
  } catch {
    $('program-grid').textContent = 'Не удалось загрузить каталог групп.';
    $('selection-status').textContent = 'Каталог временно недоступен.';
    return;
  }
  $('program-select').addEventListener('change', (event) => chooseProgram(event.target.value));
  $('course-select').addEventListener('change', (event) => chooseCourse(event.target.value));
  $('group-select').addEventListener('change', (event) => {
    state.groupId = event.target.value || null;
    updateSelection();
  });
  $('trial-form').addEventListener('submit', startTrial);
}

init();
