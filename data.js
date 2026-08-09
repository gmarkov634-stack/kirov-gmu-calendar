window.CALENDAR_DATA = {
  university: {
    id: "kgmu",
    shortName: "КГМУ",
    name: "Кировский государственный медицинский университет",
    city: "Киров",
    timezone: "Europe/Moscow",
    brandLetter: "К",
    themeColor: "#1559d6",
  },
  apiBase: "https://kgmu-calendar-api.containerapps.ru",
  offer: { price: "490 ₽", academicYear: "2025/26", semester: 2, expires: "31 августа 2026", testMode: true },
  faculties: [
    { id: "medicine", name: "Лечебный факультет", short: "Лечебное дело", icon: "Л", courses: 6, groups: {} },
    { id: "pediatrics", name: "Педиатрический факультет", short: "Педиатрия", icon: "П", courses: 6, groups: { 1: ["131", "132", "133", "134", "135", "136", "137", "138", "139"] } },
    { id: "dentistry", name: "Стоматологический факультет", short: "Стоматология", icon: "С", courses: 5, groups: {} },
  ],
};
