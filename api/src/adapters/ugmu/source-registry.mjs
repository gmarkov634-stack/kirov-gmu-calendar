export const UGMU_SCHEDULE_INDEX = "https://usma.ru/obrazovatelnaya-deyatelnost/uchebno-metodicheskoe-upravlenie/raspisanie/";

export const UGMU_SOURCE_PAGES = Object.freeze({
  medicine: Object.freeze({
    program: "medicine",
    name: "Лечебное дело",
    page: "https://usma.ru/obrazovatelnaya-deyatelnost/uchebno-metodicheskoe-upravlenie/raspisanie/raspisanie-dlya-studentov-specialnosti-lechebnoe-delo/",
    initialScope: true,
  }),
  pediatrics: Object.freeze({
    program: "pediatrics",
    name: "Педиатрия",
    page: "https://usma.ru/obrazovatelnaya-deyatelnost/uchebno-metodicheskoe-upravlenie/raspisanie/raspisanie-dlya-studentov-specialnosti-pediatriya/",
    initialScope: false,
  }),
  dentistry: Object.freeze({
    program: "dentistry",
    name: "Стоматология",
    page: "https://usma.ru/obrazovatelnaya-deyatelnost/uchebno-metodicheskoe-upravlenie/raspisanie/raspisanie-dlya-studentov-specialnosti-stomatologiya/",
    initialScope: false,
  }),
  pharmacy: Object.freeze({
    program: "pharmacy",
    name: "Фармация",
    page: "https://usma.ru/obrazovatelnaya-deyatelnost/uchebno-metodicheskoe-upravlenie/raspisanie/raspisanie-dlya-studentov-specialnosti-farmaciya/",
    initialScope: false,
  }),
  preventive_medicine: Object.freeze({
    program: "preventive_medicine",
    name: "Медико-профилактическое дело",
    page: "https://usma.ru/obrazovatelnaya-deyatelnost/uchebno-metodicheskoe-upravlenie/raspisanie/raspisanie-dlya-studentov-specialnosti-mediko-profilakticheskoe-delo/",
    initialScope: false,
  }),
  clinical_psychology: Object.freeze({
    program: "clinical_psychology",
    name: "Клиническая психология",
    page: "https://usma.ru/obrazovatelnaya-deyatelnost/uchebno-metodicheskoe-upravlenie/raspisanie/raspisanie-dlya-studentov-psixologo-socialnoj-raboty-i-vysshego-sestrinskogo-obrazovaniya-klinicheskaya-psixologiya/",
    initialScope: false,
  }),
});

export const UGMU_SOURCE_POLICY = Object.freeze({
  pageHosts: Object.freeze(["usma.ru", "www.usma.ru"]),
  artifactHosts: Object.freeze(["usma.ru", "www.usma.ru"]),
  artifactPathPrefix: "/wp-content/uploads/",
  artifactExtension: ".pdf",
  productionLanguage: "ru",
  versionIdentity: Object.freeze(["source_page", "source_url", "sha256"]),
  semanticReviewRequired: true,
});

export function listUgmuSourcePages({ initialOnly = false } = {}) {
  const pages = Object.values(UGMU_SOURCE_PAGES);
  return initialOnly ? pages.filter((item) => item.initialScope) : pages;
}

export function getUgmuSourcePage(program) {
  return UGMU_SOURCE_PAGES[String(program || "").trim()] || null;
}

export function isTrustedUgmuArtifactUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (!UGMU_SOURCE_POLICY.artifactHosts.includes(url.hostname.toLowerCase())) return false;
  if (!url.pathname.startsWith(UGMU_SOURCE_POLICY.artifactPathPrefix)) return false;
  return url.pathname.toLowerCase().endsWith(UGMU_SOURCE_POLICY.artifactExtension);
}
