const UNIVERSITIES = Object.freeze({
  kgmu: Object.freeze({
    id: "kgmu",
    code: "kgmu",
    name: "Кировский государственный медицинский университет",
    shortName: "КГМУ",
    timezone: "Europe/Kirov",
    timeMode: "floating",
    source: Object.freeze({
      kind: "xlsx",
      primaryPage: null,
      adapter: "kgmu",
    }),
    sitePath: "/",
    active: true,
    catalogEnabled: true,
  }),
  omgmu: Object.freeze({
    id: "omgmu",
    code: "omgmu",
    name: "Омский государственный медицинский университет",
    shortName: "ОмГМУ",
    timezone: "Asia/Omsk",
    timeMode: "floating",
    source: Object.freeze({
      kind: "pdf",
      primaryPage: "https://omsk-osma.ru/studentam/raspisanie-zanyatiy",
      examsPage: "https://omsk-osma.ru/studentam/raspisanie-ekzamenov",
      adapter: "omgmu",
      productionLanguage: "ru",
      versionIdentity: Object.freeze(["source_page", "source_url", "sha256"]),
    }),
    programs: Object.freeze([
      Object.freeze({ id: "medicine", name: "Лечебное дело", initialScope: true }),
      Object.freeze({ id: "foreign_medicine", name: "Лечебное дело для иностранных граждан", initialScope: true }),
      Object.freeze({ id: "pediatrics", name: "Педиатрия", initialScope: true }),
      Object.freeze({ id: "preventive_medicine", name: "Медико-профилактическое дело", initialScope: true }),
      Object.freeze({ id: "dentistry", name: "Стоматология", initialScope: true }),
      Object.freeze({ id: "pharmacy", name: "Фармация", initialScope: true }),
      Object.freeze({ id: "public_health_master", name: "Общественное здравоохранение", initialScope: false }),
      Object.freeze({ id: "psychology_master", name: "Психология", initialScope: false }),
    ]),
    sitePath: "/omgmu/",
    active: false,
    catalogEnabled: true,
  }),
  izhgmu: Object.freeze({
    id: "izhgmu",
    code: "izhgmu",
    name: "Ижевский государственный медицинский университет",
    shortName: "Ижевский ГМУ",
    timezone: "Europe/Samara",
    timeMode: "floating",
    source: Object.freeze({
      kind: "spreadsheet",
      acceptedContainers: Object.freeze(["xlsx", "xls"]),
      primaryPage: "https://www.igma.ru/component/content/article/647-raspisanie?Itemid=108&catid=132",
      adapter: "izhgmu",
      acquisition: "github-actions",
      versionIdentity: Object.freeze(["source_page", "source_url", "sha256"]),
    }),
    programs: Object.freeze([
      Object.freeze({ id: "medicine", name: "Лечебный факультет", initialScope: true }),
      Object.freeze({ id: "pediatrics", name: "Педиатрический факультет", initialScope: false }),
      Object.freeze({ id: "dentistry", name: "Стоматологический факультет", initialScope: false }),
    ]),
    sitePath: "/izhgmu/",
    active: false,
    catalogEnabled: false,
  }),
});

export function listUniversities() {
  return Object.values(UNIVERSITIES);
}

export function getUniversityConfig(id) {
  const normalized = String(id || "").trim().toLowerCase();
  const config = UNIVERSITIES[normalized];
  if (!config) throw new Error(`Unknown university: ${id}`);
  return config;
}

export function hasUniversity(id) {
  const normalized = String(id || "").trim().toLowerCase();
  return Boolean(UNIVERSITIES[normalized]);
}

export { UNIVERSITIES };