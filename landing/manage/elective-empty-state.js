(() => {
  function relabelEmptyElectiveOptions() {
    document.querySelectorAll('.preference-field select option[value=""]').forEach((option) => {
      if (option.textContent?.trim() === "Показывать все варианты") {
        option.textContent = "Не выбрано — скрыть варианты";
      }
    });
  }

  new MutationObserver(relabelEmptyElectiveOptions)
    .observe(document.documentElement, { childList: true, subtree: true });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", relabelEmptyElectiveOptions, { once: true });
  } else {
    relabelEmptyElectiveOptions();
  }
})();
