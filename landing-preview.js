(() => {
  const preview = document.querySelector('.calendar-preview');
  if (!preview) return;

  if (!document.querySelector('link[data-calendar-feed-styles]')) {
    const feedStyles = document.createElement('link');
    feedStyles.rel = 'stylesheet';
    feedStyles.href = 'landing-feed.css?v=feed-3';
    feedStyles.dataset.calendarFeedStyles = 'true';
    document.head.appendChild(feedStyles);
  }

  const AUTO_SCROLL_STEP = 34;
  const AUTO_SCROLL_MS = 1450;

  const days = [
    { weekday: 'Понедельник', date: '16 марта', events: [
      { start: '10:30', end: '12:00', title: 'Элективные дисциплины по физической культуре и спорту', type: 'Практическое занятие', place: '3 корпус, Физкультурно-оздоровительный комплекс, ул. Владимирская, 112', meta: '6 из 16 · учебная неделя 8', next: 'Следующее занятие — 23 марта', tone: 'sport' },
      { start: '13:00', end: '15:25', title: 'Анатомия', type: 'Практическое занятие', place: '3 корпус, ул. Владимирская, 112', meta: '8 из 18 · учебная неделя 8', next: 'Следующее занятие — 19 марта', tone: 'practice' },
      { start: '15:45', end: '18:10', title: 'Биология', type: 'Практическое занятие', place: '1 корпус, ул. Владимирская, 137', meta: '7 из 15 · учебная неделя 8', next: 'Следующее занятие — 21 марта', tone: 'practice' },
      { start: '18:30', end: '20:00', title: 'ЛЕКЦ. БИОЭТИКА', type: 'Лекция', place: '1 корпус, аудитория 411, ул. Владимирская, 137', meta: '4 из 7 · учебная неделя 8', next: 'Следующая лекция — 23 марта', tone: 'lecture' }
    ] },
    { weekday: 'Вторник', date: '17 марта', events: [
      { start: '11:00', end: '12:30', title: 'ЛЕКЦ. ГИСТОЛОГИЯ, ЭМБРИОЛОГИЯ, ЦИТОЛОГИЯ', type: 'Лекция', place: '1 корпус, аудитория 411, ул. Владимирская, 137', meta: '7 из 14 · учебная неделя 8', next: 'Следующая лекция — 24 марта', tone: 'lecture' },
      { start: '12:40', end: '14:10', title: 'ЛЕКЦ. БЕЗОПАСНОСТЬ ЖИЗНЕДЕЯТЕЛЬНОСТИ', type: 'Лекция', place: '1 корпус, аудитория 411, ул. Владимирская, 137', meta: '3 из 6 · учебная неделя 8', next: 'Следующая лекция — 31 марта', tone: 'lecture' },
      { start: '15:30', end: '17:00', title: 'Безопасность жизнедеятельности', type: 'Практическое занятие', place: '3 корпус, аудитория 711, ул. Владимирская, 112', meta: '5 из 10 · учебная неделя 8', next: 'Следующее занятие — 24 марта', tone: 'practice' }
    ] },
    { weekday: 'Среда', date: '18 марта', events: [
      { start: '09:00', end: '10:30', title: 'Латинский язык', type: 'Практическое занятие', place: '1 корпус, ул. Владимирская, 137', meta: '9 из 17 · учебная неделя 8', next: 'Следующее занятие — 25 марта', tone: 'language' },
      { start: '11:00', end: '12:30', title: 'ЛЕКЦ. ПСИХОЛОГИЯ И ПЕДАГОГИКА', type: 'Лекция', place: '1 корпус, аудитория 411, ул. Владимирская, 137', meta: '5 из 9 · учебная неделя 8', next: 'Следующая лекция — 25 марта', tone: 'lecture' },
      { start: '12:40', end: '14:10', title: 'Биоэтика', type: 'Практическое занятие', place: '1 корпус, аудитория 319, ул. Владимирская, 137', meta: '6 из 11 · учебная неделя 8', next: 'Следующее занятие — 25 марта', tone: 'practice' },
      { start: '15:15', end: '16:45', title: 'Экономика', type: 'Практическое занятие', place: '1 корпус, аудитория 319, ул. Владимирская, 137', meta: '4 из 8 · учебная неделя 8', next: 'Следующее занятие — 25 марта', tone: 'practice' }
    ] },
    { weekday: 'Четверг', date: '19 марта', events: [
      { start: '08:30', end: '10:00', title: 'ЛЕКЦ. АНАТОМИЯ', type: 'Лекция', place: '3 корпус, аудитория 803, ул. Владимирская, 112', meta: '8 из 15 · учебная неделя 8', next: 'Следующая лекция — 26 марта', tone: 'lecture' },
      { start: '10:40', end: '13:05', title: 'Анатомия', type: 'Практическое занятие', place: '3 корпус, ул. Владимирская, 112', meta: '9 из 18 · учебная неделя 8', next: 'Следующее занятие — 23 марта', tone: 'practice' },
      { start: '13:15', end: '15:40', title: 'Иностранный язык', type: 'Практическое занятие', place: '1 корпус, ул. Владимирская, 137', meta: '8 из 16 · учебная неделя 8', next: 'Следующее занятие — 26 марта', tone: 'language' }
    ] },
    { weekday: 'Пятница', date: '20 марта', events: [
      { start: '08:30', end: '10:00', title: 'Гистология, эмбриология, цитология', type: 'Практическое занятие', place: '1 корпус, ул. Владимирская, 137', meta: '8 из 15 · учебная неделя 8', next: 'Следующее занятие — 21 марта', tone: 'practice' },
      { start: '11:00', end: '12:30', title: 'Общая и биоорганическая химия', type: 'Практическое занятие', place: '1 корпус, ул. Владимирская, 137', meta: '7 из 14 · учебная неделя 8', next: 'Следующее занятие — 27 марта', tone: 'practice' },
      { start: '15:30', end: '17:00', title: 'История России', type: 'Практическое занятие', place: '1 корпус, аудитория 306, ул. Владимирская, 137', meta: '6 из 12 · учебная неделя 8', next: 'Следующее занятие — 27 марта', tone: 'practice' },
      { start: '17:10', end: '18:10', title: 'Час куратора', type: 'Организационное занятие', place: '1 корпус, ул. Владимирская, 137', meta: 'Учебная неделя 8', next: 'Следующая встреча — 27 марта', tone: 'informatics' }
    ] }
  ];

  let autoScrollTimer = null;
  let userInteracting = false;
  let savedScrollTop = 0;

  preview.classList.add('calendar-preview--native', 'calendar-preview--feed');
  preview.setAttribute('aria-label', 'Интерактивный пример расписания КГМУ в виде календаря телефона');

  const stopAuto = () => {
    if (autoScrollTimer) window.clearInterval(autoScrollTimer);
    autoScrollTimer = null;
  };
  const markInteraction = () => { userInteracting = true; stopAuto(); };

  const renderEvent = (event, dayIndex, eventIndex, isLast) => `
    <button type="button" class="native-feed-event tone-${event.tone}${isLast ? ' is-last' : ''}" data-feed-event data-day-index="${dayIndex}" data-event-index="${eventIndex}" aria-label="${event.start} ${event.title}">
      <span class="native-feed-time">${event.start}<small>${event.end}</small></span>
      <span class="native-feed-rail" aria-hidden="true"><i></i></span>
      <span class="native-feed-card"><strong>${event.title}</strong><span class="native-feed-type">${event.type}</span><span class="native-feed-place">${event.place}</span></span>
    </button>`;

  const wireFeed = () => {
    preview.querySelectorAll('[data-feed-event]').forEach((button) => button.addEventListener('click', () => {
      const scroller = preview.querySelector('[data-calendar-scroll]');
      savedScrollTop = scroller?.scrollTop || 0;
      markInteraction();
      renderDetails(Number(button.dataset.dayIndex), Number(button.dataset.eventIndex));
    }));
    const scroller = preview.querySelector('[data-calendar-scroll]');
    scroller?.addEventListener('wheel', markInteraction, { passive: true });
    scroller?.addEventListener('touchstart', markInteraction, { passive: true });
    scroller?.addEventListener('pointerdown', markInteraction, { passive: true });
    preview.addEventListener('focusin', markInteraction, { once: true });
    if (scroller) scroller.scrollTop = savedScrollTop;
    return scroller;
  };

  const renderFeed = () => {
    preview.classList.remove('is-detail-view');
    preview.innerHTML = `
      <div class="native-calendar-bar native-feed-bar"><div><span class="native-calendar-demo">Демо · 1 курс лечебного</span><strong>Учебная неделя</strong></div><span class="native-feed-hint">Лента событий ↓</span></div>
      <div class="native-calendar-scroll native-feed-scroll" data-calendar-scroll>
        ${days.map((day, dayIndex) => `<section class="native-feed-day" aria-label="${day.weekday}, ${day.date}"><header class="native-feed-day-head"><strong>${day.weekday}</strong><span>${day.date}</span></header><div class="native-feed-events">${day.events.map((event, eventIndex) => renderEvent(event, dayIndex, eventIndex, eventIndex === day.events.length - 1)).join('')}</div></section>`).join('')}
        <div class="native-feed-end">Конец показанной недели</div>
      </div>
      <div class="native-calendar-footer"><span>Прокрутите дни вниз</span><span>Нажмите на занятие</span></div>`;
    return wireFeed();
  };

  const renderDetails = (dayIndex, eventIndex) => {
    const day = days[dayIndex];
    const event = day?.events[eventIndex];
    if (!day || !event) return;
    preview.classList.add('is-detail-view');
    preview.innerHTML = `
      <div class="calendar-detail-nav">
        <button type="button" class="calendar-detail-back" data-detail-back aria-label="Назад к расписанию">‹ <span>Расписание</span></button>
        <strong>Событие</strong>
        <span class="calendar-detail-nav-spacer" aria-hidden="true"></span>
      </div>
      <div class="calendar-detail-scroll">
        <section class="calendar-detail-hero tone-${event.tone}">
          <span class="calendar-detail-dot" aria-hidden="true"></span>
          <div>
            <h3>${event.title}</h3>
            <p>${event.type}</p>
          </div>
        </section>
        <section class="calendar-detail-group">
          <div class="calendar-detail-row"><span class="calendar-detail-icon">◷</span><div><strong>${day.weekday}, ${day.date}</strong><span>${event.start}–${event.end}</span></div></div>
          <div class="calendar-detail-row"><span class="calendar-detail-icon">⌖</span><div><strong>Место</strong><span>${event.place}</span></div></div>
        </section>
        <section class="calendar-detail-group">
          <div class="calendar-detail-row"><span class="calendar-detail-icon">≡</span><div><strong>Заметки</strong><span>${event.meta}</span><span>${event.next}</span></div></div>
        </section>
        <section class="calendar-detail-group calendar-detail-calendar-row">
          <span class="calendar-detail-color tone-${event.tone}"></span><div><strong>Календарь КГМУ</strong><span>Расписание группы</span></div>
        </section>
      </div>`;
    preview.querySelector('[data-detail-back]')?.addEventListener('click', () => {
      renderFeed();
    });
  };

  const startAuto = (scroller) => {
    stopAuto();
    if (userInteracting || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !scroller) return;
    autoScrollTimer = window.setInterval(() => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (max <= 0) return;
      if (scroller.scrollTop >= max - 6) scroller.scrollTo({ top: 0, behavior: 'smooth' });
      else scroller.scrollTo({ top: Math.min(max, scroller.scrollTop + AUTO_SCROLL_STEP), behavior: 'smooth' });
    }, AUTO_SCROLL_MS);
  };

  const scroller = renderFeed();
  startAuto(scroller);
})();
