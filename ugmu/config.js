window.UGMU_CONFIG = Object.freeze({
  university: "ugmu",
  universityName: "УГМУ",
  timezone: "Asia/Yekaterinburg",
  apiBaseUrl: "https://kgmu-calendar-api.containerapps.ru",
  paymentPath: "/api/v2/payments",
  trialPath: "/api/v2/trials",
  trialDays: 7,
  defaultPlan: "semester",
  academicYear: "2026/2027",
  semester: 1,
  period: Object.freeze({ start: "2026-09-01", end: "2027-01-10" }),
  sourceSha256: "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8",
  streams: Object.freeze({
    "1": Object.freeze({ label: "I", sourceSha256: "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8" }),
    "2": Object.freeze({ label: "II", sourceSha256: "722300a869f7ecb2939aaa240463ca7b8d6c566c60a98ae90181d67d2c7e44ca" }),
  }),
  program: Object.freeze({ id: "medicine", name: "Лечебное дело", course: 1, stream: "1" }),
  groups: Object.freeze([
    { code: "ОЛД 101", stream: "1", events: 357, lectures: 112, firstClass: ["13:50", "15:20", "Химия", "Декабристов, 32"], lastClass: ["2027-01-09", "13:50", "15:20", "История России", "Н. Онуфриева, 20а"] },
    { code: "ОЛД 102", stream: "1", events: 358, lectures: 112, firstClass: ["13:50", "15:20", "Химия", "Декабристов, 32"], lastClass: ["2027-01-09", "14:00", "16:20", "НИР: ЗОЖ в профессии врача", "Место определяет кафедра"] },
    { code: "ОЛД 103", stream: "1", events: 357, lectures: 112, firstClass: ["13:50", "15:20", "Основы военной подготовки", "Ключевская, 7"], lastClass: ["2027-01-09", "14:40", "17:00", "Ознакомительная практика: уход за больными терапевтического профиля", "Место определяет кафедра"] },
    { code: "ОЛД 104", stream: "1", events: 357, lectures: 112, firstClass: ["13:50", "15:20", "Основы военной подготовки", "Ключевская, 7"], lastClass: ["2027-01-09", "14:40", "17:00", "Ознакомительная практика: уход за больными терапевтического профиля", "Место определяет кафедра"] },
    { code: "ОЛД 105", stream: "1", events: 358, lectures: 112, firstClass: ["12:10", "13:40", "Иностранный язык", "Ключевская, 7"], lastClass: ["2027-01-09", "14:40", "17:00", "Ознакомительная практика: уход за больными терапевтического профиля", "Место определяет кафедра"] },
    { code: "ОЛД 106", stream: "1", events: 357, lectures: 112, firstClass: ["12:10", "13:40", "Иностранный язык", "Ключевская, 7"], lastClass: ["2027-01-09", "14:40", "17:00", "Ознакомительная практика: уход за больными терапевтического профиля", "Место определяет кафедра"] },
    { code: "ОЛД 107", stream: "1", events: 357, lectures: 112, firstClass: ["11:20", "12:50", "Латинский язык", "Ключевская, 7"], lastClass: ["2027-01-09", "13:50", "16:20", "НИР: получение первичных навыков научно-исследовательской работы", "Место определяет кафедра"] },
    { code: "ОЛД 108", stream: "1", events: 357, lectures: 112, firstClass: ["11:20", "12:50", "Латинский язык", "Ключевская, 7"], lastClass: ["2027-01-09", "12:10", "13:40", "Иностранный язык", "Ключевская, 7"] },
    { code: "ОЛД 109", stream: "1", events: 357, lectures: 112, firstClass: ["13:00", "14:30", "Латинский язык", "Ключевская, 7"], lastClass: ["2027-01-09", "13:50", "15:20", "История России", "Н. Онуфриева, 20а"] },
    { code: "ОЛД 110", stream: "1", events: 357, lectures: 112, firstClass: ["13:00", "14:30", "Латинский язык", "Ключевская, 7"], lastClass: ["2027-01-09", "13:50", "15:20", "История России", "Н. Онуфриева, 20а"] },
    { code: "ОЛД 111", stream: "1", events: 357, lectures: 112, firstClass: ["16:10", "17:40", "Иностранный язык", "Ключевская, 7"], lastClass: ["2027-01-09", "13:00", "14:40", "НИР: ЗОЖ в профессии врача", "Место определяет кафедра"] },
    { code: "ОЛД 112", stream: "1", events: 357, lectures: 112, firstClass: ["15:30", "17:00", "Химия", "Декабристов, 32"], lastClass: ["2027-01-09", "12:10", "13:40", "Иностранный язык", "Ключевская, 7"] },
    { code: "ОЛД 113", stream: "2", events: 358 },
    { code: "ОЛД 114", stream: "2", events: 339 },
    { code: "ОЛД 115", stream: "2", events: 356 },
    { code: "ОЛД 116", stream: "2", events: 356 },
    { code: "ОЛД 117", stream: "2", events: 357 },
    { code: "ОЛД 118", stream: "2", events: 357 },
    { code: "ОЛД 119", stream: "2", events: 357 },
    { code: "ОЛД 120", stream: "2", events: 357 },
    { code: "ОЛД 121", stream: "2", events: 357 },
    { code: "ОЛД 122", stream: "2", events: 357 },
    { code: "ОЛД 123", stream: "2", events: 356 },
    { code: "ОЛД 124", stream: "2", events: 356 }
  ])
});

function pinUgmuSelectorAfterGroupChoice() {
  const selector = document.querySelector("#selector");
  if (!selector) return;
  const topbar = document.querySelector(".topbar");
  const topbarHeight = topbar ? topbar.getBoundingClientRect().height : 68;
  const desiredGap = 28;
  const selectorDocumentTop = window.scrollY + selector.getBoundingClientRect().top;
  const targetTop = selectorDocumentTop - topbarHeight - desiredGap;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
}

document.addEventListener("click", (event) => {
  const groupCard = event.target.closest?.(".group-card");
  if (!groupCard) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(pinUgmuSelectorAfterGroupChoice);
  });
  setTimeout(pinUgmuSelectorAfterGroupChoice, 100);
  setTimeout(pinUgmuSelectorAfterGroupChoice, 260);
}, true);
