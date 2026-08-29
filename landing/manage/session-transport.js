(() => {
  const config = globalThis.KGMU_CALENDAR_CONFIG ?? {};
  if (config.managementSessionTransport !== "bearer") return;

  const apiOrigin = new URL(config.apiBase || window.location.origin, window.location.origin).origin;
  const storageKey = "kgmu.managementSessionToken.v1";
  const nativeFetch = window.fetch.bind(window);

  function storedToken() {
    try {
      const value = window.sessionStorage.getItem(storageKey);
      return typeof value === "string" && value.length >= 32 ? value : null;
    } catch {
      return null;
    }
  }

  function storeToken(token) {
    try {
      if (typeof token === "string" && token.length >= 32) {
        window.sessionStorage.setItem(storageKey, token);
      }
    } catch {
      // sessionStorage may be unavailable in hardened/private browser modes.
    }
  }

  function clearToken() {
    try {
      window.sessionStorage.removeItem(storageKey);
    } catch {
      // Keep the management flow usable even if storage access is blocked.
    }
  }

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

    const token = storedToken();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await nativeFetch(input, { ...init, headers });

    if (url.pathname === "/management/verify" && response.ok) {
      const payload = await response.clone().json().catch(() => null);
      storeToken(payload?.managementToken);
    }

    if (url.pathname === "/management/logout" || response.status === 401) {
      clearToken();
    }

    return response;
  };
})();
