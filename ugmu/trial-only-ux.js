(() => {
  const config = window.UGMU_CONFIG;
  if (!config || config.university !== "ugmu") return;

  const form = document.querySelector("#order-form");
  const emailInput = document.querySelector("#email");
  const submit = form?.querySelector('button[type="submit"]');
  const restoreOrderButton = document.querySelector("#restore-order");
  const trialStatus = document.querySelector("#trial-status");
  const formStatus = document.querySelector("#form-status");
  const groupSelect = document.querySelector("#group-select");
  const resultPanel = document.querySelector("#order-result");
  if (!form || !emailInput || !submit) return;

  const emailField = emailInput.closest("label");
  const emailNote = emailField?.nextElementSibling?.classList.contains("note")
    ? emailField.nextElementSibling
    : null;
  const savedOrderKey = "ugmu-calendar-orders-v1";
  const token = /^[A-Za-z0-9_-]{43}$/;
  const orderId = /^[A-Za-z0-9_-]{32}$/;
  const continueId = new URLSearchParams(window.location.search).get("continue") || "";
  let meta = null;

  function validHttpsUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "https:" && !url.username && !url.password;
    } catch {
      return false;
    }
  }

  function paidAvailable() {
    return meta?.sales === "open" && meta?.paymentMode === "live";
  }

  function setPaidControlsVisible(visible) {
    if (emailField) emailField.hidden = !visible;
    if (emailNote) emailNote.hidden = !visible;
    submit.hidden = !visible;
  }

  function selectedGroupLabel() {
    const value = String(groupSelect?.value || "").trim();
    return value || "выбранной группы";
  }

  function applyContinueCopy() {
    if (!token.test(continueId) || !meta || paidAvailable()) return;
    const group = selectedGroupLabel();
    const trialCopy = "Пробная неделя уже использована. Ваша группа сохранена.";
    const fullAccessCopy = `Полный доступ для УГМУ пока закрыт. Когда продажи откроются, можно будет продолжить с группы ${group}.`;
    if (trialStatus && trialStatus.textContent !== trialCopy) trialStatus.textContent = trialCopy;
    if (formStatus && formStatus.textContent !== fullAccessCopy) formStatus.textContent = fullAccessCopy;
  }

  function applyTrialResultCopy() {
    if (!resultPanel || !meta || paidAvailable() || resultPanel.hidden) return;
    const heading = resultPanel.querySelector("h3");
    if (heading?.textContent !== "Пробный календарь готов") return;
    for (const button of resultPanel.querySelectorAll("button")) {
      if (button.textContent?.trim() === "Перейти к полному доступу") button.hidden = true;
    }
    if (!resultPanel.querySelector("[data-trial-only-note]")) {
      const note = document.createElement("p");
      note.className = "note";
      note.dataset.trialOnlyNote = "true";
      note.textContent = "Полный доступ УГМУ пока закрыт. Группа сохранена — когда продажи откроются, можно будет продолжить с неё.";
      resultPanel.append(note);
    }
  }

  function applyTrialOnlyUi() {
    setPaidControlsVisible(paidAvailable());
    applyContinueCopy();
    applyTrialResultCopy();
  }

  function readLatestSavedOrder() {
    try {
      const values = JSON.parse(localStorage.getItem(savedOrderKey) || "[]");
      if (!Array.isArray(values)) return null;
      const candidate = values.find((item) => orderId.test(String(item?.orderId || "")) && token.test(String(item?.accessToken || "")));
      return candidate || null;
    } catch {
      return null;
    }
  }

  async function verifySavedOrderRecovery() {
    if (!restoreOrderButton) return;
    restoreOrderButton.hidden = true;
    const saved = readLatestSavedOrder();
    if (!saved) return;
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/v1/orders/${saved.orderId}`, {
        cache: "no-store",
        headers: { "X-Order-Token": saved.accessToken },
      });
      const order = await response.json().catch(() => ({}));
      if (!response.ok || order.status !== "succeeded" || !validHttpsUrl(order.subscriptionUrl)) return;
      restoreOrderButton.hidden = false;
    } catch {
      restoreOrderButton.hidden = true;
    }
  }

  const observer = new MutationObserver(() => {
    applyContinueCopy();
    applyTrialResultCopy();
  });
  observer.observe(form, { subtree: true, childList: true, characterData: true });
  if (resultPanel) observer.observe(resultPanel, { subtree: true, childList: true, characterData: true });

  setPaidControlsVisible(false);
  if (restoreOrderButton) restoreOrderButton.hidden = true;
  void verifySavedOrderRecovery();

  void fetch(`${config.apiBaseUrl}/api/v2/meta`, { cache: "no-store" })
    .then(async (response) => {
      const value = await response.json().catch(() => ({}));
      meta = response.ok ? value : null;
      applyTrialOnlyUi();
    })
    .catch(() => {
      meta = null;
      setPaidControlsVisible(false);
    });
})();
