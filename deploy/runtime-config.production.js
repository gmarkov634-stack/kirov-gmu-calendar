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

const MEDICINE_3_ELECTIVE_SELECTIONS = Object.freeze([
  Object.freeze({
    selectionId: "medicine-3-choice-discipline-2026-s1",
    label: "Дисциплина по выбору",
    alternatives: Object.freeze([
      Object.freeze({ value: "biochemical-healthy-lifestyle", label: "Биохимические основы здорового образа жизни" }),
      Object.freeze({ value: "dietology", label: "Диетология" }),
      Object.freeze({ value: "latin-pharmaceutical-terminology", label: "Латинская фармацевтическая терминология" }),
      Object.freeze({ value: "intercultural-professional-communication", label: "Межкультурная профессиональная коммуникация" }),
      Object.freeze({ value: "molecular-pathology", label: "Молекулярные механизмы в патологии человека" }),
      Object.freeze({ value: "functional-diagnostics", label: "Современные методы функциональной диагностики донозологических состояний человека" }),
      Object.freeze({ value: "statistical-evidence-medicine", label: "Статистические методы в доказательной медицине с использованием информационных технологий" })
    ])
  })
]);

const MEDICINE_3_ELECTIVE_CATALOG = Object.freeze(Object.fromEntries(
  [
    "301", "302", "303", "304", "305", "306", "307", "308", "309", "310",
    "311", "312", "313", "314", "315", "316", "317"
  ].map((groupId) => [groupId, MEDICINE_3_ELECTIVE_SELECTIONS])
));

window.KGMU_CALENDAR_CONFIG = Object.freeze({
  apiBase: "",
  universityId: "kirov-gmu",
  academicYearId: "2026-2027",
  academicPeriodId: "2026-2027-semester-1",
  catalogUrl: "../catalog/2026-2027-semester-1.json",
  annualSalesCutoff: "2026-12-31T21:00:00.000Z",
  academicPeriodLabels: Object.freeze({
    "2026-2027-semester-1": "1 семестр"
  }),
  electiveCatalog: Object.freeze({
    "2026-2027-semester-1": MEDICINE_3_ELECTIVE_CATALOG
  }),
  facultativeCatalog: Object.freeze({
    "2026-2027-semester-1": MEDICINE_1_FACULTATIVE_CATALOG
  }),
  trialEnabled: true,
  managementEnabled: true,
  checkoutEnabled: false
});
