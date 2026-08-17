(() => {
  const preview = document.querySelector('.calendar-preview');
  if (preview) {
    const rewriteCalendarName = () => {
      const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeValue && node.nodeValue.includes('Календарь КГМУ')) {
          node.nodeValue = node.nodeValue.replaceAll('Календарь КГМУ', 'Календарь ИжГМУ');
        }
      }
    };

    rewriteCalendarName();
    new MutationObserver(rewriteCalendarName).observe(preview, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  const API_BASE = 'https://kgmu-calendar-api.containerapps.ru';
  const UNIVERSITY = 'izhgmu';
  const PROGRAM = 'medicine';
  const selector = document.querySelector('#selector');
  const choiceGrid = selector?.querySelector('.choice-grid');
  const notice = selector?.querySelector('.notice');
  const selectorTitle = document.querySelector('#selector-title');
  const selectorKicker = selector?.querySelector('.section-kicker');
  const heroRuntimeNote = document.querySelector('#hero-runtime-note');

  if (!selector || !choiceGrid || !notice) return;

  function setWaiting(message) {
    if (heroRuntimeNote) heroRuntimeNote.textContent = message;
    notice.textContent = message;
  }

  function createSelect(id, label, placeholder) {
    const wrapper = document.createElement('label');
    wrapper.className = 'field';
    const title = document.createElement('span');
    title.textContent = label;
    const select = document.createElement('select');
    select.id = id;
    select.disabled = true;
    select.replaceChildren(new Option(placeholder, ''));
    wrapper.append(title, select);
    return { wrapper, select };
  }

  async function loadCatalog() {
    setWaiting('Проверяем опубликованные группы ИжГМУ…');
    try {
      const response = await fetch(`${API_BASE}/api/v2/catalog/${UNIVERSITY}/programs`, { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(body.programs)) throw new Error('catalog_unavailable');

      const medicine = body.programs.find((item) => item?.program === PROGRAM && Array.isArray(item.courses));
      if (!medicine?.courses?.length) {
        setWaiting('Официальное расписание 2026/27 для лечебного факультета ещё не опубликовано и не прошло проверку. Продажи закрыты.');
        return;
      }

      renderLiveSelector(medicine, body);
    } catch {
      setWaiting('Не удалось подтвердить актуальный опубликованный каталог. Группы и продажа остаются закрытыми.');
    }
  }

  function renderLiveSelector(medicine, catalog) {
    const card = document.createElement('article');
    card.className = 'program-card';

    const top = document.createElement('div');
    top.className = 'program-card-top';
    const badge = document.createElement('span');
    badge.className = 'program-badge';
    badge.textContent = 'Расписание опубликовано';
    top.append(badge);

    const heading = document.createElement('h3');
    heading.textContent = 'Лечебный факультет';
    const description = document.createElement('p');
    description.textContent = 'Выберите курс и группу из актуального опубликованного расписания.';

    const { wrapper: courseWrapper, select: courseSelect } = createSelect('izh-live-course', 'Курс', 'Выберите курс');
    const { wrapper: groupWrapper, select: groupSelect } = createSelect('izh-live-group', 'Группа', 'Сначала выберите курс');
    courseSelect.disabled = false;
    for (const course of medicine.courses) {
      courseSelect.add(new Option(`${course} курс`, String(course)));
    }

    const status = document.createElement('p');
    status.className = 'note';
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'primary';
    action.disabled = true;
    action.textContent = catalog.commercial === 'open' ? 'Подключение готовится' : 'Продажи пока закрыты';

    courseSelect.addEventListener('change', async () => {
      groupSelect.disabled = true;
      groupSelect.replaceChildren(new Option(courseSelect.value ? 'Загружаем группы…' : 'Сначала выберите курс', ''));
      status.textContent = '';
      action.disabled = true;
      if (!courseSelect.value) return;

      try {
        const url = `${API_BASE}/api/v2/catalog/${UNIVERSITY}/${PROGRAM}/${encodeURIComponent(courseSelect.value)}/groups`;
        const response = await fetch(url, { cache: 'no-store' });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !Array.isArray(body.groups)) throw new Error('groups_unavailable');

        const groups = body.groups
          .filter((group) => typeof group?.groupId === 'string' && typeof group?.groupCode === 'string')
          .sort((a, b) => a.groupCode.localeCompare(b.groupCode, 'ru', { numeric: true }));
        groupSelect.replaceChildren(new Option(groups.length ? 'Выберите группу' : 'Опубликованных групп пока нет', ''));
        for (const group of groups) {
          groupSelect.add(new Option(group.displayName || `Группа ${group.groupCode}`, group.groupId));
        }
        groupSelect.disabled = groups.length === 0;
        status.textContent = groups.length
          ? 'Список получен из текущего опубликованного каталога — статических групп на странице нет.'
          : 'Для этого курса пока нет опубликованных групп.';
      } catch {
        groupSelect.replaceChildren(new Option('Группы недоступны', ''));
        status.textContent = 'Актуальность групп не подтверждена. Продажа не открывается.';
      }
    });

    groupSelect.addEventListener('change', () => {
      if (!groupSelect.value) {
        action.disabled = true;
        return;
      }
      status.textContent = catalog.commercial === 'open'
        ? 'Группа опубликована. Коммерческое подключение будет активировано отдельным запуском.'
        : 'Группа опубликована, но коммерческий запуск ИжГМУ пока закрыт.';
      action.disabled = true;
    });

    card.append(top, heading, description, courseWrapper, groupWrapper, status, action);
    choiceGrid.replaceChildren(card);
    if (selectorKicker) selectorKicker.textContent = 'Шаг 1 из 2';
    if (selectorTitle) selectorTitle.textContent = 'Выберите курс и группу';
    notice.textContent = 'ИжГМУ остаётся в предзапускном режиме: live-каталог уже использует только опубликованные группы, а trial и оплата включаются отдельным решением после E2E-проверок.';
    if (heroRuntimeNote) heroRuntimeNote.textContent = 'Опубликованные группы доступны для выбора; коммерческий запуск пока закрыт.';
  }

  void loadCatalog();
})();
