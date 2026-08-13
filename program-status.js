(() => {
  const data = window.CALENDAR_DATA;
  const cards = [...document.querySelectorAll(".program-card")];
  if (!data?.apiBase || !data?.offer || !Array.isArray(data.faculties) || cards.length !== data.faculties.length) return;

  // Commercial launch state is server-owned. Static frontend data is never
  // allowed to open checkout by itself.
  data.offer.sales = "closed";
  let salesResolved = false;

  function normalizeAcademicYear(value) {
    const match = String(value || "").trim().match(/^(\d{4})[/-](\d{2}|\d{4})$/);
    if (!match) return "";
    const start = Number(match[1]);
    const rawEnd = Number(match[2]);
    const end = match[2].length === 2 ? Math.floor(start / 100) * 100 + rawEnd : rawEnd;
    if (end !== start + 1) return "";
    return `${start}/${String(end).slice(-2)}`;
  }

  function applyCheckoutGate() {
    const form = document.querySelector("#checkout-form");
    if (!form) return;
    const wrapper = form.closest(".checkout-card");
    if (!wrapper) return;
    let note = wrapper.querySelector("[data-sales-gate]");
    const open = data.offer.sales === "open";
    form.hidden = !open;
    if (open) {
      note?.remove();
      return;
    }
    if (!note) {
      note = document.createElement("div");
      note.className = "test-payment-note";
      note.dataset.salesGate = "closed";
      form.before(note);
    }
    note.innerHTML = salesResolved
      ? "<strong>Продажи ещё не открыты</strong><span>Проверенное расписание уже может быть доступно, но коммерческий запуск сервиса пока закрыт.</span>"
      : "<strong>Проверяем готовность запуска…</strong><span>Оплата станет доступна только после подтверждения сервера.</span>";
  }

  function applyCommercialMeta(body) {
    if (body?.paymentMode === "test" || body?.paymentMode === "live") {
      data.offer.testMode = body.paymentMode === "test";
    }
    data.offer.sales = body?.sales === "open" ? "open" : "closed";
    salesResolved = true;
    applyCheckoutGate();
  }

  async function loadCommercialState() {
    try {
      const response = await fetch(`${data.apiBase}/api/v2/meta`, { cache: "no-store" });
      if (!response.ok) throw new Error("meta_unavailable");
      applyCommercialMeta(await response.json());
    } catch {
      applyCommercialMeta({ sales: "closed" });
    }
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

  document.addEventListener("submit", (event) => {
    if (event.target?.id !== "checkout-form" || data.offer.sales === "open") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    applyCheckoutGate();
  }, true);

  const choiceGrid = document.querySelector("#choice-grid");
  if (choiceGrid) {
    new MutationObserver(applyCheckoutGate).observe(choiceGrid, { childList: true, subtree: true });
  }

  void loadCommercialState();
  void loadProgramAvailability();
})();
