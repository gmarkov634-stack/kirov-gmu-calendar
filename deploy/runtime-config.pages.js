const MEDICINE_1_FACULTATIVES = Object.freeze([
  Object.freeze({
    facultativeId: "kgmu-2026-2027-s1-medicine-facultative-biology",
    label: "Актуальные вопросы биологии"
  }),
  Object.freeze({
    facultativeId: "kgmu-2026-2027-s1-medicine-facultative-chemistry",
    label: "Основы химии"
  }),
  Object.freeze({
    facultativeId: "kgmu-2026-2027-s1-medicine-facultative-physics",
    label: "Физика"
  }),
  Object.freeze({
    facultativeId: "kgmu-2026-2027-s1-medicine-facultative-math",
    label: "Математика"
  }),
  Object.freeze({
    facultativeId: "kgmu-2026-2027-s1-medicine-facultative-russian",
    label: "Русский язык и культура речи"
  })
]);

const MEDICINE_1_FACULTATIVE_CATALOG = Object.freeze(Object.fromEntries(
  [
    "101", "102", "103", "104", "105", "106", "107", "108", "109", "110",
    "111", "112", "113", "114", "115", "116", "117", "118", "119", "120"
  ].map((groupId) => [groupId, MEDICINE_1_FACULTATIVES])
));

window.KGMU_CALENDAR_CONFIG = Object.freeze({
  apiBase: "https://176-123-165-120.sslip.io",
  universityId: "kirov-gmu",
  academicYearId: "2026-2027",
  academicPeriodId: "2026-2027-semester-1",
  catalogUrl: "./catalog/2026-2027-semester-1.json",
  annualSalesCutoff: "2026-12-31T21:00:00.000Z",
  managementSessionTransport: "bearer",
  academicPeriodLabels: Object.freeze({
    "2026-2027-semester-1": "1 семестр"
  }),
  electiveCatalog: Object.freeze({}),
  facultativeCatalog: Object.freeze({
    "2026-2027-semester-1": MEDICINE_1_FACULTATIVE_CATALOG
  }),
  trialEnabled: true,
  managementEnabled: true,
  checkoutEnabled: true
});

(() => {
  if (typeof globalThis.fetch !== "function") return;

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
