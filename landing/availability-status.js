(() => {
  const publishedGroups = new Set([
    "101", "102", "103", "104", "105", "106", "107", "108", "109", "110",
    "111", "112", "113", "114", "115", "116", "117", "118", "119", "120"
  ]);

  const setText = (node, value) => {
    if (node && node.textContent !== value) node.textContent = value;
  };

  function refresh() {
    for (const card of document.querySelectorAll(".program-card")) {
      if (card.querySelector("h3")?.textContent?.trim() !== "Лечебное дело") continue;
      setText(card.querySelector(".program-badge"), "1 курс доступен");
      setText(card.querySelector("p"), "Группы 101–120 · опубликованы и доступны для 7-дневной бесплатной пробы");
    }

    const availability = document.querySelector(".availability");
    setText(availability?.querySelector("strong"), "Лечебное дело, 1 курс — опубликовано");
    setText(availability?.querySelector("p"), "Группы 101–120 опубликованы по проверенным официальным расписаниям и доступны для подключения через 7-дневную бесплатную пробу.");

    setText(document.querySelector("#hero-runtime-note"), "Лечебное дело, 1 курс: группы 101–120 опубликованы и доступны. Выберите группу и запустите бесплатную пробу на 7 дней.");

    const grid = document.querySelector("#choice-grid");
    if (!grid) return;
    for (const card of grid.querySelectorAll(".choice-card")) {
      const title = card.querySelector("strong")?.textContent?.trim() ?? "";
      const note = card.querySelector("small");
      if (title === "1 курс") setText(note, "Группы 101–120 доступны");
      const group = title.match(/^Группа\s+(\d+)$/)?.[1];
      if (group && publishedGroups.has(group)) setText(note, "Расписание опубликовано");
    }

    const selected = grid.querySelector(".group-preview");
    const group = selected?.querySelector("h3")?.textContent?.match(/группа\s+(\d+)/i)?.[1];
    if (selected && group && publishedGroups.has(group)) {
      setText(selected.querySelector(".verified-badge"), "Расписание опубликовано");
      setText(selected.querySelector(".preview-empty"), "Проверенная версия расписания опубликована для этой группы. Можно запустить 7-дневную бесплатную пробу и получить персональную ICS-ссылку.");
    }
  }

  refresh();
  const grid = document.querySelector("#choice-grid");
  if (grid) new MutationObserver(refresh).observe(grid, { childList: true, subtree: true });
})();
