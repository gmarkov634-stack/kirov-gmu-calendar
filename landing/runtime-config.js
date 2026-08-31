window.KGMU_CALENDAR_CONFIG = Object.freeze({
  apiBase: "",
  universityId: "kirov-gmu",
  academicYearId: "2026-2027",
  academicPeriodId: "2026-2027-semester-1",
  catalogUrl: "../catalog/2026-2027-semester-1.json",
  academicPeriodLabels: {},
  electiveCatalog: {},
  facultativeCatalog: {},
  trialEnabled: false,
  managementEnabled: false,
  checkoutEnabled: false
});

(() => {
  const STORAGE_KEY = "kgmu-calendar:trial-browser-id-v1";
  const BROWSER_ID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  let memoryBrowserId = null;

  function createBrowserId() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    if (typeof globalThis.crypto?.getRandomValues !== "function") {
      throw new Error("Secure browser identity generation is unavailable");
    }
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  function browserId() {
    if (memoryBrowserId) return memoryBrowserId;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && BROWSER_ID.test(stored)) {
        memoryBrowserId = stored.toLowerCase();
        return memoryBrowserId;
      }
    } catch {
      // Storage can be unavailable in restrictive privacy modes.
    }

    memoryBrowserId = createBrowserId().toLowerCase();
    try {
      localStorage.setItem(STORAGE_KEY, memoryBrowserId);
    } catch {
      // Keep the in-memory identity for the current page when storage is unavailable.
    }
    return memoryBrowserId;
  }

  function requestUrl(input) {
    if (typeof input === "string") return new URL(input, window.location.href);
    if (input instanceof URL) return input;
    if (input instanceof Request) return new URL(input.url, window.location.href);
    return null;
  }

  globalThis.fetch = (input, init = {}) => {
    const url = requestUrl(input);
    const method = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!url?.pathname.endsWith("/trial") || method !== "POST") {
      return nativeFetch(input, init);
    }

    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("X-Trial-Browser-Id", browserId());
    return nativeFetch(input, { ...init, headers });
  };
})();
