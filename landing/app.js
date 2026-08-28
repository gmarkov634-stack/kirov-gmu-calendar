const config = Object.freeze({
  apiBase: "",
  universityId: "kirov-gmu",
  academicYearId: "2026-2027",
  academicPeriodId: "2026-2027-semester-1",
  catalogUrl: "../catalog/2026-2027-semester-1.json",
  trialEnabled: false,
  managementEnabled: false,
  checkoutEnabled: false,
  ...(globalThis.KGMU_CALENDAR_CONFIG ?? {})
});

const programSelect = document.querySelector("#program-select");
const courseSelect = document.querySelector("#course-select");
const groupSelect = document.querySelector("#group-select");
const selectedGroup = document.querySelector("#selected-group");
const selectedGroupTitle = document.querySelector("#selected-group-title");
const trialForm = document.querySelector("#trial-form");
const trialEmail = document.querySelector("#trial-email");
const trialSubmit = document.querySelector("#trial-submit");
const trialStatus = document.querySelector("#trial-status");
const calendarResult = document.querySelector("#calendar-result");
const calendarUrl = document.querySelector("#calendar-url");
const copyCalendarUrl = document.querySelector("#copy-calendar-url");
const runtimeNote = document.querySelector("#runtime-note");

let catalog = null;
let selected = Object.freeze({ programId: null, course: null, groupId: null });

function apiUrl(path) {
  return new URL(path, config.apiBase || window.location.origin).toString();
}

function absoluteCalendarUrl(calendarPath) {
  return new URL(calendarPath, config.apiBase || window.location.origin).toString();
}

function option(value, label) {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = label;
  return node;
}

function setSelect(select, placeholder, items = []) {
  select.replaceChildren(option("", placeholder));
  for (const item of items) select.append(option(item.value, item.label));
  select.disabled = items.length === 0;
}

function programById(programId) {
  return catalog?.programs?.find((program) => program.programId === programId) ?? null;
}

function updateSelectedGroup() {
  const ready = Boolean(selected.programId && selected.course && selected.groupId);
  selectedGroup.hidden = !ready;
  trialSubmit.disabled = !ready || !config.trialEnabled;

  if (!ready) return;
  const program = programById(selected.programId);
  selectedGroupTitle.textContent = `${program?.displayName ?? selected.programId} · ${selected.course} курс · группа ${selected.groupId}`;

  if (!config.trialEnabled) {
    trialStatus.textContent = "Trial ещё не включён на production. Выбор группы уже работает; выдача ICS будет активирована после backend smoke.";
    trialStatus.className = "form-status";
  } else {
    trialStatus.textContent = "";
    trialStatus.className = "form-status";
  }
}

async function loadCatalog() {
  const response = await fetch(config.catalogUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`catalog_http_${response.status}`);
  const loaded = await response.json();
  if (loaded?.universityId !== config.universityId || !Array.isArray(loaded?.programs)) {
    throw new Error("invalid_catalog");
  }
  catalog = loaded;
  setSelect(programSelect, "Выберите направление", catalog.programs.map((program) => ({
    value: program.programId,
    label: program.displayName
  })));
}

programSelect?.addEventListener("change", () => {
  const program = programById(programSelect.value);
  selected = Object.freeze({ programId: program?.programId ?? null, course: null, groupId: null });
  setSelect(
    courseSelect,
    program ? "Выберите курс" : "Сначала направление",
    program?.courses?.map((entry) => ({ value: String(entry.course), label: `${entry.course} курс` })) ?? []
  );
  setSelect(groupSelect, "Сначала курс");
  updateSelectedGroup();
});

courseSelect?.addEventListener("change", () => {
  const program = programById(selected.programId);
  const course = program?.courses?.find((entry) => String(entry.course) === courseSelect.value) ?? null;
  selected = Object.freeze({
    programId: program?.programId ?? null,
    course: course?.course ?? null,
    groupId: null
  });
  setSelect(
    groupSelect,
    course ? "Выберите группу" : "Сначала курс",
    course?.groupIds?.map((groupId) => ({ value: groupId, label: `Группа ${groupId}` })) ?? []
  );
  updateSelectedGroup();
});

groupSelect?.addEventListener("change", () => {
  selected = Object.freeze({
    ...selected,
    groupId: groupSelect.value || null
  });
  updateSelectedGroup();
});

trialForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!config.trialEnabled) {
    updateSelectedGroup();
    return;
  }
  if (!selected.groupId) {
    trialStatus.textContent = "Сначала выберите группу.";
    trialStatus.className = "form-status error";
    return;
  }

  trialSubmit.disabled = true;
  trialStatus.textContent = "Создаём пробную подписку…";
  trialStatus.className = "form-status";

  try {
    const response = await fetch(apiUrl("/trial"), {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: trialEmail.value.trim(),
        universityId: config.universityId,
        groupId: selected.groupId,
        academicYearId: config.academicYearId,
        academicPeriodId: config.academicPeriodId
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (response.status === 409 && payload.error === "trial_already_exists") {
      trialStatus.innerHTML = 'Trial для этого email и группы уже существует. <a href="./manage/">Открыть управление подпиской</a>.';
      trialStatus.className = "form-status error";
      return;
    }
    if (!response.ok || typeof payload.calendarPath !== "string") {
      if (payload.error === "unavailable_trial_scope") {
        throw new Error("Расписание этой группы ещё не опубликовано для trial.");
      }
      throw new Error("Не удалось создать trial. Попробуйте позже.");
    }

    calendarUrl.value = absoluteCalendarUrl(payload.calendarPath);
    calendarResult.hidden = false;
    trialStatus.textContent = `Trial активирован до ${new Date(payload.trialExpiresAt).toLocaleString("ru-RU")}.`;
    trialStatus.className = "form-status success";
    calendarResult.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    trialStatus.textContent = error instanceof Error ? error.message : "Не удалось создать trial.";
    trialStatus.className = "form-status error";
  } finally {
    trialSubmit.disabled = !selected.groupId || !config.trialEnabled;
  }
});

copyCalendarUrl?.addEventListener("click", async () => {
  if (!calendarUrl.value) return;
  await navigator.clipboard.writeText(calendarUrl.value);
  copyCalendarUrl.textContent = "Скопировано";
  setTimeout(() => { copyCalendarUrl.textContent = "Скопировать"; }, 1800);
});

for (const checkout of document.querySelectorAll("[data-checkout]")) {
  checkout.disabled = !config.checkoutEnabled;
}

if (runtimeNote && config.trialEnabled) {
  runtimeNote.textContent = "7-дневный trial включён. Backend выдаёт подписку только для групп с опубликованной ScheduleVersion.";
}

loadCatalog().catch(() => {
  trialStatus.textContent = "Не удалось загрузить каталог групп. Обновите страницу позже.";
  trialStatus.className = "form-status error";
});
