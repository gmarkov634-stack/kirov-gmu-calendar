(() => {
  const data = window.CALENDAR_DATA;
  const university = data?.university;
  if (!university?.id) throw new Error("CALENDAR_DATA.university.id is required");

  document.documentElement.dataset.university = university.id;
  document.title = `Календарь ${university.shortName}`;

  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta && university.themeColor) themeMeta.content = university.themeColor;

  const descriptionMeta = document.querySelector('meta[name="description"]');
  if (descriptionMeta) {
    descriptionMeta.content = `Электронное расписание и календари студентов ${university.shortName}`;
  }

  const brandMark = document.querySelector(".brand-mark");
  if (brandMark) brandMark.textContent = university.brandLetter || university.shortName.slice(0, 1);

  const brandTitle = document.querySelector(".brand strong");
  if (brandTitle) brandTitle.textContent = `Календарь ${university.shortName}`;

  document.querySelectorAll("[data-university-short]").forEach((element) => {
    element.textContent = university.shortName;
  });

  document.querySelectorAll("[data-university-name]").forEach((element) => {
    element.textContent = university.name;
  });

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const isPaymentRequest = url.endsWith("/api/v1/payments") && String(init.method || "GET").toUpperCase() === "POST";

    if (!isPaymentRequest || typeof init.body !== "string") return nativeFetch(input, init);

    try {
      const body = JSON.parse(init.body);
      return nativeFetch(input, {
        ...init,
        body: JSON.stringify({ university: university.id, ...body }),
      });
    } catch {
      return nativeFetch(input, init);
    }
  };
})();
