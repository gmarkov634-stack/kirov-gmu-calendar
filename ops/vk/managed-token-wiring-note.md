# Managed VK token wiring

Production VK handlers share one `VkTokenManager` backed by `VkTokenVault` for VK ID user OAuth credentials:

- OAuth callback saves verified access/refresh credentials only when `VK_OAUTH_ENCRYPTION_KEY` is configured;
- public wall reads use the managed access token and refresh it automatically;
- GitHub OIDC `wall.list`, `wall.edit` and `wall.delete` currently use the managed user token (or the legacy explicit user-token fallback);
- `wall.post` is routed separately through the existing community `VK_ACCESS_TOKEN` for the configured community only, because the production VK ID token successfully reads the wall but VK API 5.199 returns error 1051 for `wall.post` with that profile type;
- production also returned error 1051 for `wall.pin` with the managed VK ID token, so `wall.pin` and `wall.unpin` are routed through the community token as an isolated compatibility boundary;
- community-token actions must fail closed when `VK_ACCESS_TOKEN` is absent and must never fall back to the managed user token;
- `wall.list` must never fall back to the community token;
- `wall.edit` and `wall.delete` remain user-token operations until independently verified in production;
- legacy `VK_USER_ACCESS_TOKEN` remains an explicit compatibility fallback for user-token operations only.

This wiring must be instantiated in `api/src/server.js`; defining the vault/manager classes alone is insufficient. Each token-class boundary must be regression-tested and then verified against production VK separately; successful support for one wall method is not assumed to imply support for another.
