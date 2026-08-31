(() => {
  const STORAGE_KEY = "kgmu-calendar:trial-browser-id-v1";
  const BROWSER_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
  const previousFetch = globalThis.fetch.bind(globalThis);
  let fallbackBrowserId = null;

  function generateBrowserId() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    if (typeof globalThis.crypto?.getRandomValues !== "function") {
      throw new Error("Secure browser randomness is unavailable.");
    }
    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function browserTrialId() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && BROWSER_ID_PATTERN.test(stored)) return stored;

      const created = generateBrowserId();
      localStorage.setItem(STORAGE_KEY, created);
      return created;
    } catch {
      if (!fallbackBrowserId) fallbackBrowserId = generateBrowserId();
      return fallbackBrowserId;
    }
  }

  function requestUrl(input) {
    if (typeof input === "string") return new URL(input, window.location.href);
    if (input instanceof URL) return input;
    if (input && typeof input.url === "string") return new URL(input.url, window.location.href);
    return null;
  }

  globalThis.fetch = async (input, init = {}) => {
    const url = requestUrl(input);
    const method = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const isTrial = url?.pathname.endsWith("/trial") && method === "POST";
    if (!isTrial || typeof init.body !== "string") {
      return previousFetch(input, init);
    }

    let body;
    try {
      body = JSON.parse(init.body);
    } catch {
      return previousFetch(input, init);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return previousFetch(input, init);
    }

    const legacyBody = { ...body };
    delete legacyBody.browserTrialId;
    const requestWithBrowser = {
      ...init,
      body: JSON.stringify({
        ...legacyBody,
        browserTrialId: browserTrialId()
      })
    };

    const response = await previousFetch(input, requestWithBrowser);
    if (response.status !== 400) return response;

    const payload = await response.clone().json().catch(() => null);
    if (payload?.error !== "invalid_trial_request") return response;

    // Compatibility bridge for the pre-browser-binding core. The old core
    // rejects the new field before provisioning anything, so one retry without
    // the field cannot create a duplicate trial. Once the new core is live,
    // browserTrialId is required and this retry remains rejected.
    return previousFetch(input, {
      ...init,
      body: JSON.stringify(legacyBody)
    });
  };
})();
