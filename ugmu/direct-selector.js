(() => {
  const grid = document.querySelector("#choice-grid");
  const title = document.querySelector("#selector-title");
  const kicker = document.querySelector("#step-kicker");
  const backButton = document.querySelector("#back-button");
  if (!grid || !title || !kicker || !backButton) return;

  let syncing = false;

  function oneCardMatching(text) {
    const cards = Array.from(grid.querySelectorAll(".choice-card"));
    if (cards.length !== 1) return null;
    return cards[0].textContent.includes(text) ? cards[0] : null;
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

      if (grid.querySelector(".group-card")) {
        if (title.textContent !== "Выберите свою группу") title.textContent = "Выберите свою группу";
        if (kicker.textContent !== "ОЛД 101–150 · I–IV потоки") kicker.textContent = "ОЛД 101–150 · I–IV потоки";
        backButton.hidden = true;
      }
    } finally {
      syncing = false;
    }
  }

  const observer = new MutationObserver(() => queueMicrotask(normalizeSelector));
  observer.observe(grid, { childList: true, subtree: true });
  normalizeSelector();
})();
