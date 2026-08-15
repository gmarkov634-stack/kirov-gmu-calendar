(() => {
  const preview = document.querySelector('.calendar-preview');
  if (!preview) return;

  const days = [
    {
      label: 'Пн, 7 сентября',
      short: 'Пн 7',
      events: [
        {
          time: '08:00',
          title: 'ЛЕКЦ. ПРОПЕДЕВТИКА ВНУТРЕННИХ БОЛЕЗНЕЙ',
          type: 'Лекция',
          place: 'Учебный корпус № 1 · ауд. 301',
          meta: '1 из 8 · учебная неделя 2',
          next: 'Следующая лекция — 14 сентября'
        },
        {
          time: '09:40',
          title: 'Биохимия',
          type: 'Практическое занятие',
          place: 'Учебный корпус № 3 · ауд. 214',
          meta: '3 из 12 · учебная неделя 2',
          next: 'Следующее занятие — 10 сентября'
        },
        {
          time: '11:20',
          title: 'Гистология, эмбриология, цитология',
          type: 'Практическое занятие',
          place: 'Морфологический корпус · ауд. 108',
          meta: '2 из 10 · учебная неделя 2',
          next: 'Следующее занятие — 9 сентября'
        },
        {
          time: '13:00',
          title: 'Физическая культура и спорт',
          type: 'Практическое занятие',
          place: 'Спортивный корпус',
          meta: '2 из 16 · учебная неделя 2',
          next: 'Следующее занятие — 11 сентября'
        }
      ]
    },
    {
      label: 'Вт, 8 сентября',
      short: 'Вт 8',
      events: [
        {
          time: '09:40',
          title: 'Нормальная физиология',
          type: 'Практическое занятие',
          place: 'Учебный корпус № 2 · ауд. 404',
          meta: '3 из 11 · учебная неделя 2',
          next: 'Следующее занятие — 15 сентября'
        },
        {
          time: '11:20',
          title: 'Микробиология, вирусология',
          type: 'Практическое занятие',
          place: 'Учебный корпус № 4 · ауд. 205',
          meta: '2 из 9 · учебная неделя 2',
          next: 'Следующее занятие — 12 сентября'
        },
        {
          time: '14:40',
          title: 'Иностранный язык',
          type: 'Практическое занятие',
          place: 'Учебный корпус № 1 · ауд. 117',
          meta: '3 из 14 · учебная неделя 2',
          next: 'Следующее занятие — 10 сентября'
        }
      ]
    },
    {
      label: 'Ср, 9 сентября',
      short: 'Ср 9',
      events: [
        {
          time: '08:00',
          title: 'ЛЕКЦ. НОРМАЛЬНАЯ ФИЗИОЛОГИЯ',
          type: 'Лекция',
          place: 'Учебный корпус № 1 · актовый зал',
          meta: '2 из 7 · учебная неделя 2',
          next: 'Следующая лекция — 16 сентября'
        },
        {
          time: '09:40',
          title: 'Гистология, эмбриология, цитология',
          type: 'Практическое занятие',
          place: 'Морфологический корпус · ауд. 108',
          meta: '3 из 10 · учебная неделя 2',
          next: 'Следующее занятие — 14 сентября'
        },
        {
          time: '11:20',
          title: 'Анатомия человека',
          type: 'Практическое занятие',
          place: 'Морфологический корпус · ауд. 202',
          meta: '4 из 15 · учебная неделя 2',
          next: 'Следующее занятие — 11 сентября'
        },
        {
          time: '13:00',
          title: 'Медицинская информатика',
          type: 'Практическое занятие',
          place: 'Учебный корпус № 2 · компьютерный класс',
          meta: '2 из 8 · учебная неделя 2',
          next: 'Следующее занятие — 16 сентября'
        }
      ]
    },
    {
      label: 'Чт, 10 сентября',
      short: 'Чт 10',
      events: [
        {
          time: '08:00',
          title: 'Биохимия',
          type: 'Практическое занятие',
          place: 'Учебный корпус № 3 · ауд. 214',
          meta: '4 из 12 · учебная неделя 2',
          next: 'Следующее занятие — 14 сентября'
        },
        {
          time: '11:20',
          title: 'Иностранный язык',
          type: 'Практическое занятие',
          place: 'Учебный корпус № 1 · ауд. 117',
          meta: '4 из 14 · учебная неделя 2',
          next: 'Следующее занятие — 15 сентября'
        },
        {
          time: '13:00',
          title: 'ЛЕКЦ. МИКРОБИОЛОГИЯ, ВИРУСОЛОГИЯ',
          type: 'Лекция',
          place: 'Учебный корпус № 1 · ауд. 305',
          meta: '2 из 6 · учебная неделя 2',
          next: 'Следующая лекция — 17 сентября'
        }
      ]
    }
  ];

  let activeDay = 0;
  let timer = null;
  let userInteracting = false;

  preview.classList.add('calendar-preview--interactive');
  preview.setAttribute('aria-label', 'Интерактивный пример расписания на несколько дней');
  preview.setAttribute('aria-live', 'polite');

  const render = () => {
    const day = days[activeDay];
    preview.innerHTML = `
      <div class="preview-head preview-head--interactive">
        <div>
          <span>Пример календаря</span>
          <strong>${day.label}</strong>
        </div>
        <span class="preview-hint">Нажмите на занятие</span>
      </div>
      <div class="preview-day-tabs" role="tablist" aria-label="Дни примера">
        ${days.map((item, index) => `
          <button type="button" class="preview-day-tab${index === activeDay ? ' is-active' : ''}" data-preview-day="${index}" role="tab" aria-selected="${index === activeDay}">${item.short}</button>
        `).join('')}
      </div>
      <div class="preview-events" data-preview-events>
        ${day.events.map((event, index) => `
          <button type="button" class="preview-event preview-event--button" data-preview-event="${index}" aria-expanded="false">
            <time>${event.time}</time>
            <span class="preview-event-main">
              <strong>${event.title}</strong>
              <span>${event.type}</span>
              <span class="preview-event-details" hidden>
                <span>${event.place}</span>
                <span>${event.meta}</span>
                <span>${event.next}</span>
              </span>
            </span>
            <span class="preview-event-chevron" aria-hidden="true">⌄</span>
          </button>
        `).join('')}
      </div>
      <div class="preview-progress" aria-hidden="true"><span></span></div>
    `;

    preview.querySelectorAll('[data-preview-day]').forEach((button) => {
      button.addEventListener('click', () => {
        activeDay = Number(button.dataset.previewDay);
        userInteracting = true;
        stopAuto();
        render();
      });
    });

    preview.querySelectorAll('[data-preview-event]').forEach((button) => {
      button.addEventListener('click', () => {
        userInteracting = true;
        stopAuto();
        const isOpen = button.getAttribute('aria-expanded') === 'true';
        preview.querySelectorAll('[data-preview-event]').forEach((other) => {
          other.setAttribute('aria-expanded', 'false');
          const details = other.querySelector('.preview-event-details');
          if (details) details.hidden = true;
        });
        if (!isOpen) {
          button.setAttribute('aria-expanded', 'true');
          const details = button.querySelector('.preview-event-details');
          if (details) details.hidden = false;
          button.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    });
  };

  const startAuto = () => {
    stopAuto();
    if (userInteracting || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    timer = window.setInterval(() => {
      activeDay = (activeDay + 1) % days.length;
      render();
    }, 4200);
  };

  const stopAuto = () => {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  preview.addEventListener('mouseenter', stopAuto);
  preview.addEventListener('mouseleave', startAuto);
  preview.addEventListener('focusin', stopAuto);

  let touchStartX = null;
  preview.addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0]?.clientX ?? null;
    userInteracting = true;
    stopAuto();
  }, { passive: true });
  preview.addEventListener('touchend', (event) => {
    if (touchStartX === null) return;
    const touchEndX = event.changedTouches[0]?.clientX ?? touchStartX;
    const delta = touchEndX - touchStartX;
    if (Math.abs(delta) > 45) {
      activeDay = delta < 0 ? (activeDay + 1) % days.length : (activeDay - 1 + days.length) % days.length;
      render();
    }
    touchStartX = null;
  }, { passive: true });

  render();
  startAuto();
})();