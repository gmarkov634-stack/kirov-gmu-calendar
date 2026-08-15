(() => {
  const preview = document.querySelector('.calendar-preview');
  if (!preview) return;

  const DAY_START = 8 * 60;
  const DAY_END = 18 * 60;
  const HOUR_HEIGHT = 68;
  const AUTO_SCROLL_STEP = 42;
  const AUTO_SCROLL_MS = 1350;
  const DAY_SWITCH_MS = 7200;

  const days = [
    {
      weekday: 'Пн',
      date: '7',
      month: 'сентября',
      events: [
        { start: '08:00', end: '09:30', title: 'ЛЕКЦ. ПРОПЕДЕВТИКА ВНУТРЕННИХ БОЛЕЗНЕЙ', type: 'Лекция', place: 'Учебный корпус № 1 · ауд. 301', meta: '1 из 8 · учебная неделя 2', next: 'Следующая лекция — 14 сентября', tone: 'lecture' },
        { start: '09:40', end: '11:10', title: 'Биохимия', type: 'Практическое занятие', place: 'Учебный корпус № 3 · ауд. 214', meta: '3 из 12 · учебная неделя 2', next: 'Следующее занятие — 10 сентября', tone: 'practice' },
        { start: '11:20', end: '12:50', title: 'Гистология, эмбриология, цитология', type: 'Практическое занятие', place: 'Морфологический корпус · ауд. 108', meta: '2 из 10 · учебная неделя 2', next: 'Следующее занятие — 9 сентября', tone: 'practice' },
        { start: '13:00', end: '14:30', title: 'Физическая культура и спорт', type: 'Практическое занятие', place: 'Спортивный корпус', meta: '2 из 16 · учебная неделя 2', next: 'Следующее занятие — 11 сентября', tone: 'sport' }
      ]
    },
    {
      weekday: 'Вт',
      date: '8',
      month: 'сентября',
      events: [
        { start: '09:40', end: '11:10', title: 'Нормальная физиология', type: 'Практическое занятие', place: 'Учебный корпус № 2 · ауд. 404', meta: '3 из 11 · учебная неделя 2', next: 'Следующее занятие — 15 сентября', tone: 'practice' },
        { start: '11:20', end: '12:50', title: 'Микробиология, вирусология', type: 'Практическое занятие', place: 'Учебный корпус № 4 · ауд. 205', meta: '2 из 9 · учебная неделя 2', next: 'Следующее занятие — 12 сентября', tone: 'practice' },
        { start: '14:40', end: '16:10', title: 'Иностранный язык', type: 'Практическое занятие', place: 'Учебный корпус № 1 · ауд. 117', meta: '3 из 14 · учебная неделя 2', next: 'Следующее занятие — 10 сентября', tone: 'language' }
      ]
    },
    {
      weekday: 'Ср',
      date: '9',
      month: 'сентября',
      events: [
        { start: '08:00', end: '09:30', title: 'ЛЕКЦ. НОРМАЛЬНАЯ ФИЗИОЛОГИЯ', type: 'Лекция', place: 'Учебный корпус № 1 · актовый зал', meta: '2 из 7 · учебная неделя 2', next: 'Следующая лекция — 16 сентября', tone: 'lecture' },
        { start: '09:40', end: '11:10', title: 'Гистология, эмбриология, цитология', type: 'Практическое занятие', place: 'Морфологический корпус · ауд. 108', meta: '3 из 10 · учебная неделя 2', next: 'Следующее занятие — 14 сентября', tone: 'practice' },
        { start: '11:20', end: '12:50', title: 'Анатомия человека', type: 'Практическое занятие', place: 'Морфологический корпус · ауд. 202', meta: '4 из 15 · учебная неделя 2', next: 'Следующее занятие — 11 сентября', tone: 'practice' },
        { start: '13:00', end: '14:30', title: 'Медицинская информатика', type: 'Практическое занятие', place: 'Учебный корпус № 2 · компьютерный класс', meta: '2 из 8 · учебная неделя 2', next: 'Следующее занятие — 16 сентября', tone: 'informatics' }
      ]
    },
    {
      weekday: 'Чт',
      date: '10',
      month: 'сентября',
      events: [
        { start: '08:00', end: '09:30', title: 'Биохимия', type: 'Практическое занятие', place: 'Учебный корпус № 3 · ауд. 214', meta: '4 из 12 · учебная неделя 2', next: 'Следующее занятие — 14 сентября', tone: 'practice' },
        { start: '11:20', end: '12:50', title: 'Иностранный язык', type: 'Практическое занятие', place: 'Учебный корпус № 1 · ауд. 117', meta: '4 из 14 · учебная неделя 2', next: 'Следующее занятие — 15 сентября', tone: 'language' },
        { start: '13:00', end: '14:30', title: 'ЛЕКЦ. МИКРОБИОЛОГИЯ, ВИРУСОЛОГИЯ', type: 'Лекция', place: 'Учебный корпус № 1 · ауд. 305', meta: '2 из 6 · учебная неделя 2', next: 'Следующая лекция — 17 сентября', tone: 'lecture' },
        { start: '15:00', end: '16:30', title: 'Анатомия человека', type: 'Практическое занятие', place: 'Морфологический корпус · ауд. 202', meta: '5 из 15 · учебная неделя 2', next: 'Следующее занятие — 14 сентября', tone: 'practice' }
      ]
    }
  ];

  const toMinutes = (value) => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const eventStyle = (event) => {
    const start = toMinutes(event.start);
    const end = toMinutes(event.end);
    const top = ((start - DAY_START) / 60) * HOUR_HEIGHT;
    const height = Math.max(54, ((end - start) / 60) * HOUR_HEIGHT - 5);
    return `top:${top}px;height:${height}px`;
  };

  let activeDay = 0;
  let autoScrollTimer = null;
  let daySwitchTimer = null;
  let userInteracting = false;
  let touchStartX = null;

  preview.classList.add('calendar-preview--native');
  preview.setAttribute('aria-label', 'Интерактивный пример расписания в дневном календаре');

  const stopAuto = () => {
    if (autoScrollTimer) window.clearInterval(autoScrollTimer);
    if (daySwitchTimer) window.clearTimeout(daySwitchTimer);
    autoScrollTimer = null;
    daySwitchTimer = null;
  };

  const markInteraction = () => {
    userInteracting = true;
    stopAuto();
  };

  const switchDay = (index, manual = false) => {
    activeDay = (index + days.length) % days.length;
    if (manual) markInteraction();
    render();
    const scroller = preview.querySelector('[data-calendar-scroll]');
    if (scroller) scroller.scrollTop = 0;
    if (!manual) startAuto();
  };

  const openEvent = (eventIndex) => {
    markInteraction();
    const event = days[activeDay].events[eventIndex];
    const sheet = preview.querySelector('[data-event-sheet]');
    if (!sheet) return;
    sheet.innerHTML = `
      <div class="calendar-sheet-handle" aria-hidden="true"></div>
      <div class="calendar-sheet-toolbar">
        <span>Событие календаря</span>
        <button type="button" class="calendar-sheet-close" data-sheet-close aria-label="Закрыть">×</button>
      </div>
      <div class="calendar-sheet-time">${event.start}–${event.end}</div>
      <strong class="calendar-sheet-title">${event.title}</strong>
      <span class="calendar-sheet-type">${event.type}</span>
      <div class="calendar-sheet-info">
        <span><b>Место</b>${event.place}</span>
        <span><b>Заметки</b>${event.meta}</span>
        <span><b>Далее</b>${event.next}</span>
      </div>
    `;
    sheet.hidden = false;
    requestAnimationFrame(() => sheet.classList.add('is-open'));
    sheet.querySelector('[data-sheet-close]')?.addEventListener('click', closeSheet);
  };

  const closeSheet = () => {
    const sheet = preview.querySelector('[data-event-sheet]');
    if (!sheet) return;
    sheet.classList.remove('is-open');
    window.setTimeout(() => { sheet.hidden = true; }, 180);
  };

  const render = () => {
    const day = days[activeDay];
    const hours = [];
    for (let minutes = DAY_START; minutes <= DAY_END; minutes += 60) {
      const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
      hours.push(`<div class="calendar-hour" style="top:${((minutes - DAY_START) / 60) * HOUR_HEIGHT}px"><span>${hour}:00</span></div>`);
    }

    preview.innerHTML = `
      <div class="native-calendar-bar">
        <div>
          <span class="native-calendar-demo">Демо</span>
          <strong>${day.date} ${day.month}</strong>
        </div>
        <div class="native-calendar-arrows" aria-label="Переключить день">
          <button type="button" data-day-prev aria-label="Предыдущий день">‹</button>
          <button type="button" data-day-next aria-label="Следующий день">›</button>
        </div>
      </div>
      <div class="native-calendar-days" role="tablist" aria-label="Дни недели">
        ${days.map((item, index) => `
          <button type="button" class="native-calendar-day${index === activeDay ? ' is-active' : ''}" data-preview-day="${index}" role="tab" aria-selected="${index === activeDay}">
            <span>${item.weekday}</span><strong>${item.date}</strong>
          </button>
        `).join('')}
      </div>
      <div class="native-calendar-scroll" data-calendar-scroll>
        <div class="native-calendar-timeline" style="height:${((DAY_END - DAY_START) / 60) * HOUR_HEIGHT}px">
          ${hours.join('')}
          <div class="native-calendar-events">
            ${day.events.map((event, index) => `
              <button type="button" class="native-calendar-event tone-${event.tone}" style="${eventStyle(event)}" data-preview-event="${index}" aria-label="${event.start} ${event.title}">
                <span class="native-event-time">${event.start}–${event.end}</span>
                <strong>${event.title}</strong>
                <span>${event.place}</span>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="native-calendar-footer"><span>Прокрутите расписание</span><span>Нажмите на занятие</span></div>
      <div class="calendar-event-sheet" data-event-sheet hidden></div>
    `;

    preview.querySelectorAll('[data-preview-day]').forEach((button) => {
      button.addEventListener('click', () => switchDay(Number(button.dataset.previewDay), true));
    });
    preview.querySelector('[data-day-prev]')?.addEventListener('click', () => switchDay(activeDay - 1, true));
    preview.querySelector('[data-day-next]')?.addEventListener('click', () => switchDay(activeDay + 1, true));
    preview.querySelectorAll('[data-preview-event]').forEach((button) => {
      button.addEventListener('click', () => openEvent(Number(button.dataset.previewEvent)));
    });
    preview.querySelector('[data-calendar-scroll]')?.addEventListener('scroll', () => {
      if (!userInteracting && preview.matches(':hover')) markInteraction();
    }, { passive: true });
  };

  const startAuto = () => {
    stopAuto();
    if (userInteracting || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const scroller = preview.querySelector('[data-calendar-scroll]');
    if (!scroller) return;

    autoScrollTimer = window.setInterval(() => {
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (scroller.scrollTop < max - 8) {
        scroller.scrollTo({ top: Math.min(max, scroller.scrollTop + AUTO_SCROLL_STEP), behavior: 'smooth' });
      }
    }, AUTO_SCROLL_MS);

    daySwitchTimer = window.setTimeout(() => {
      stopAuto();
      activeDay = (activeDay + 1) % days.length;
      render();
      startAuto();
    }, DAY_SWITCH_MS);
  };

  preview.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'touch') markInteraction();
  });
  preview.addEventListener('focusin', markInteraction);
  preview.addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0]?.clientX ?? null;
    markInteraction();
  }, { passive: true });
  preview.addEventListener('touchend', (event) => {
    if (touchStartX === null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartX;
    const delta = endX - touchStartX;
    if (Math.abs(delta) > 55) switchDay(delta < 0 ? activeDay + 1 : activeDay - 1, true);
    touchStartX = null;
  }, { passive: true });

  render();
  startAuto();
})();