(() => {
  const preview = document.querySelector('.calendar-preview');
  if (!preview) return;

  if (!document.querySelector('link[data-calendar-feed-styles]')) {
    const feedStyles = document.createElement('link');
    feedStyles.rel = 'stylesheet';
    feedStyles.href = 'landing-feed.css?v=feed-1';
    feedStyles.dataset.calendarFeedStyles = 'true';
    document.head.appendChild(feedStyles);
  }

  const AUTO_SCROLL_STEP = 34;
  const AUTO_SCROLL_MS = 1450;

  // Реальные формулировки событий и локаций взяты из проверенного расписания
  // лечебного факультета КГМУ (4 курс, группа 401, весна 2025/26).
  const days = [
    {
      weekday: 'Понедельник', date: '2 февраля',
      events: [
        { start: '09:00', end: '12:05', title: 'Факультетская терапия, профессиональные болезни', type: 'Практическое занятие', place: 'КОГБУЗ «Центр кардиологии и неврологии», ул. Ивана Попова, 41', meta: '1 из цикла · учебная неделя', next: 'Следующее занятие — 3 февраля', tone: 'practice' },
        { start: '14:45', end: '16:15', title: 'ЛЕКЦ. ФАКУЛЬТЕТСКАЯ ТЕРАПИЯ, ПРОФЕССИОНАЛЬНЫЕ БОЛЕЗНИ', type: 'Лекция', place: '3 корпус, аудитория 803, ул. Владимирская, 112', meta: 'Лекция · учебная неделя', next: 'Следующая лекция — 9 февраля', tone: 'lecture' },
        { start: '16:45', end: '18:15', title: 'Элективные дисциплины по физической культуре и спорту', type: 'Практическое занятие', place: '3 корпус, Физкультурно-оздоровительный комплекс, ул. Владимирская, 112', meta: 'Форма аттестации: зачёт', next: 'Следующее занятие — 9 февраля', tone: 'sport' }
      ]
    },
    { weekday: 'Вторник', date: '3 февраля', events: [
      { start: '09:00', end: '12:05', title: 'Факультетская терапия, профессиональные болезни', type: 'Практическое занятие', place: 'КОГБУЗ «Центр кардиологии и неврологии», ул. Ивана Попова, 41', meta: 'Продолжение цикла', next: 'Следующее занятие — 4 февраля', tone: 'practice' }
    ] },
    { weekday: 'Среда', date: '4 февраля', events: [
      { start: '09:00', end: '12:05', title: 'Факультетская терапия, профессиональные болезни', type: 'Практическое занятие', place: 'КОГБУЗ «Центр кардиологии и неврологии», ул. Ивана Попова, 41', meta: 'Продолжение цикла', next: 'Следующее занятие — 5 февраля', tone: 'practice' }
    ] },
    { weekday: 'Четверг', date: '5 февраля', events: [
      { start: '09:00', end: '12:05', title: 'Факультетская терапия, профессиональные болезни', type: 'Практическое занятие', place: 'КОГБУЗ «Центр кардиологии и неврологии», ул. Ивана Попова, 41', meta: 'Продолжение цикла', next: 'Следующее занятие — 6 февраля', tone: 'practice' }
    ] },
    { weekday: 'Пятница', date: '6 февраля', events: [
      { start: '09:00', end: '12:05', title: 'Факультетская терапия, профессиональные болезни', type: 'Практическое занятие', place: 'КОГБУЗ «Центр кардиологии и неврологии», ул. Ивана Попова, 41', meta: 'Продолжение цикла', next: 'Следующее занятие — 7 февраля', tone: 'practice' }
    ] }
  ];

  let autoScrollTimer = null;
  let userInteracting = false;

  preview.classList.add('calendar-preview--native', 'calendar-preview--feed');
  preview.setAttribute('aria-label', 'Интерактивный пример расписания КГМУ в виде вертикальной ленты событий');

  const stopAuto = () => {
    if (autoScrollTimer) window.clearInterval(autoScrollTimer);
    autoScrollTimer = null;
  };
  const markInteraction = () => { userInteracting = true; stopAuto(); };
  const closeSheet = () => {
    const sheet = preview.querySelector('[data-event-sheet]');
    if (!sheet) return;
    sheet.classList.remove('is-open');
    window.setTimeout(() => { sheet.hidden = true; }, 180);
  };
  const openEvent = (dayIndex, eventIndex) => {
    markInteraction();
    const day = days[dayIndex];
    const event = day?.events[eventIndex];
    const sheet = preview.querySelector('[data-event-sheet]');
    if (!event || !sheet) return;
    sheet.innerHTML = `
      <div class="calendar-sheet-handle" aria-hidden="true"></div>
      <div class="calendar-sheet-toolbar"><span>${day.weekday}, ${day.date}</span><button type="button" class="calendar-sheet-close" data-sheet-close aria-label="Закрыть">×</button></div>
      <div class="calendar-sheet-time">${event.start}–${event.end}</div>
      <strong class="calendar-sheet-title">${event.title}</strong>
      <span class="calendar-sheet-type">${event.type}</span>
      <div class="calendar-sheet-info">
        <span><b>Место</b>${event.place}</span>
        <span><b>Заметки</b>${event.meta}</span>
        <span><b>Далее</b>${event.next}</span>
      </div>`;
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('is-open'));
    sheet.querySelector('[data-sheet-close]')?.addEventListener('click', closeSheet);
  };
  const renderEvent = (event, dayIndex, eventIndex, isLast) => `
    <button type="button" class="native-feed-event tone-${event.tone}${isLast ? ' is-last' : ''}" data-feed-event data-day-index="${dayIndex}" data-event-index="${eventIndex}" aria-label="${event.start} ${event.title}">
      <span class="native-feed-time">${event.start}<small>${event.end}</small></span>
      <span class="native-feed-rail" aria-hidden="true"><i></i></span>
      <span class="native-feed-card"><strong>${event.title}</strong><span class="native-feed-type">${event.type}</span><span class="native-feed-place">${event.place}</span></span>
    </button>`;

  preview.innerHTML = `
    <div class="native-calendar-bar native-feed-bar"><div><span class="native-calendar-demo">Демо календаря</span><strong>Учебная неделя</strong></div><span class="native-feed-hint">Лента событий ↓</span></div>
    <div class="native-calendar-scroll native-feed-scroll" data-calendar-scroll>
      ${days.map((day, dayIndex) => `<section class="native-feed-day" aria-label="${day.weekday}, ${day.date}"><header class="native-feed-day-head"><strong>${day.weekday}</strong><span>${day.date}</span></header><div class="native-feed-events">${day.events.map((event, eventIndex) => renderEvent(event, dayIndex, eventIndex, eventIndex === day.events.length - 1)).join('')}</div></section>`).join('')}
      <div class="native-feed-end">Конец показанной недели</div>
    </div>
    <div class="native-calendar-footer"><span>Прокрутите дни вниз</span><span>Нажмите на занятие</span></div>
    <div class="calendar-event-sheet" data-event-sheet hidden></div>`;

  preview.querySelectorAll('[data-feed-event]').forEach((button) => button.addEventListener('click', () => openEvent(Number(button.dataset.dayIndex), Number(button.dataset.eventIndex))));
  const scroller = preview.querySelector('[data-calendar-scroll]');
  scroller?.addEventListener('wheel', markInteraction, { passive: true });
  scroller?.addEventListener('touchstart', markInteraction, { passive: true });
  scroller?.addEventListener('pointerdown', markInteraction, { passive: true });
  preview.addEventListener('focusin', markInteraction);

  const startAuto = () => {
    stopAuto();
    if (userInteracting || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !scroller) return;
    autoScrollTimer = window.setInterval(() => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (max <= 0) return;
      if (scroller.scrollTop >= max - 6) scroller.scrollTo({ top: 0, behavior: 'smooth' });
      else scroller.scrollTo({ top: Math.min(max, scroller.scrollTop + AUTO_SCROLL_STEP), behavior: 'smooth' });
    }, AUTO_SCROLL_MS);
  };
  startAuto();
})();
