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

  function revealTrialEmail() {
    const input = grid.querySelector("#runtime-trial-email");
    if (!input || input.dataset.trialEmailAnchorReady === "true") return;

    input.dataset.trialEmailAnchorReady = "true";
    input.dataset.trialEmailAnchor = "true";

    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
    requestAnimationFrame(() => {
      input.scrollIntoView({ block: "center", inline: "nearest" });
    });
  }

  function applyRefinements() {
    ensureManagementSettingsNote();
    revealTrialEmail();
  }

  const observer = new MutationObserver(applyRefinements);
  observer.observe(grid, { childList: true, subtree: true });
  applyRefinements();
})();
