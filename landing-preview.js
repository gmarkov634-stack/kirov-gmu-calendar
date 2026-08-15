(() => {
  const preview = document.querySelector('.calendar-preview');
  if (!preview) return;

  const days = [
    { weekday: 'Пн', fullWeekday: 'Понедельник', day: '16', date: '16 марта', events: [
      { start: '10:30', end: '12:00', title: 'Элективные дисциплины по физической культуре и спорту', type: 'Практическое занятие', place: '3 корпус, Физкультурно-оздоровительный комплекс, ул. Владимирская, 112', meta: '6 из 16 · учебная неделя 8', next: 'Следующее занятие — 23 марта', tone: 'sport' },
      { start: '13:00', end: '15:25', title: 'Анатомия', type: 'Практическое занятие', place: '3 корпус, ул. Владимирская, 112', meta: '8 из 18 · учебная неделя 8', next: 'Следующее занятие — 19 марта', tone: 'practice' },
      { start: '15:45', end: '18:10', title: 'Биология', type: 'Практическое занятие', place: '1 корпус, ул. Владимирская, 137', meta: '7 из 15 · учебная неделя 8', next: 'Следующее занятие — 21 марта', tone: 'practice' },
      { start: '18:30', end: '20:00', title: 'ЛЕКЦ. БИОЭТИКА', type: 'Лекция', place: '1 корпус, аудитория 411, ул. Владимирская, 137', meta: '4 из 7 · учебная неделя 8', next: 'Следующая лекция — 23 марта', tone: 'lecture' }
    ] },
    { weekday: 'Вт', fullWeekday: 'Вторник', day: '17', date: '17 марта', events: [
      { start: '11:00', end: '12:30', title: 'ЛЕКЦ. ГИСТОЛОГИЯ, ЭМБРИОЛОГИЯ, ЦИТОЛОГИЯ', type: 'Лекция', place: '1 корпус, аудитория 411, ул. Владимирская, 137', meta: '7 из 14 · учебная неделя 8', next: 'Следующая лекция — 24 марта', tone: 'lecture' },
      { start: '12:40', end: '14:10', title: 'ЛЕКЦ. БЕЗОПАСНОСТЬ ЖИЗНЕДЕЯТЕЛЬНОСТИ', type: 'Лекция', place: '1 корпус, аудитория 411, ул. Владимирская, 137', meta: '3 из 6 · учебная неделя 8', next: 'Следующая лекция — 31 марта', tone: 'lecture' },
      { start: '15:30', end: '17:00', title: 'Безопасность жизнедеятельности', type: 'Практическое занятие', place: '3 корпус, аудитория 711, ул. Владимирская, 112', meta: '5 из 10 · учебная неделя 8', next: 'Следующее занятие — 24 марта', tone: 'practice' }
    ] },
    { weekday: 'Ср', fullWeekday: 'Среда', day: '18', date: '18 марта', events: [
      { start: '09:00', end: '10:30', title: 'Латинский язык', type: 'Практическое занятие', place: '1 корпус, ул. Владимирская, 137', meta: '9 из 17 · учебная неделя 8', next: 'Следующее занятие — 25 марта', tone: 'practice' },
      { start: '11:00', end: '12:30', title: 'ЛЕКЦ. ПСИХОЛОГИЯ И ПЕДАГОГИКА', type: 'Лекция', place: '1 корпус, аудитория 411, ул. Владимирская, 137', meta: '5 из 9 · учебная неделя 8', next: 'Следующая лекция — 25 марта', tone: 'lecture' },
      { start: '12:40', end: '14:10', title: 'Биоэтика', type: 'Практическое занятие', place: '1 корпус, аудитория 319, ул. Владимирская, 137', meta: '6 из 11 · учебная неделя 8', next: 'Следующее занятие — 25 марта', tone: 'practice' },
      { start: '15:15', end: '16:45', title: 'Экономика', type: 'Практическое занятие', place: '1 корпус, аудитория 319, ул. Владимирская, 137', meta: '4 из 8 · учебная неделя 8', next: 'Следующее занятие — 25 марта', tone: 'practice' }
    ] }
  ];

  const START_HOUR = 8;
  const END_HOUR = 20;
  const PX_PER_MINUTE = 0.55;
  let activeDay = 0;
  let userInteracting = false;
  let autoTimer = null;
  let touchStartX = 0;

  const toMinutes = (value) => {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  };
  const stopAuto = () => { if (autoTimer) clearInterval(autoTimer); autoTimer = null; };
  const markInteraction = () => { userInteracting = true; stopAuto(); };

  preview.classList.add('calendar-preview--google');
  preview.classList.remove('calendar-preview--feed', 'is-detail-view');

  const renderGrid = () => {
    const day = days[activeDay];
    const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
    const totalHeight = (END_HOUR - START_HOUR) * 60 * PX_PER_MINUTE;
    return `
      <div class="gcal-toolbar">
        <button class="gcal-menu" type="button" aria-label="Меню" tabindex="-1">☰</button>
        <div class="gcal-month"><strong>Март</strong><span>2026</span></div>
        <div class="gcal-toolbar-icons" aria-hidden="true"><span>⌕</span><span>□</span></div>
      </div>
      <div class="gcal-date-strip" role="tablist" aria-label="Дни">
        ${days.map((item, index) => `<button type="button" class="gcal-date${index === activeDay ? ' is-active' : ''}" data-gcal-day="${index}" role="tab" aria-selected="${index === activeDay}"><span>${item.weekday}</span><b>${item.day}</b></button>`).join('')}
      </div>
      <div class="gcal-day-scroll" data-gcal-scroll>
        <div class="gcal-day-grid" style="height:${totalHeight}px">
          ${hours.map((hour, i) => `<div class="gcal-hour" style="top:${i * 60 * PX_PER_MINUTE}px"><span>${String(hour).padStart(2, '0')}:00</span><i></i></div>`).join('')}
          ${day.events.map((event, eventIndex) => {
            const top = (toMinutes(event.start) - START_HOUR * 60) * PX_PER_MINUTE;
            const height = Math.max(38, (toMinutes(event.end) - toMinutes(event.start)) * PX_PER_MINUTE - 2);
            return `<button type="button" class="gcal-event tone-${event.tone}" data-gcal-event="${eventIndex}" style="top:${top}px;height:${height}px"><strong>${event.title}</strong><span>${event.start}–${event.end}</span><small>${event.place}</small></button>`;
          }).join('')}
        </div>
      </div>
      <div class="gcal-footer"><span>${day.fullWeekday}, ${day.date}</span><span>Свайпните влево или вправо</span></div>`;
  };

  const wireGrid = () => {
    preview.querySelectorAll('[data-gcal-day]').forEach((button) => button.addEventListener('click', () => {
      markInteraction();
      activeDay = Number(button.dataset.gcalDay);
      renderCalendar();
    }));
    preview.querySelectorAll('[data-gcal-event]').forEach((button) => button.addEventListener('click', () => {
      markInteraction();
      renderDetails(activeDay, Number(button.dataset.gcalEvent));
    }));
    const scroller = preview.querySelector('[data-gcal-scroll]');
    if (scroller) scroller.scrollTop = Math.max(0, (9.5 - START_HOUR) * 60 * PX_PER_MINUTE);
    preview.addEventListener('touchstart', (event) => { touchStartX = event.touches[0]?.clientX || 0; }, { passive: true, once: true });
    preview.addEventListener('touchend', handleSwipe, { passive: true, once: true });
  };

  const handleSwipe = (event) => {
    const endX = event.changedTouches[0]?.clientX || touchStartX;
    const delta = endX - touchStartX;
    if (Math.abs(delta) > 45) {
      markInteraction();
      if (delta < 0 && activeDay < days.length - 1) activeDay += 1;
      if (delta > 0 && activeDay > 0) activeDay -= 1;
      renderCalendar();
    } else {
      preview.addEventListener('touchstart', (e) => { touchStartX = e.touches[0]?.clientX || 0; }, { passive: true, once: true });
      preview.addEventListener('touchend', handleSwipe, { passive: true, once: true });
    }
  };

  const renderCalendar = () => {
    preview.classList.remove('is-detail-view');
    preview.innerHTML = renderGrid();
    wireGrid();
  };

  const renderDetails = (dayIndex, eventIndex) => {
    const day = days[dayIndex];
    const event = day?.events[eventIndex];
    if (!event) return;
    preview.classList.add('is-detail-view');
    preview.innerHTML = `
      <div class="gcal-detail-toolbar"><button type="button" data-detail-back aria-label="Назад">←</button><span></span><div aria-hidden="true">✎ ⋮</div></div>
      <div class="gcal-detail-body">
        <section class="gcal-detail-title tone-${event.tone}"><i></i><div><h3>${event.title}</h3><p>${event.type}</p></div></section>
        <section class="gcal-detail-row"><span>◷</span><div><strong>${day.fullWeekday}, ${day.date}</strong><p>${event.start}–${event.end}</p></div></section>
        <section class="gcal-detail-row"><span>⌖</span><div><strong>${event.place}</strong></div></section>
        <section class="gcal-detail-row"><span>≡</span><div><strong>${event.meta}</strong><p>${event.next}</p></div></section>
        <section class="gcal-detail-row"><span class="gcal-calendar-dot tone-${event.tone}"></span><div><strong>Календарь КГМУ</strong><p>Расписание группы</p></div></section>
      </div>`;
    preview.querySelector('[data-detail-back]')?.addEventListener('click', () => { renderCalendar(); });
  };

  const startAuto = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    autoTimer = setInterval(() => {
      if (userInteracting || preview.classList.contains('is-detail-view')) return;
      activeDay = (activeDay + 1) % days.length;
      renderCalendar();
    }, 4800);
  };

  renderCalendar();
  startAuto();
})();
