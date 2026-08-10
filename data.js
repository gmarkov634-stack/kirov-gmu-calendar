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
        expires: "31 января 2027",
        description: "Текущий семестр и все официальные обновления расписания.",
      },
      year: {
        id: "year",
        label: "Учебный год",
        price: "499 ₽",
        expires: "31 августа 2027",
        badge: "Выгоднее",
        description: "Осенний и весенний семестры. Новое расписание появится автоматически после публикации КГМУ.",
      },
    },
  },
  faculties: [
    { id: "medicine", name: "Лечебный факультет", short: "Лечебное дело", icon: "Л", courses: 6, groups: {} },
    { id: "pediatrics", name: "Педиатрический факультет", short: "Педиатрия", icon: "П", courses: 6, groups: { 1: ["131", "132", "133", "134", "135", "136", "137", "138", "139"] } },
    { id: "dentistry", name: "Стоматологический факультет", short: "Стоматология", icon: "С", courses: 5, groups: {} },
  ],
};
