(() => {
  "use strict";

  const config = window.IZHGMU_CONFIG || {};
  const apiBaseUrl = String(config.apiBaseUrl || "").replace(/\/+$/, "");
  const university = String(config.university || "").trim();
  const program = String(config.program || "").trim();
  const prelaunchCourses = Array.isArray(config.prelaunchCourses)
    ? config.prelaunchCourses.filter((course) => Number.isInteger(course) && course >= 1 && course <= 9)
    : [];

  const courseSelect = document.querySelector("#course-select");
  const groupSelect = document.querySelector("#group-select");
  const catalogStatus = document.querySelector("#catalog-status");
  const selectionStatus = document.querySelector("#selection-status");

  if (!courseSelect || !groupSelect || !catalogStatus || !selectionStatus) return;

  function setStatus(message, tone = "muted") {
    catalogStatus.textContent = message;
    catalogStatus.dataset.tone = tone;
  }

  function setSelection(message = "") {
    selectionStatus.textContent = message;
    selectionStatus.hidden = !message;
  }

  function resetGroups(message = "Группы появятся после проверки расписания 2026/27") {
    groupSelect.replaceChildren(new Option(message, ""));
    groupSelect.disabled = true;
    setSelection();
  }

  function setCourseOptions(courses, enabled) {
    courseSelect.replaceChildren(new Option("Выберите курс", ""));
    for (const course of courses) {
      courseSelect.append(new Option(`${course} курс`, String(course)));
    }
    courseSelect.disabled = !enabled;
  }

  function catalogUrl() {
    return `${apiBaseUrl}/api/v2/catalog/${encodeURIComponent(university)}/programs`;
  }

  function groupsCatalogUrl(course) {
    return `${apiBaseUrl}/api/v2/catalog/${encodeURIComponent(university)}/${encodeURIComponent(program)}/${course}/groups`;
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  function normalizeLiveCourses(programSummary) {
    if (!programSummary || programSummary.program !== program) return [];
    const rawCourses = Array.isArray(programSummary.courses) ? programSummary.courses : [];
    const liveCourses = rawCourses
      .map(Number)
      .filter((course) => Number.isInteger(course) && prelaunchCourses.includes(course));
    return [...new Set(liveCourses)].sort((a, b) => a - b);
  }

  async function loadGroups(course) {
    resetGroups("Загружаем группы…");
    if (!apiBaseUrl || !university || !program || !prelaunchCourses.includes(course)) {
      setStatus("Каталог групп недоступен: безопасный контекст запуска не подтверждён.", "warning");
      return;
    }

    try {
      const response = await fetch(groupsCatalogUrl(course), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const data = await readJson(response);

      if (response.status === 404 && data?.error === "catalog_not_available") {
        resetGroups();
        setStatus("ИжГМУ остаётся в предзапуске. Группы откроются только после серверного разрешения каталога.", "muted");
        return;
      }
      if (!response.ok) throw new Error(`catalog_http_${response.status}`);

      const groups = Array.isArray(data?.groups) ? data.groups : [];
      const safeGroups = groups.filter((item) => item && String(item.groupId || item.groupCode || "").trim());
      if (!safeGroups.length) {
        resetGroups("Для этого курса пока нет опубликованных групп");
        setStatus("Для выбранного курса ещё нет групп, прошедших публикационную проверку.", "muted");
        return;
      }

      groupSelect.replaceChildren(new Option("Выберите группу", ""));
      for (const item of safeGroups) {
        const value = String(item.groupId || item.groupCode).trim();
        const label = String(item.displayName || item.groupCode || item.groupId).trim();
        groupSelect.append(new Option(label, value));
      }
      groupSelect.disabled = false;
      setStatus("Доступны только группы, опубликованные сервером для целевого периода 2026/27.", "success");
    } catch (error) {
      console.error("IzhGMU catalog unavailable", error);
      resetGroups("Группы временно недоступны");
      setStatus("Не удалось подтвердить актуальный каталог. Выбор группы закрыт до восстановления проверки.", "warning");
    }
  }

  async function initializeCatalog() {
    setCourseOptions(prelaunchCourses, false);
    resetGroups();

    if (!apiBaseUrl || !university || !program || prelaunchCourses.length === 0) {
      setStatus("Каталог не настроен. Подключение остаётся закрытым.", "warning");
      return;
    }

    try {
      const response = await fetch(catalogUrl(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const data = await readJson(response);

      if (response.status === 404 && data?.error === "catalog_not_available") {
        setCourseOptions(prelaunchCourses, false);
        setStatus("Предзапуск: курсы 1–3 подготовлены, но сервер ещё не разрешил публичный каталог групп.", "muted");
        return;
      }
      if (!response.ok) throw new Error(`catalog_http_${response.status}`);

      const programs = Array.isArray(data?.programs) ? data.programs : [];
      const medicine = programs.find((item) => item?.program === program);
      const liveCourses = normalizeLiveCourses(medicine);

      if (!liveCourses.length) {
        setCourseOptions(prelaunchCourses, false);
        setStatus("Расписание 2026/27 ещё не дало ни одного курса, доступного для выбора группы.", "muted");
        return;
      }

      setCourseOptions(liveCourses, true);
      setStatus("Каталог 2026/27 подтверждён сервером. Выберите курс, затем опубликованную группу.", "success");
    } catch (error) {
      console.error("IzhGMU catalog unavailable", error);
      setCourseOptions(prelaunchCourses, false);
      resetGroups("Группы временно недоступны");
      setStatus("Не удалось подтвердить актуальность каталога. Выбор остаётся закрытым.", "warning");
    }
  }

  courseSelect.addEventListener("change", () => {
    const course = Number(courseSelect.value);
    if (!prelaunchCourses.includes(course)) {
      resetGroups();
      return;
    }
    loadGroups(course);
  });

  groupSelect.addEventListener("change", () => {
    if (!groupSelect.value) {
      setSelection();
      return;
    }
    const label = groupSelect.options[groupSelect.selectedIndex]?.textContent || "выбранная группа";
    setSelection(`Выбрана ${label}. Подключение и оплата будут доступны только после отдельного запуска коммерческого контура.`);
  });

  initializeCatalog();
})();
