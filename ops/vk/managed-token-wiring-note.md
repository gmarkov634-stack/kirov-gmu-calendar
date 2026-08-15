# Managed VK token wiring

Production VK handlers share one `VkTokenManager` backed by `VkTokenVault`:

- OAuth callback saves verified access/refresh credentials only when `VK_OAUTH_ENCRYPTION_KEY` is configured;
- public wall reads use the managed access token and refresh it automatically;
- GitHub OIDC control commands (`wall.list/post/edit/delete/pin/unpin`) use the same managed token;
- community `VK_ACCESS_TOKEN` is never used as a fallback for wall operations;
- legacy `VK_USER_ACCESS_TOKEN` remains an explicit compatibility fallback only.

This wiring must be instantiated in `api/src/server.js`; defining the vault/manager classes alone is insufficient.
