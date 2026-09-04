(() => {
  const GOOGLE_CALENDAR_ADD_BY_URL = "https://calendar.google.com/calendar/u/0/r/settings/addbyurl";

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("#copy-trial-url")
      : null;
    if (!target || target.textContent?.trim() !== "Добавить в Google Календарь") return;

    // Open only Google's generic add-by-URL page. The private ICS URL stays on this page
    // and is copied by acquisition-ui.js; it is never included in the Google destination.
    window.open(GOOGLE_CALENDAR_ADD_BY_URL, "_blank", "noopener,noreferrer");
  }, true);
})();
