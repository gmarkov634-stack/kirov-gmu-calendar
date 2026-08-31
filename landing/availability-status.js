(() => {
  const publishedGroups = new Set([
    "101", "102", "103", "104", "105", "106", "107", "108", "109", "110",
    "111", "112", "113", "114", "115", "116", "117", "118", "119", "120",
    "201", "202", "203", "204", "205", "206", "207", "208", "209", "210",
    "211", "212", "213", "214", "215", "216", "217", "218", "219", "220",
    "301", "302", "303", "304", "305", "306", "307", "308", "309", "310",
    "311", "312", "313", "314", "315", "316", "317",
    "401", "402", "403", "404", "405", "406", "407", "408", "409", "410",
    "411", "412", "413", "414", "415", "416"
  ]);

  const setText = (node, value) => {
    if (node && node.textContent !== value) node.textContent = value;
  };

  function refresh() {
    for (const card of document.querySelectorAll(".program-card")) {
      if (card.querySelector("h3")?.textContent?.trim() !== "Лечебное дело") continue;
      setText(card.querySelector(".program-badge"), "1–4 курсы доступны");
      setText(card.querySelector("p"), "Группы 101–120, 201–220, 301–317 и 401–416 · опубликованы и доступны для 7-дневной бесплатной пробы");
    }

    const availability = document.querySelector(".availability");
    setText(availability?.querySelector("strong"), "Лечебное дело: 1–4 курсы опубликованы");
    setText(availability?.querySelector("p"), "Группы 101–120, 201–220, 301–317 и 401–416 опубликованы по проверенным официальным расписаниям КГМУ и доступны для подключения через 7-дневную бесплатную пробу.");

    setText(document.querySelector("#hero-runtime-note"), "Лечебное дело: группы 101–120, 201–220, 301–317 и 401–416 опубликованы и доступны. Выберите группу и запустите бесплатную пробу на 7 дней.");

    const grid = document.querySelector("#choice-grid");
    if (!grid) return;
    for (const card of grid.querySelectorAll(".choice-card")) {
      const title = card.querySelector("strong")?.textContent?.trim() ?? "";
      const note = card.querySelector("small");
      if (title === "1 курс") setText(note, "Группы 101–120 доступны");
      if (title === "2 курс") setText(note, "Группы 201–220 доступны");
      if (title === "3 курс") setText(note, "Группы 301–317 доступны");
      if (title === "4 курс") setText(note, "Группы 401–416 доступны");
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
