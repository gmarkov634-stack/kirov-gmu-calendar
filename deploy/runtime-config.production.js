const MEDICINE_1_FACULTATIVES = Object.freeze([
  Object.freeze({ facultativeId: "kgmu-2026-2027-s1-medicine-facultative-biology", label: "Актуальные вопросы биологии" }),
  Object.freeze({ facultativeId: "kgmu-2026-2027-s1-medicine-facultative-chemistry", label: "Основы химии" }),
  Object.freeze({ facultativeId: "kgmu-2026-2027-s1-medicine-facultative-physics", label: "Физика" }),
  Object.freeze({ facultativeId: "kgmu-2026-2027-s1-medicine-facultative-math", label: "Математика" }),
  Object.freeze({ facultativeId: "kgmu-2026-2027-s1-medicine-facultative-russian", label: "Русский язык и культура речи" })
]);

const MEDICINE_1_FACULTATIVE_CATALOG = Object.freeze(Object.fromEntries(
  ["101", "102", "103", "104", "105", "106", "107", "108", "109", "110", "111", "112", "113", "114", "115", "116", "117", "118", "119", "120"]
    .map((groupId) => [groupId, MEDICINE_1_FACULTATIVES])
));

const DENTISTRY_1_FACULTATIVES = Object.freeze([
  Object.freeze({ facultativeId: "kgmu-2026-2027-s1-dentistry-facultative-biology", label: "Актуальные вопросы биологии" }),
  Object.freeze({ facultativeId: "kgmu-2026-2027-s1-dentistry-facultative-russian", label: "Русский язык и культура речи" }),
  Object.freeze({ facultativeId: "kgmu-2026-2027-s1-dentistry-facultative-physics", label: "Физика" }),
  Object.freeze({ facultativeId: "kgmu-2026-2027-s1-dentistry-facultative-math", label: "Математика" })
]);

const DENTISTRY_1_FACULTATIVE_CATALOG = Object.freeze(Object.fromEntries(
  ["191", "192", "193", "194"].map((groupId) => [groupId, DENTISTRY_1_FACULTATIVES])
));

const SEMESTER_1_FACULTATIVE_CATALOG = Object.freeze({
  ...MEDICINE_1_FACULTATIVE_CATALOG,
  ...DENTISTRY_1_FACULTATIVE_CATALOG
});

window.KGMU_CALENDAR_CONFIG = Object.freeze({
  apiBase: "",
  universityId: "kirov-gmu",
  academicYearId: "2026-2027",
  academicPeriodId: "2026-2027-semester-1",
  catalogUrl: "../catalog/2026-2027-semester-1.json",
  annualSalesCutoff: "2026-12-31T21:00:00.000Z",
  academicPeriodLabels: Object.freeze({ "2026-2027-semester-1": "1 семестр" }),
  electiveCatalog: globalThis.KGMU_ELECTIVE_CATALOG ?? Object.freeze({}),
  facultativeCatalog: Object.freeze({ "2026-2027-semester-1": SEMESTER_1_FACULTATIVE_CATALOG }),
  trialEnabled: true,
  managementEnabled: true,
  checkoutEnabled: false
});

(() => {
  if (typeof globalThis.fetch !== "function") return;

  const STORAGE_KEY = "kgmu-calendar:trial-browser-id-v1";
  const BROWSER_ID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  let memoryBrowserId = null;

  function createBrowserId() {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    if (typeof globalThis.crypto?.getRandomValues !== "function") throw new Error("Secure browser identity generation is unavailable");
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
    } catch {}
    memoryBrowserId = createBrowserId().toLowerCase();
    try { localStorage.setItem(STORAGE_KEY, memoryBrowserId); } catch {}
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
    if (!url?.pathname.endsWith("/trial") || method !== "POST") return nativeFetch(input, init);
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("X-Trial-Browser-Id", browserId());
    return nativeFetch(input, { ...init, headers });
  };
})();
