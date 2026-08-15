# Managed VK token wiring

Production VK handlers share one `VkTokenManager` backed by `VkTokenVault` for VK ID user OAuth credentials:

- OAuth callback saves verified access/refresh credentials only when `VK_OAUTH_ENCRYPTION_KEY` is configured;
- public wall reads use the managed access token and refresh it automatically;
- GitHub OIDC `wall.list`, `wall.edit`, `wall.delete`, `wall.pin` and `wall.unpin` currently use the managed user token;
- `wall.post` is routed separately through the existing community `VK_ACCESS_TOKEN` for the configured community only, because the production VK ID token successfully reads the wall but VK API 5.199 returns error 1051 for `wall.post` with that profile type;
- `wall.post` must fail closed when the community token is absent and must never fall back to the managed user token;
- `wall.list` must never fall back to the community token;
- legacy `VK_USER_ACCESS_TOKEN` remains an explicit compatibility fallback for user-token operations only.

This wiring must be instantiated in `api/src/server.js`; defining the vault/manager classes alone is insufficient. Community-token publication remains an observed-production compatibility boundary and must be regression-tested independently from managed OAuth reads.
