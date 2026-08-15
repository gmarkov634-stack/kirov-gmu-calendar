import path from "node:path";

function parseWatchSemesters(value) {
  const semesters = [...new Set(
    String(value || "1,2")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => item === 1 || item === 2),
  )].sort();
  return semesters.length ? semesters : [1, 2];
}

export function loadConfig(env = process.env) {
  const defaultOrigin = "https://gmarkov634-stack.github.io";
  const allowedOrigins = String(env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || defaultOrigin)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const yearExpiresAt = env.OFFER_YEAR_EXPIRES_AT || "2027-08-31T23:59:59+03:00";

  return {
    port: Number(env.PORT || 8080),
    allowedOrigin: allowedOrigins[0] || defaultOrigin,
    allowedOrigins,
    bucket: env.S3_BUCKET || "kgmu-calendar-data-gmarkov634",
    endpoint: env.S3_ENDPOINT || "https://s3.cloud.ru",
    region: env.S3_REGION || "ru-central-1",
    accessKeyId: env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || "",
    dataDir: env.DATA_DIR || path.resolve("data"),
    // current.json is shared mutable state. Replica-local caching can make
    // publication diff/versioning and tokenized ICS reads observe old pointers.
    cacheTtlMs: 0,
    universitySiteUrls: {
      kgmu: env.KGMU_SITE_URL || "",
      omgmu: env.OMGMU_SITE_URL || "",
      pgmu: env.PGMU_SITE_URL || "",
    },
    publicApiUrl: env.PUBLIC_API_URL || "",
    enablePublicEndpoints: env.ENABLE_PUBLIC_ENDPOINTS === "true",
    yookassaShopId: env.YOOKASSA_SHOP_ID || "",
    yookassaSecretKey: env.YOOKASSA_SECRET_KEY || "",
    yookassaTestMode: env.YOOKASSA_TEST_MODE === "true",
    commercialSalesEnabled: env.COMMERCIAL_SALES_ENABLED === "true",
    trialsEnabled: env.TRIALS_ENABLED === "true",
    funnelAnalyticsEnabled: env.FUNNEL_ANALYTICS_ENABLED === "true",
    subscriptionSigningSecret: env.SUBSCRIPTION_SIGNING_SECRET || "",
    adminToken: env.ADMIN_TOKEN || "",
    suspiciousSourceThreshold: Number(env.SUSPICIOUS_SOURCE_THRESHOLD || 8),
    emailSmtpHost: env.EMAIL_SMTP_HOST || "",
    emailSmtpPort: Number(env.EMAIL_SMTP_PORT || 465),
    emailSmtpUser: env.EMAIL_SMTP_USER || "",
    emailSmtpPassword: env.EMAIL_SMTP_PASSWORD || "",
    emailSmtpTimeoutMs: Math.max(1000, Number(env.EMAIL_SMTP_TIMEOUT_MS || 10000)),
    emailFrom: env.EMAIL_FROM || env.EMAIL_SMTP_USER || "",
    emailFromName: env.EMAIL_FROM_NAME || "Календарь КГМУ",
    emailTo: env.EMAIL_TO || "",
    kgmuAdminUrl: env.KGMU_ADMIN_URL || "https://gmarkov634-stack.github.io/kirov-gmu-calendar/admin.html",
    kgmuXlsxMaxBytes: Number(env.KGMU_XLSX_MAX_BYTES || 25 * 1024 * 1024),
    kgmuAutoPublish: env.KGMU_AUTO_PUBLISH === "true",
    kgmuManualNormalization: env.KGMU_MANUAL_NORMALIZATION !== "false",
    kgmuXlsxParserEnabled: env.KGMU_XLSX_PARSER_ENABLED === "true",
    kgmuReviewedVerifySource: env.KGMU_REVIEWED_VERIFY_SOURCE !== "false",
    kgmuWatchEnabled: env.KGMU_WATCH_ENABLED === "true",
    kgmuWatchIntervalMs: Math.max(60000, Number(env.KGMU_WATCH_INTERVAL_MS || 900000)),
    kgmuWatchSemesters: parseWatchSemesters(env.KGMU_WATCH_SEMESTERS),
    kgmuParserRevision: env.KGMU_PARSER_REVISION || "g20-reviewed-json-v1",
    kgmuMedicineSchedulePage: env.KGMU_MEDICINE_SCHEDULE_PAGE || "https://kirovgma.ru/lechebnyy-fakultet-raspisanie",
    kgmuPediatricsSchedulePage: env.KGMU_PEDIATRICS_SCHEDULE_PAGE || "https://kirovgma.ru/raspisanie-pediatricheskiy-fakultet",
    kgmuDentistrySchedulePage: env.KGMU_DENTISTRY_SCHEDULE_PAGE || "https://kirovgma.ru/raspisanie-stomatologicheskiy-fakultet",
    kgmuForeignSchedulePage: env.KGMU_FOREIGN_SCHEDULE_PAGE || "https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya",
    offerAcademicYear: env.OFFER_ACADEMIC_YEAR || "2026/27",
    offerSemester: Number(env.OFFER_SEMESTER || 1),
    offers: {
      semester: {
        id: "semester",
        price: env.OFFER_SEMESTER_PRICE || env.OFFER_PRICE || "299.00",
      },
      year: {
        id: "year",
        price: env.OFFER_YEAR_PRICE || "499.00",
        expiresAt: yearExpiresAt,
      },
    },
    yookassaSendReceipt: env.YOOKASSA_SEND_RECEIPT === "true",
    receiptVatCode: Number(env.RECEIPT_VAT_CODE || 1),
  };
}
