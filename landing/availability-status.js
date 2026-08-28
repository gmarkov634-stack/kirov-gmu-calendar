(() => {
  const preparedGroups = new Set(["101", "102", "103", "104", "105", "106", "107", "108", "109", "110"]);

  const setText = (node, value) => {
    if (node && node.textContent !== value) node.textContent = value;
  };

  function refresh() {
    for (const card of document.querySelectorAll(".program-card")) {
      if (card.querySelector("h3")?.textContent?.trim() !== "Лечебное дело") continue;
      setText(card.querySelector(".program-badge"), "1 курс подготовлен");
      setText(card.querySelector("p"), "Группы 101–110 · подключение будет открыто после публикации календарей");
    }

    const availability = document.querySelector(".availability");
    setText(availability?.querySelector("strong"), "Новая версия 1 курса лечебного дела подготовлена");
    setText(availability?.querySelector("p"), "Группы 101–110 нормализованы по официальному расписанию от 27.08.2026. Подключение персонального календаря откроется после публикации проверенной версии.");

    setText(document.querySelector("#hero-runtime-note"), "Лечебное дело, 1 курс: группы 101–110 подготовлены по новой версии расписания. Подключение календаря откроется после публикации проверенной версии.");

    const grid = document.querySelector("#choice-grid");
    if (!grid) return;
    for (const card of grid.querySelectorAll(".choice-card")) {
      const title = card.querySelector("strong")?.textContent?.trim() ?? "";
      const note = card.querySelector("small");
      if (title === "1 курс") setText(note, "Группы 101–110 подготовлены");
      const group = title.match(/^Группа\s+(\d+)$/)?.[1];
      if (group && preparedGroups.has(group)) setText(note, "Расписание подготовлено");
    }

    const selected = grid.querySelector(".group-preview");
    const group = selected?.querySelector("h3")?.textContent?.match(/группа\s+(\d+)/i)?.[1];
    if (selected && group && preparedGroups.has(group)) {
      setText(selected.querySelector(".verified-badge"), "Расписание подготовлено");
      setText(selected.querySelector(".preview-empty"), "Новая версия расписания от 27.08.2026 нормализована для этой группы. Персональная ссылка будет выдаваться только после публикации проверенной версии.");
    }
  }

  refresh();
  const grid = document.querySelector("#choice-grid");
  if (grid) new MutationObserver(refresh).observe(grid, { childList: true, subtree: true });
})();
