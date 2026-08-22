(() => {
  const config = window.UGMU_CONFIG;
  const grid = document.querySelector("#choice-grid");
  const title = document.querySelector("#selector-title");
  const kicker = document.querySelector("#step-kicker");
  const backButton = document.querySelector("#back-button");
  if (!config || !grid || !title || !kicker || !backButton) return;

  const roman = Object.freeze({ "1": "I", "2": "II", "3": "III", "4": "IV" });
  const groupByCode = new Map(config.groups.map((group) => [group.code, group]));
  const initialRequestedNumber = new URLSearchParams(window.location.search).get("group") || "";
  const initialRequestedGroupCode = `ОЛД ${initialRequestedNumber}`;
  let directGroupPending = groupByCode.has(initialRequestedGroupCode);
  let syncing = false;
  let activeStream = "";

  function oneCardMatching(text) {
    const cards = Array.from(grid.querySelectorAll(".choice-card"));
    if (cards.length !== 1) return null;
    return cards[0].textContent.includes(text) ? cards[0] : null;
  }

  function groupCodeForCard(card) {
    const match = card.textContent.match(/ОЛД\s+(\d{3})/);
    return match ? `ОЛД ${match[1]}` : "";
  }

  function groupForCard(card) {
    return groupByCode.get(groupCodeForCard(card)) || null;
  }

  function currentGroupCards() {
    return Array.from(grid.querySelectorAll(".group-card"));
  }

  function streamGroups(cards) {
    const result = new Map();
    cards.forEach((card) => {
      const group = groupForCard(card);
      if (!group?.stream) return;
      const key = String(group.stream);
      if (!result.has(key)) result.set(key, []);
      result.get(key).push({ card, group });
    });
    return result;
  }

  function rangeLabel(items) {
    const numbers = items
      .map(({ group }) => Number(String(group.code).replace(/\D+/g, "")))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (!numbers.length) return "";
    const first = numbers[0];
    const last = numbers[numbers.length - 1];
    return first === last ? `ОЛД ${first}` : `ОЛД ${first}–${last}`;
  }

  function removeStreamCards() {
    grid.querySelectorAll(".stream-card[data-ugmu-stream-selector]").forEach((card) => card.remove());
  }

  function makeStreamCard(stream, items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-card stream-card";
    button.dataset.ugmuStreamSelector = "1";

    const icon = document.createElement("span");
    icon.className = "card-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = roman[stream] || stream;

    const strong = document.createElement("strong");
    strong.textContent = `${roman[stream] || stream} поток`;

    const small = document.createElement("small");
    small.textContent = `${rangeLabel(items)} · ${items.length} групп`;

    button.append(icon, strong, small);
    button.addEventListener("click", () => showStreamGroups(stream));
    return button;
  }

  function showStreamSelector(cards = currentGroupCards()) {
    const grouped = streamGroups(cards);
    if (grouped.size <= 1) return false;

    activeStream = "";
    cards.forEach((card) => { card.hidden = true; });

    const existing = grid.querySelectorAll(".stream-card[data-ugmu-stream-selector]");
    if (existing.length !== grouped.size) {
      removeStreamCards();
      Array.from(grouped.entries())
        .sort(([left], [right]) => Number(left) - Number(right))
        .forEach(([stream, items]) => grid.append(makeStreamCard(stream, items)));
    }

    title.textContent = "Выберите поток";
    kicker.textContent = "ОЛД 101–150 · I–IV потоки";
    backButton.hidden = true;
    return true;
  }

  function showStreamGroups(stream, cards = currentGroupCards()) {
    activeStream = String(stream);
    removeStreamCards();

    const visibleItems = [];
    cards.forEach((card) => {
      const group = groupForCard(card);
      const visible = String(group?.stream || "") === activeStream;
      card.hidden = !visible;
      if (visible && group) visibleItems.push({ card, group });
    });

    title.textContent = "Выберите свою группу";
    kicker.textContent = `${roman[activeStream] || activeStream} поток · ${rangeLabel(visibleItems)}`;
    backButton.textContent = "← К потокам";
    backButton.hidden = false;
  }

  function openInitialRequestedGroup(groupCards) {
    if (!directGroupPending || groupCards.length !== config.groups.length) return false;
    directGroupPending = false;
    const requestedCard = groupCards.find((card) => groupCodeForCard(card) === initialRequestedGroupCode);
    if (!requestedCard) return false;
    requestedCard.click();
    return true;
  }

  function normalizeSelector() {
    if (syncing) return;
    syncing = true;
    try {
      for (let pass = 0; pass < 3; pass += 1) {
        const heading = title.textContent.trim();
        const faculty = heading === "Выберите направление" ? oneCardMatching("Лечебное дело") : null;
        if (faculty) {
          faculty.click();
          continue;
        }

        const course = heading === "Лечебное дело" ? oneCardMatching("1 курс") : null;
        if (course) {
          course.click();
          continue;
        }
        break;
      }

      const groupCards = currentGroupCards();
      if (!groupCards.length) {
        if (grid.querySelector(".access-card")) directGroupPending = false;
        return;
      }

      if (openInitialRequestedGroup(groupCards)) return;

      if (activeStream) showStreamGroups(activeStream, groupCards);
      else showStreamSelector(groupCards);
    } finally {
      syncing = false;
    }
  }

  backButton.addEventListener("click", (event) => {
    const groupCards = currentGroupCards();
    if (!activeStream || !groupCards.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showStreamSelector(groupCards);
  }, true);

  const observer = new MutationObserver(() => queueMicrotask(normalizeSelector));
  observer.observe(grid, { childList: true });
  normalizeSelector();
})();
