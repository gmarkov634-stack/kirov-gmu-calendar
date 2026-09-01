(() => {
  const grid = document.querySelector("#choice-grid");
  if (!grid) return;

  let stagedPanel = null;
  let stagedGroupId = null;

  function formGroupId(form) {
    const heading = form?.closest(".trial-connect-card")?.querySelector("h3")?.textContent ?? "";
    return /групп(?:а|ы)\s+(\d+)/i.exec(heading)?.[1] ?? null;
  }

  function stagePreviewPersonalization() {
    const preview = grid.querySelector(".group-preview");
    const panel = preview?.querySelector(".acquisition-personalization");
    if (!panel) return;

    stagedPanel = panel;
    stagedGroupId = panel.dataset.acquisitionPersonalization ?? null;
    panel.hidden = true;
    panel.dataset.personalizationStaged = "true";
  }

  function updatePanelCopy(panel, form, groupId) {
    const kicker = panel.querySelector(".acquisition-personalization-head .section-kicker");
    const heading = panel.querySelector(".acquisition-personalization-head h4");
    const lead = panel.querySelector(".acquisition-personalization-head p:last-child");
    const isTrial = form.id === "runtime-trial-form";

    if (kicker) kicker.textContent = "Персонализация";
    if (heading) heading.textContent = "Настройте календарь";
    if (lead) {
      lead.textContent = isTrial
        ? `Настройки сохранятся в пробной подписке группы ${groupId} и сразу применятся к этой же ICS-ссылке.`
        : `Настройки сохранятся для группы ${groupId} и применятся к календарю после подтверждения оплаты.`;
    }
  }

  function mountPersonalizationAtEmailStep() {
    const form = grid.querySelector("#runtime-trial-form, #runtime-checkout-form");
    if (!form || !stagedPanel) return;
    if (form.querySelector(".acquisition-personalization")) return;

    const groupId = formGroupId(form);
    if (!groupId || (stagedGroupId && stagedGroupId !== groupId)) return;

    stagedPanel.hidden = false;
    stagedPanel.dataset.personalizationStaged = "false";
    stagedPanel.dataset.personalizationEmailStep = form.id === "runtime-trial-form" ? "trial" : "checkout";
    updatePanelCopy(stagedPanel, form, groupId);

    const submit = form.querySelector('button[type="submit"]');
    if (submit) form.insertBefore(stagedPanel, submit);
    else form.append(stagedPanel);
  }

  function syncPersonalizationPlacement() {
    stagePreviewPersonalization();
    mountPersonalizationAtEmailStep();
  }

  const observer = new MutationObserver(syncPersonalizationPlacement);
  observer.observe(grid, { childList: true, subtree: true });
  syncPersonalizationPlacement();
})();
