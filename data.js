window.CALENDAR_DATA = {
  university: "kgmu",
  apiBase: "https://kgmu-calendar-api.containerapps.ru",
  offer: {
    academicYear: "2026/27",
    semester: 1,
    testMode: true,
    plans: {
      semester: {
        id: "semester",
        label: "Семестр",
        price: "299 ₽",
        expires: "последнего занятия по официальному расписанию",
        description: "Текущий семестр и все опубликованные обновления расписания.",
      },
      year: {
        id: "year",
        label: "Учебный год",
        price: "499 ₽",
        expires: "31 августа 2027",
        badge: "Выгоднее",
        description: "Осенний и весенний семестры. Новый семестр появится по той же ссылке после публикации и проверки расписания КГМУ.",
      },
    },
  },
  faculties: [
    { id: "medicine", name: "Лечебный факультет", short: "Лечебное дело", icon: "Л", courses: 6, groups: {} },
    { id: "pediatrics", name: "Педиатрический факультет", short: "Педиатрия", icon: "П", courses: 6, groups: {} },
    { id: "dentistry", name: "Стоматологический факультет", short: "Стоматология", icon: "С", courses: 5, groups: {} },
    { id: "foreign", name: "Факультет иностранных обучающихся", short: "Иностранные обучающиеся", icon: "И", courses: 6, groups: {} },
  ],
};
