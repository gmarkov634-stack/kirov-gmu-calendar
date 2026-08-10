(() => {
  const config = window.OMGMU_CONFIG;
  if (!config) return;

  const testBanner = document.querySelector('#test-banner');
  const isTestMode = config.testMode === true;
  document.body.classList.toggle('test-mode', isTestMode);
  if (testBanner) testBanner.hidden = !isTestMode;

  const previewTop = document.querySelector('.calendar-preview .preview-top');
  if (previewTop) {
    const label = previewTop.querySelector('span');
    const title = previewTop.querySelector('strong');
    if (label) label.textContent = 'Пример';
    if (title) title.textContent = 'Учебный день';
  }

  const currentScriptUrl = document.currentScript?.src;
  if (currentScriptUrl && !document.querySelector('link[rel="icon"]')) {
    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.type = 'image/svg+xml';
    favicon.href = new URL('favicon.svg', currentScriptUrl).href;
    document.head.append(favicon);
  }

  const robots = document.querySelector('meta[name="robots"]');
  function updateRobotsForPrivateState() {
    if (!robots) return;
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const privateState = hash === 'order-status' || params.has('order') || params.has('access');
    robots.content = privateState ? 'noindex,nofollow,noarchive' : 'index,follow';
  }

  updateRobotsForPrivateState();
  window.addEventListener('hashchange', updateRobotsForPrivateState);
})();
