const MEDICINE_101_110_FACULTATIVES = Object.freeze([
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

const MEDICINE_101_110_FACULTATIVE_CATALOG = Object.freeze(Object.fromEntries(
  ["101", "102", "103", "104", "105", "106", "107", "108", "109", "110"]
    .map((groupId) => [groupId, MEDICINE_101_110_FACULTATIVES])
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
    "2026-2027-semester-1": MEDICINE_101_110_FACULTATIVE_CATALOG
  }),
  trialEnabled: true,
  managementEnabled: true,
  checkoutEnabled: true
});
