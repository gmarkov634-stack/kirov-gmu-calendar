import path from "node:path";

export function loadConfig(env = process.env) {
  const defaultOrigin = "https://gmarkov634-stack.github.io";
  const allowedOrigins = String(env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || defaultOrigin)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const publicSiteUrl = env.PUBLIC_SITE_URL || "https://gmarkov634-stack.github.io/kirov-gmu-calendar/";
  const semesterExpiresAt = env.OFFER_SEMESTER_EXPIRES_AT || env.OFFER_EXPIRES_AT || "2027-01-31T23:59:59+03:00";
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
    cacheTtlMs: Number(env.CACHE_TTL_MS || 300000),
    publicSiteUrl,
    universitySiteUrls: {
      kgmu: env.KGMU_SITE_URL || publicSiteUrl,
      omgmu: env.OMGMU_SITE_URL || "",
      pgmu: env.PGMU_SITE_URL || "",
    },
    publicApiUrl: env.PUBLIC_API_URL || "https://kgmu-calendar-api.containerapps.ru",
    enablePublicEndpoints: env.ENABLE_PUBLIC_ENDPOINTS === "true",
    yookassaShopId: env.YOOKASSA_SHOP_ID || "",
    yookassaSecretKey: env.YOOKASSA_SECRET_KEY || "",
    yookassaTestMode: env.YOOKASSA_TEST_MODE === "true",
    subscriptionSigningSecret: env.SUBSCRIPTION_SIGNING_SECRET || "",
    adminToken: env.ADMIN_TOKEN || "",
    suspiciousSourceThreshold: Number(env.SUSPICIOUS_SOURCE_THRESHOLD || 8),
    offers: {
      semester: {
        id: "semester",
        price: env.OFFER_SEMESTER_PRICE || env.OFFER_PRICE || "299.00",
        expiresAt: semesterExpiresAt,
      },
      year: {
        id: "year",
        price: env.OFFER_YEAR_PRICE || "499.00",
        expiresAt: yearExpiresAt,
      },
    },
    offerPrice: env.OFFER_PRICE || "490.00",
    offerExpiresAt: env.OFFER_EXPIRES_AT || semesterExpiresAt,
    yookassaSendReceipt: env.YOOKASSA_SEND_RECEIPT === "true",
    receiptVatCode: Number(env.RECEIPT_VAT_CODE || 1),
  };
}
