(() => {
  const config = globalThis.KGMU_CALENDAR_CONFIG ?? {};
  if (config.managementSessionTransport !== "bearer") return;

  const apiOrigin = new URL(config.apiBase || window.location.origin, window.location.origin).origin;
  const nativeFetch = window.fetch.bind(window);
  let managementToken = null;

  function managementUrl(input) {
    const raw = input instanceof Request ? input.url : input;
    const url = new URL(raw, window.location.href);
    return url.origin === apiOrigin && url.pathname.startsWith("/management/") ? url : null;
  }

  window.fetch = async (input, init = {}) => {
    const url = managementUrl(input);
    if (!url) return nativeFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    for (const [name, value] of new Headers(init.headers)) headers.set(name, value);

    if (managementToken && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${managementToken}`);
    }

    const response = await nativeFetch(input, { ...init, headers });

    if (url.pathname === "/management/verify" && response.ok) {
      const payload = await response.clone().json().catch(() => null);
      if (typeof payload?.managementToken === "string" && payload.managementToken.length >= 32) {
        managementToken = payload.managementToken;
      }
    }

    if (url.pathname === "/management/logout" || response.status === 401) {
      managementToken = null;
    }

    return response;
  };
})();
