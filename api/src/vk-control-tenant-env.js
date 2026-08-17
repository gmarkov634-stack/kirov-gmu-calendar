const CONTROL_ENV_KEYS = [
  "VK_CALLBACK_GROUP_ID",
  "VK_ACCESS_TOKEN",
  "VK_USER_ACCESS_TOKEN",
];

export function createVkControlTenantEnv(env = process.env, tenant = "") {
  const prefix = String(tenant || "").trim().toUpperCase();
  if (!/^[A-Z0-9_]+$/.test(prefix)) {
    throw new Error("invalid_vk_tenant_prefix");
  }

  const scoped = {};
  for (const key of CONTROL_ENV_KEYS) {
    scoped[key] = String(env[`${prefix}_${key}`] || "").trim();
  }
  scoped.VK_API_VERSION = String(env[`${prefix}_VK_API_VERSION`] || env.VK_API_VERSION || "").trim();
  return scoped;
}
