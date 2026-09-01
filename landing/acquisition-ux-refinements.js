(() => {
  const grid = document.querySelector("#choice-grid");
  if (!grid) return;

  function installPreChoicePersonalizationGuard() {
    if (document.querySelector("style[data-email-step-personalization-guard]")) return;
    const style = document.createElement("style");
    style.dataset.emailStepPersonalizationGuard = "";
    style.textContent = ".group-preview > .acquisition-personalization { display:none !important; }";
    document.head.append(style);
  }

  function suppressPreChoicePersonalization() {
    const panel = grid.querySelector(".group-preview > .acquisition-personalization");
    if (!panel) return;

    const marker = document.createElement("span");
    marker.hidden = true;
    marker.dataset.acquisitionPersonalization = panel.dataset.acquisitionPersonalization ?? "";
    marker.dataset.emailStepPersonalizationPlaceholder = "true";
    panel.replaceWith(marker);
  }

  function ensureManagementSettingsNote() {
    const panel = grid.querySelector(".trial-personalization, .acquisition-personalization");
    if (!panel || panel.querySelector("[data-acquisition-management-note]")) return;

    const note = document.createElement("p");
    note.className = "acquisition-pref-summary acquisition-management-note";
    note.setAttribute("data-acquisition-management-note", "true");
    note.textContent = "Настройки можно изменить позже на странице управления календарём.";
    panel.append(note);
  }

  function ensureIphoneReminderGuidance() {
    const iphone = grid.querySelector('a.calendar-device-action[href^="webcal://"]');
    const actions = iphone?.closest(".connect-actions");
    if (!iphone || !actions || actions.parentElement?.querySelector("[data-iphone-reminder-guidance]")) return;

    const note = document.createElement("p");
    note.className = "acquisition-pref-summary iphone-reminder-guidance";
    note.setAttribute("data-iphone-reminder-guidance", "true");
    note.textContent = "На iPhone на экране «Сведения о подписке» выключите «Удаление напоминаний». Иначе iOS удалит уведомления из подписного календаря.";
    actions.insertAdjacentElement("afterend", note);
  }

  function revealEmailContainer() {
    const input = grid.querySelector("#runtime-trial-email, #runtime-checkout-email");
    const card = input?.closest(".trial-connect-card");
    if (!input || !card || card.dataset.emailAnchorReady === "true") return;

    card.dataset.emailAnchorReady = "true";
    card.dataset.emailAnchor = "true";
    if (input.id === "runtime-trial-email") {
      card.dataset.trialEmailAnchorReady = "true";
      card.dataset.trialEmailAnchor = "true";
    }

    requestAnimationFrame(() => {
      card.scrollIntoView({ block: "start", inline: "nearest" });
    });
  }

  function applyRefinements() {
    suppressPreChoicePersonalization();
    ensureManagementSettingsNote();
    ensureIphoneReminderGuidance();
    revealEmailContainer();
  }

  installPreChoicePersonalizationGuard();
  const observer = new MutationObserver(applyRefinements);
  observer.observe(grid, { childList: true, subtree: true });
  applyRefinements();
})();
