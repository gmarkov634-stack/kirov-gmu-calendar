(() => {
  const config = window.UGMU_CONFIG;
  if (!config || config.university !== "ugmu") return;

  const groupSelect = document.querySelector("#group-select");
  const groupSummary = document.querySelector("#group-summary");
  const eventCount = document.querySelector("#event-count");
  const lectureCount = document.querySelector("#lecture-count");
  const preview = document.querySelector("#group-preview");
  const sourceState = document.querySelector("#source-state");
  const groupMap = new Map(config.groups.map((group) => [group.code, group]));

  function humanDate(value) {
    const date = new Date(`${value}T00:00:00`);
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  }

  function eventMarkup(date, start, end, title, location, type) {
    const label = type === "lecture" ? `Лекция · ${location}` : location;
    return `<article class="qa-event"><time>${humanDate(date)}<br>${start}–${end}</time><div><strong>${title}</strong><span>${label}</span></div></article>`;
  }

  function renderGroup(code) {
    const group = groupMap.get(code) || config.groups[0];
    groupSelect.value = group.code;
    groupSummary.textContent = `${group.code} · 1 курс · I поток`;
    eventCount.textContent = String(group.events);
    lectureCount.textContent = String(group.lectures);
    preview.innerHTML = [
      eventMarkup("2026-09-01", "08:50", "10:20", "ЛЕКЦ. ХИМИЯ", "Онлайн", "lecture"),
      eventMarkup("2026-09-01", group.firstClass[0], group.firstClass[1], group.firstClass[2], group.firstClass[3], "other"),
      eventMarkup(group.lastClass[0], group.lastClass[1], group.lastClass[2], group.lastClass[3], group.lastClass[4], "other"),
    ].join("");
    const params = new URLSearchParams(window.location.search);
    params.set("group", group.code.replace("ОЛД ", ""));
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}#preview`);
  }

  for (const group of config.groups) {
    const option = document.createElement("option");
    option.value = group.code;
    option.textContent = group.code;
    groupSelect.append(option);
  }

  sourceState.textContent = `Источник проверен · ${config.academicYear} · SHA-256 ${config.sourceSha256.slice(0, 12)}…`;
  const requested = new URLSearchParams(window.location.search).get("group");
  const requestedCode = requested && /^10[1-9]$|^11[0-2]$/.test(requested) ? `ОЛД ${requested}` : config.groups[0].code;
  renderGroup(requestedCode);
  groupSelect.addEventListener("change", () => renderGroup(groupSelect.value));
})();
