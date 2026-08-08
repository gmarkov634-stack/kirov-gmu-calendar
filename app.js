const data = window.CALENDAR_DATA;
const grid = document.querySelector("#choice-grid");
const title = document.querySelector("#selector-title");
const kicker = document.querySelector("#step-kicker");
const backButton = document.querySelector("#back-button");
const notice = document.querySelector("#notice");
const state = { step: "faculty", faculty: null, course: null };
const stepOrder = ["faculty", "course", "group"];

function makeCard({ icon, title: cardTitle, subtitle, className = "", onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `choice-card ${className}`.trim();
  button.innerHTML = `<span class="card-icon" aria-hidden="true">${icon}</span><strong>${cardTitle}</strong><small>${subtitle}</small>`;
  button.addEventListener("click", onClick);
  return button;
}

function setStep(step) {
  state.step = step;
  const activeIndex = stepOrder.indexOf(step);
  document.querySelectorAll("[data-step-indicator]").forEach((element, index) => {
    element.classList.toggle("is-active", index === activeIndex);
    element.classList.toggle("is-complete", index < activeIndex);
  });
  kicker.textContent = `Шаг ${activeIndex + 1} из 3`;
  backButton.hidden = step === "faculty";
  notice.hidden = true;
  render();
}

function renderFaculties() {
  title.textContent = "Выберите факультет";
  data.faculties.forEach((faculty) => grid.append(makeCard({
    icon: faculty.icon,
    title: faculty.name,
    subtitle: `${faculty.short} · ${faculty.courses} курсов`,
    onClick: () => { state.faculty = faculty; state.course = null; setStep("course"); },
  })));
}

function renderCourses() {
  title.textContent = state.faculty.name;
  for (let course = 1; course <= state.faculty.courses; course += 1) {
    const groups = state.faculty.groups[course] || [];
    grid.append(makeCard({
      icon: course,
      title: `${course} курс`,
      subtitle: groups.length ? `${groups.length} групп доступно` : "Раздел подготовлен",
      onClick: () => { state.course = course; setStep("group"); },
    }));
  }
}

function renderGroups() {
  title.textContent = `${state.faculty.short} · ${state.course} курс`;
  const groups = state.faculty.groups[state.course] || [];
  if (!groups.length) {
    notice.hidden = false;
    notice.textContent = "Группы этого курса будут добавлены после загрузки соответствующего расписания.";
    return;
  }
  groups.forEach((group) => {
    const key = `${state.faculty.id}-${state.course}-${group}`;
    const calendarUrl = data.calendars[key];
    grid.append(makeCard({
      icon: "№",
      title: `Группа ${group}`,
      subtitle: calendarUrl ? "Открыть календарь" : "Календарь готовится к подключению",
      className: "group-card",
      onClick: () => {
        if (calendarUrl) { window.location.href = calendarUrl; return; }
        notice.hidden = false;
        notice.textContent = `Группа ${group} найдена. Ссылка на её календарь появится после импорта расписания в Cloud.ru.`;
        notice.scrollIntoView({ behavior: "smooth", block: "nearest" });
      },
    }));
  });
}

function render() {
  grid.replaceChildren();
  if (state.step === "faculty") renderFaculties();
  if (state.step === "course") renderCourses();
  if (state.step === "group") renderGroups();
}

backButton.addEventListener("click", () => { if (state.step === "group") setStep("course"); else setStep("faculty"); });
render();
