const days = [
  {
    weekday: "Понедельник",
    date: "7 сентября",
    events: [
      { time: "08:30", title: "ЛЕКЦ. АНАТОМИЯ ЧЕЛОВЕКА", type: "Лекция", place: "Главный корпус, ауд. 1", note: "1 из 12 · учебная неделя 2" },
      { time: "10:10", title: "Нормальная физиология", type: "Практическое занятие", place: "Учебный корпус", note: "2 из 14 · следующее занятие 9 сентября" },
      { time: "12:00", title: "Биохимия", type: "Практическое занятие", place: "Кафедра биохимии", note: "2 из 10 · учебная неделя 2" }
    ]
  },
  {
    weekday: "Вторник",
    date: "8 сентября",
    events: [
      { time: "09:00", title: "Гистология", type: "Практическое занятие", place: "Морфологический корпус", note: "2 из 13 · учебная неделя 2" },
      { time: "11:00", title: "ЛЕКЦ. БИОХИМИЯ", type: "Лекция", place: "Лекционная аудитория", note: "2 из 8 · следующее занятие 15 сентября" },
      { time: "13:00", title: "Иностранный язык", type: "Учебное занятие", place: "Учебный корпус", note: "2 из 16 · учебная неделя 2" }
    ]
  },
  {
    weekday: "Среда",
    date: "9 сентября",
    events: [
      { time: "08:30", title: "Нормальная физиология", type: "Практическое занятие", place: "Учебный корпус", note: "3 из 14 · следующее занятие 14 сентября" },
      { time: "10:30", title: "ЛЕКЦ. ГИСТОЛОГИЯ", type: "Лекция", place: "Морфологический корпус", note: "2 из 9 · учебная неделя 2" },
      { time: "12:30", title: "Анатомия человека", type: "Практическое занятие", place: "Морфологический корпус", note: "3 из 15 · учебная неделя 2" }
    ]
  },
  {
    weekday: "Четверг",
    date: "10 сентября",
    events: [
      { time: "09:00", title: "Биохимия", type: "Практическое занятие", place: "Кафедра биохимии", note: "3 из 10 · учебная неделя 2" },
      { time: "11:00", title: "Медицинская информатика", type: "Учебное занятие", place: "Компьютерный класс", note: "2 из 8 · следующее занятие 17 сентября" }
    ]
  }
];

let currentDay = 0;
const weekday = document.querySelector("#demo-weekday");
const date = document.querySelector("#demo-date");
const events = document.querySelector("#demo-events");
const dialog = document.querySelector("#event-dialog");
const dialogClose = document.querySelector("#dialog-close");

function renderDay() {
  const day = days[currentDay];
  weekday.textContent = day.weekday;
  date.textContent = day.date;
  events.replaceChildren();

  for (const event of day.events) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "demo-event";
    button.innerHTML = `<time>${event.time}</time><div><strong>${event.title}</strong><span>${event.type}</span></div>`;
    button.addEventListener("click", () => openDialog(event));
    events.append(button);
  }
}

function openDialog(event) {
  document.querySelector("#dialog-type").textContent = event.type;
  document.querySelector("#dialog-title").textContent = event.title;
  document.querySelector("#dialog-time").textContent = event.time;
  document.querySelector("#dialog-place").textContent = event.place;
  document.querySelector("#dialog-note").textContent = event.note;
  dialog.hidden = false;
  dialogClose.focus();
}

function closeDialog() {
  dialog.hidden = true;
}

document.querySelector("#prev-day").addEventListener("click", () => {
  currentDay = (currentDay - 1 + days.length) % days.length;
  renderDay();
});

document.querySelector("#next-day").addEventListener("click", () => {
  currentDay = (currentDay + 1) % days.length;
  renderDay();
});

dialogClose.addEventListener("click", closeDialog);
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) closeDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !dialog.hidden) closeDialog();
});

renderDay();
