(() => {
  const config = window.UGMU_CONFIG;
  const grid = document.querySelector("#choice-grid");
  const title = document.querySelector("#selector-title");
  const kicker = document.querySelector("#step-kicker");
  const backButton = document.querySelector("#back-button");
  const heroRuntimeNote = document.querySelector("#hero-runtime-note");
  if (!config || !grid || !title || !kicker || !backButton) return;

  const roman = Object.freeze({ "1": "I", "2": "II", "3": "III", "4": "IV" });
  const groupByCode = new Map(config.groups.map((group) => [group.code, group]));
  const initialRequestedNumber = new URLSearchParams(window.location.search).get("group") || "";
  const initialRequestedGroupCode = `ОЛД ${initialRequestedNumber}`;
  let directGroupPending = groupByCode.has(initialRequestedGroupCode);
  let syncing = false;
  let allGroupCards = [];
  let activeStream = "";
  let touchCard = null;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoved = false;

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

  function makeStreamCard(stream, items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-card stream-card";

    const icon = document.createElement("span");
    icon.className = "card-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = roman[stream] || stream;

    const strong = document.createElement("strong");
    strong.textContent = `${roman[stream] || stream} поток`;

    const small = document.createElement("small");
    small.textContent = `${rangeLabel(items)} · ${items.length} групп`;

    button.append(icon, strong, small);
    button.addEventListener("click", () => showStreamGroups(stream, items.map(({ card }) => card)));
    return button;
  }

  function showStreamSelector(cards) {
    const grouped = streamGroups(cards);
    if (grouped.size <= 1) return false;

    allGroupCards = cards;
    activeStream = "";
    grid.replaceChildren();
    Array.from(grouped.entries())
      .sort(([left], [right]) => Number(left) - Number(right))
      .forEach(([stream, items]) => grid.append(makeStreamCard(stream, items)));

    title.textContent = "Выберите поток";
    kicker.textContent = "ОЛД 101–150 · I–IV потоки";
    backButton.hidden = true;
    return true;
  }

  function showStreamGroups(stream, cards) {
    activeStream = String(stream);
    grid.replaceChildren(...cards);
    const items = cards.map((card) => ({ card, group: groupForCard(card) })).filter(({ group }) => group);
    title.textContent = "Выберите свою группу";
    kicker.textContent = `${roman[activeStream] || activeStream} поток · ${rangeLabel(items)}`;
    backButton.textContent = "← К потокам";
    backButton.hidden = false;
  }

  function normalizeAccessCopy() {
    const accessKicker = grid.querySelector(".access-card .section-kicker");
    if (!accessKicker) return;
    directGroupPending = false;
    const requested = new URLSearchParams(window.location.search).get("group") || "";
    const group = groupByCode.get(`ОЛД ${requested}`);
    if (!group) return;
    accessKicker.textContent = `Лечебное дело · 1 курс · ${roman[String(group.stream)] || group.stream} поток`;
  }

  function normalizeRuntimeCopy() {
    if (!heroRuntimeNote) return;
    if (heroRuntimeNote.textContent.includes("ОЛД 101–112")) {
      heroRuntimeNote.textContent = heroRuntimeNote.textContent.replace("ОЛД 101–112", "ОЛД 101–150");
    }
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
      normalizeRuntimeCopy();
      normalizeAccessCopy();

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

      const groupCards = Array.from(grid.querySelectorAll(".group-card"));
      if (!groupCards.length) return;

      if (openInitialRequestedGroup(groupCards)) return;

      if (groupCards.length === config.groups.length) {
        showStreamSelector(groupCards);
        return;
      }

      if (activeStream) {
        const items = groupCards.map((card) => ({ card, group: groupForCard(card) })).filter(({ group }) => group);
        title.textContent = "Выберите свою группу";
        kicker.textContent = `${roman[activeStream] || activeStream} поток · ${rangeLabel(items)}`;
        backButton.textContent = "← К потокам";
        backButton.hidden = false;
      }
    } finally {
      syncing = false;
    }
  }

  function resetTouchState() {
    touchCard = null;
    touchMoved = false;
  }

  grid.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) {
      resetTouchState();
      return;
    }
    const card = event.target.closest(".group-card");
    if (!card || !grid.contains(card)) {
      resetTouchState();
      return;
    }
    touchCard = card;
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
    touchMoved = false;
  }, { passive: true });

  grid.addEventListener("touchmove", (event) => {
    if (!touchCard || event.touches.length !== 1) return;
    const dx = event.touches[0].clientX - touchStartX;
    const dy = event.touches[0].clientY - touchStartY;
    if (Math.hypot(dx, dy) > 12) touchMoved = true;
  }, { passive: true });

  grid.addEventListener("touchend", (event) => {
    const card = touchCard;
    const shouldActivate = Boolean(card && !touchMoved && grid.contains(card));
    resetTouchState();
    if (!shouldActivate) return;
    event.preventDefault();
    card.click();
  }, { passive: false });

  grid.addEventListener("touchcancel", resetTouchState, { passive: true });

  backButton.addEventListener("click", (event) => {
    if (!activeStream || !grid.querySelector(".group-card") || !allGroupCards.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showStreamSelector(allGroupCards);
  }, true);

  const observer = new MutationObserver(() => queueMicrotask(normalizeSelector));
  observer.observe(grid, { childList: true, subtree: true });
  if (heroRuntimeNote) {
    const runtimeObserver = new MutationObserver(() => queueMicrotask(normalizeRuntimeCopy));
    runtimeObserver.observe(heroRuntimeNote, { childList: true, characterData: true, subtree: true });
  }
  normalizeSelector();
})();
