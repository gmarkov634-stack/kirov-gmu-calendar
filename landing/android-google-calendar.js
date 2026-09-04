(() => {
  const GOOGLE_CALENDAR_ADD_BY_URL = "https://calendar.google.com/calendar/u/0/r/settings/addbyurl";
  const ANDROID_HELP = "Ссылка скопирована. Нажмите «Открыть в Chrome». В Chrome откройте меню ⋮ → «Версия для ПК», затем вставьте ссылку в поле URL календаря и нажмите «Добавить календарь». После добавления календарь синхронизируется с приложением Google Calendar.";
  const CHROME_INTENT = `intent://calendar.google.com/calendar/u/0/r/settings/addbyurl#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(GOOGLE_CALENDAR_ADD_BY_URL)};end`;

  function isAndroid() {
    return /Android/i.test(navigator.userAgent ?? "");
  }

  function applyAndroidHandoff() {
    if (!isAndroid()) return;

    const open = document.querySelector(".calendar-google-open");
    if (open) {
      if (open.getAttribute("href") !== CHROME_INTENT) open.setAttribute("href", CHROME_INTENT);
      if (open.hasAttribute("target")) open.removeAttribute("target");
      if (open.getAttribute("rel") !== "noopener noreferrer") open.setAttribute("rel", "noopener noreferrer");
      if (open.textContent !== "Открыть в Chrome") open.textContent = "Открыть в Chrome";
    }

    const help = document.querySelector(".calendar-google-help");
    if (help?.textContent?.trim() && help.textContent !== ANDROID_HELP) {
      help.textContent = ANDROID_HELP;
    }
  }

  const observer = new MutationObserver(applyAndroidHandoff);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("#copy-trial-url")
      : null;
    if (!target || target.textContent?.trim() !== "Добавить в Google Календарь") return;
    queueMicrotask(applyAndroidHandoff);
  }, true);

  applyAndroidHandoff();
})();
