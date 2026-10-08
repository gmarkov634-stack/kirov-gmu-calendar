(() => {
  const COPY_LABEL = "Скопировать для Google Calendar";
  const COPY_HELP = "Ссылка скопирована. В веб-версии Google Календаря откройте «Другие календари» → «+» → «По URL», вставьте ссылку и нажмите «Добавить календарь».";
  const COPY_FAILED_HELP = "Не удалось скопировать автоматически. Скопируйте ссылку из поля выше. Затем в веб-версии Google Календаря откройте «Другие календари» → «+» → «По URL» и вставьте ссылку.";

  function applyCopyOnlyHandoff() {
    const copy = document.querySelector("#copy-trial-url");
    if (
      copy?.dataset.calendarActionsReady === "true"
      && copy.textContent?.trim() === "Добавить в Google Календарь"
    ) {
      copy.textContent = COPY_LABEL;
    }

    // Google Calendar onboarding is intentionally copy-only. Do not navigate away
    // or expose a secondary opener after the protected ICS URL has been copied.
    document.querySelector(".calendar-google-open")?.remove();

    const help = document.querySelector(".calendar-google-help");
    if (!help) return;
    const message = help.textContent?.trim() ?? "";
    if (message === "Ссылка скопирована. Вставьте её в поле URL календаря и нажмите «Добавить календарь».") {
      help.textContent = COPY_HELP;
    } else if (message.startsWith("Не удалось скопировать автоматически.")) {
      help.textContent = COPY_FAILED_HELP;
    }
  }

  const observer = new MutationObserver(applyCopyOnlyHandoff);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["data-calendar-actions-ready"]
  });

  applyCopyOnlyHandoff();
})();
