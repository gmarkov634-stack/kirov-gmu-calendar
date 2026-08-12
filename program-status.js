(() => {
  const data = window.CALENDAR_DATA;
  const cards = [...document.querySelectorAll(".program-card")];
  if (!data?.apiBase || !data?.offer || !Array.isArray(data.faculties) || cards.length !== data.faculties.length) return;

  function normalizeAcademicYear(value) {
    const match = String(value || "").trim().match(/^(\d{4})[/-](\d{2}|\d{4})$/);
    if (!match) return "";
    const start = Number(match[1]);
    const rawEnd = Number(match[2]);
    const end = match[2].length === 2 ? Math.floor(start / 100) * 100 + rawEnd : rawEnd;
    if (end !== start + 1) return "";
    return `${start}/${String(end).slice(-2)}`;
  }

  async function loadProgramAvailability() {
    try {
      const university = encodeURIComponent(data.university || "kgmu");
      const response = await fetch(`${data.apiBase}/api/v2/catalog/${university}/programs`);
      if (!response.ok) return;
      const body = await response.json();
      if (
        normalizeAcademicYear(body.academicYear) !== normalizeAcademicYear(data.offer.academicYear) ||
        Number(body.semester) !== Number(data.offer.semester) ||
        !Array.isArray(body.programs)
      ) return;

      const availability = new Map(body.programs.map((item) => [
        item?.program,
        Array.isArray(item?.courses) ? item.courses.filter((course) => Number.isInteger(Number(course))) : [],
      ]));

      data.faculties.forEach((faculty, index) => {
        const badge = cards[index]?.querySelector(".program-badge");
        if (!badge) return;
        const courses = availability.get(faculty.id) || [];
        const available = courses.length > 0;
        badge.textContent = available ? "Доступно" : "Ожидаем расписание";
        badge.classList.toggle("is-available", available);
        cards[index].classList.toggle("is-available", available);
      });
    } catch {
      // Fail closed: the static "Ожидаем 2026/27" status remains visible.
    }
  }

  void loadProgramAvailability();
})();
