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
  let platform = 'google';
  let activeDay = 0;
  let savedAppleScroll = 0;
  let userInteracting = false;
  let autoTimer = null;
  let touchStartX = 0;
  let touchStartY = 0;

  const toMinutes = (value) => {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  };
  const stopAuto = () => { if (autoTimer) clearInterval(autoTimer); autoTimer = null; };
  const markInteraction = () => { userInteracting = true; stopAuto(); };
  const toneLabel = (tone) => tone === 'lecture' ? 'Лекция' : tone === 'sport' ? 'Физкультура' : 'Занятие';

  const platformSwitch = () => `
    <div class="calendar-platform-switch" role="tablist" aria-label="Вид календаря">
      <button type="button" class="calendar-platform-tab${platform === 'apple' ? ' is-active' : ''}" data-platform="apple" role="tab" aria-selected="${platform === 'apple'}">Apple</button>
      <button type="button" class="calendar-platform-tab${platform === 'google' ? ' is-active' : ''}" data-platform="google" role="tab" aria-selected="${platform === 'google'}">Google</button>
    </div>`;

  const renderGoogleGrid = () => {
    const day = days[activeDay];
    const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
    const totalHeight = (END_HOUR - START_HOUR) * 60 * PX_PER_MINUTE;
    return `
      <div class="gcal-toolbar"><span class="gcal-menu" aria-hidden="true">☰</span><div class="gcal-month"><strong>Март</strong><span>2026</span></div><div class="gcal-toolbar-icons" aria-hidden="true"><span>⌕</span><span>□</span></div></div>
      <div class="gcal-date-strip" role="tablist" aria-label="Дни">${days.map((item, index) => `<button type="button" class="gcal-date${index === activeDay ? ' is-active' : ''}" data-calendar-day="${index}" role="tab" aria-selected="${index === activeDay}"><span>${item.weekday}</span><b>${item.day}</b></button>`).join('')}</div>
      <div class="gcal-day-scroll" data-day-scroll><div class="gcal-day-grid" style="height:${totalHeight}px">
        ${hours.map((hour, i) => `<div class="gcal-hour" style="top:${i * 60 * PX_PER_MINUTE}px"><span>${String(hour).padStart(2, '0')}:00</span><i></i></div>`).join('')}
        ${day.events.map((event, eventIndex) => {
          const top = (toMinutes(event.start) - START_HOUR * 60) * PX_PER_MINUTE;
          const height = Math.max(38, (toMinutes(event.end) - toMinutes(event.start)) * PX_PER_MINUTE - 2);
          return `<button type="button" class="gcal-event tone-${event.tone}" data-calendar-event="${eventIndex}" data-day-index="${activeDay}" style="top:${top}px;height:${height}px"><strong>${event.title}</strong><span>${event.start}–${event.end}</span><small>${event.place}</small></button>`;
        }).join('')}
      </div></div>
      <div class="gcal-footer"><span>${day.fullWeekday}, ${day.date}</span><span>← Apple · Google →</span></div>`;
  };

  const renderAppleFeed = () => `
    <div class="acal-toolbar"><button type="button" class="acal-back" tabindex="-1">‹ Март</button><strong>Расписание</strong><span class="acal-actions" aria-hidden="true">⌕　＋</span></div>
    <div class="acal-agenda-scroll" data-apple-scroll>
      ${days.map((day, dayIndex) => `
        <section class="acal-agenda-day">
          <header class="acal-agenda-day-head"><span>${day.weekday}</span><b>${day.day}</b><div><strong>${day.fullWeekday}</strong><small>${day.date}</small></div></header>
          <div class="acal-agenda-events">
            ${day.events.map((event, eventIndex) => `
              <button type="button" class="acal-agenda-event tone-${event.tone}" data-calendar-event="${eventIndex}" data-day-index="${dayIndex}">
                <span class="acal-agenda-time"><b>${event.start}</b><small>${event.end}</small></span>
                <i aria-hidden="true"></i>
                <span class="acal-agenda-copy"><strong>${event.title}</strong><small>${event.place}</small></span>
              </button>`).join('')}
          </div>
        </section>`).join('')}
      <div class="acal-agenda-end">Конец показанных дней</div>
    </div>
    <div class="acal-footer"><span>Сегодня</span><strong>Календари</strong><span>Входящие</span></div>`;

  const renderDetails = (dayIndex, eventIndex) => {
    const day = days[dayIndex];
    const event = day?.events[eventIndex];
    if (!event) return;
    preview.classList.add('is-detail-view');
    if (platform === 'apple') {
      preview.innerHTML = `${platformSwitch()}<div class="acal-detail-nav"><button type="button" data-detail-back>‹ <span>Расписание</span></button><strong>Событие</strong><span>Изменить</span></div><div class="acal-detail-body"><section class="acal-detail-hero tone-${event.tone}"><i></i><div><h3>${event.title}</h3><p>${toneLabel(event.tone)}</p></div></section><section class="acal-detail-group"><div><b>${day.fullWeekday}, ${day.date}</b><span>${event.start}–${event.end}</span></div><div><b>Место</b><span>${event.place}</span></div></section><section class="acal-detail-group"><div><b>Заметки</b><span>${event.meta}</span><span>${event.next}</span></div></section><section class="acal-detail-group"><div class="acal-calendar"><i class="tone-${event.tone}"></i><span>Календарь КГМУ</span></div></section></div>`;
    } else {
      preview.innerHTML = `${platformSwitch()}<div class="gcal-detail-toolbar"><button type="button" data-detail-back aria-label="Назад">←</button><span></span><div aria-hidden="true">✎ ⋮</div></div><div class="gcal-detail-body"><section class="gcal-detail-title tone-${event.tone}"><i></i><div><h3>${event.title}</h3><p>${event.type}</p></div></section><section class="gcal-detail-row"><span>◷</span><div><strong>${day.fullWeekday}, ${day.date}</strong><p>${event.start}–${event.end}</p></div></section><section class="gcal-detail-row"><span>⌖</span><div><strong>${event.place}</strong></div></section><section class="gcal-detail-row"><span>≡</span><div><strong>${event.meta}</strong><p>${event.next}</p></div></section><section class="gcal-detail-row"><span class="gcal-calendar-dot tone-${event.tone}"></span><div><strong>Календарь КГМУ</strong><p>Расписание группы</p></div></section></div>`;
    }
    wireCommon();
    preview.querySelector('[data-detail-back]')?.addEventListener('click', renderCalendar);
  };

  const changePlatform = (nextPlatform) => {
    if (!['apple', 'google'].includes(nextPlatform) || nextPlatform === platform) return;
    const appleScroller = preview.querySelector('[data-apple-scroll]');
    if (platform === 'apple' && appleScroller) savedAppleScroll = appleScroller.scrollTop;
    markInteraction();
    platform = nextPlatform;
    renderCalendar();
  };

  const handleSwipe = (event) => {
    const endX = event.changedTouches[0]?.clientX || touchStartX;
    const endY = event.changedTouches[0]?.clientY || touchStartY;
    const dx = endX - touchStartX;
    const dy = endY - touchStartY;
    if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    markInteraction();
    if (platform === 'apple') {
      if (dx < 0) platform = 'google';
    } else {
      if (dx > 0 && activeDay === 0) platform = 'apple';
      else if (dx < 0 && activeDay < days.length - 1) activeDay += 1;
      else if (dx > 0 && activeDay > 0) activeDay -= 1;
    }
    renderCalendar();
  };

  const wireCommon = () => {
    preview.querySelectorAll('[data-platform]').forEach((button) => button.addEventListener('click', () => changePlatform(button.dataset.platform)));
    preview.addEventListener('touchstart', (event) => { touchStartX = event.touches[0]?.clientX || 0; touchStartY = event.touches[0]?.clientY || 0; }, { passive: true, once: true });
    preview.addEventListener('touchend', handleSwipe, { passive: true, once: true });
  };

  const renderCalendar = () => {
    preview.className = `calendar-preview calendar-preview--dual calendar-preview--${platform}`;
    preview.innerHTML = `${platformSwitch()}${platform === 'apple' ? renderAppleFeed() : renderGoogleGrid()}`;
    wireCommon();

    if (platform === 'google') {
      preview.querySelectorAll('[data-calendar-day]').forEach((button) => button.addEventListener('click', () => { markInteraction(); activeDay = Number(button.dataset.calendarDay); renderCalendar(); }));
      const scroller = preview.querySelector('[data-day-scroll]');
      if (scroller) scroller.scrollTop = Math.max(0, (9.5 - START_HOUR) * 60 * PX_PER_MINUTE);
    } else {
      const scroller = preview.querySelector('[data-apple-scroll]');
      if (scroller) {
        scroller.scrollTop = savedAppleScroll;
        scroller.addEventListener('scroll', () => { savedAppleScroll = scroller.scrollTop; markInteraction(); }, { passive: true, once: true });
      }
    }

    preview.querySelectorAll('[data-calendar-event]').forEach((button) => button.addEventListener('click', () => {
      const appleScroller = preview.querySelector('[data-apple-scroll]');
      if (appleScroller) savedAppleScroll = appleScroller.scrollTop;
      markInteraction();
      renderDetails(Number(button.dataset.dayIndex ?? activeDay), Number(button.dataset.calendarEvent));
    }));
  };

  const startAuto = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    autoTimer = setInterval(() => {
      if (userInteracting || preview.classList.contains('is-detail-view')) return;
      if (platform === 'google') {
        activeDay = (activeDay + 1) % days.length;
        if (activeDay === 0) platform = 'apple';
      } else {
        const scroller = preview.querySelector('[data-apple-scroll]');
        if (scroller) {
          const max = scroller.scrollHeight - scroller.clientHeight;
          if (scroller.scrollTop < max - 24) {
            scroller.scrollTo({ top: Math.min(max, scroller.scrollTop + 92), behavior: 'smooth' });
            return;
          }
        }
        savedAppleScroll = 0;
        platform = 'google';
      }
      renderCalendar();
    }, 4600);
  };

  renderCalendar();
  startAuto();
})();
