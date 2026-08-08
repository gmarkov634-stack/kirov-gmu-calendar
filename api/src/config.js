import path from "node:path";

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 8080),
    allowedOrigin: env.ALLOWED_ORIGIN || "https://gmarkov634-stack.github.io",
    bucket: env.S3_BUCKET || "kgmu-calendar-data-gmarkov634",
    endpoint: env.S3_ENDPOINT || "https://s3.cloud.ru",
    region: env.S3_REGION || "ru-central-1",
    accessKeyId: env.S3_ACCESS_KEY_ID || "",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || "",
    dataDir: env.DATA_DIR || path.resolve("data"),
    cacheTtlMs: Number(env.CACHE_TTL_MS || 300000),
    publicSiteUrl: env.PUBLIC_SITE_URL || "https://gmarkov634-stack.github.io/kirov-gmu-calendar/",
    enablePublicEndpoints: env.ENABLE_PUBLIC_ENDPOINTS === "true",
  };
}
