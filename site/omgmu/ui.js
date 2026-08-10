(() => {
  const config = window.OMGMU_CONFIG;
  if (!config) return;

  const testBanner = document.querySelector('#test-banner');
  const isTestMode = config.testMode === true;
  document.body.classList.toggle('test-mode', isTestMode);
  if (testBanner) testBanner.hidden = !isTestMode;
})();
