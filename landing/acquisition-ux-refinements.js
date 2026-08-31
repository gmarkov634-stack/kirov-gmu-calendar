(() => {
  const grid = document.querySelector("#choice-grid");
  if (!grid) return;

  function ensureManagementSettingsNote() {
    const panel = grid.querySelector(".acquisition-personalization");
    if (!panel || panel.querySelector("[data-acquisition-management-note]")) return;

    const note = document.createElement("p");
    note.className = "acquisition-pref-summary acquisition-management-note";
    note.setAttribute("data-acquisition-management-note", "true");
    note.textContent = "Настройки можно изменить позже на странице управления календарём.";
    panel.append(note);
  }

  function revealTrialEmailContainer() {
    const input = grid.querySelector("#runtime-trial-email");
    const card = input?.closest(".trial-connect-card");
    if (!input || !card || card.dataset.trialEmailAnchorReady === "true") return;

    card.dataset.trialEmailAnchorReady = "true";
    card.dataset.trialEmailAnchor = "true";

    requestAnimationFrame(() => {
      card.scrollIntoView({ block: "start", inline: "nearest" });
    });
  }

  function clarifyReusedTrialStatus() {
    const status = grid.querySelector("#runtime-trial-status");
    if (!status || !status.textContent?.includes("Пробный период для этой группы уже существует.")) return;

    const managementLink = status.querySelector("a");
    status.replaceChildren(document.createTextNode(
      "Пробный доступ уже был активирован в этом браузере или с этим email."
    ));
    if (managementLink) status.append(" ", managementLink);
  }

  function applyRefinements() {
    ensureManagementSettingsNote();
    revealTrialEmailContainer();
    clarifyReusedTrialStatus();
  }

  const observer = new MutationObserver(applyRefinements);
  observer.observe(grid, { childList: true, subtree: true });
  applyRefinements();
})();
