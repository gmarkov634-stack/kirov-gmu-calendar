# Managed VK token wiring

Production VK handlers share one `VkTokenManager` backed by `VkTokenVault` for VK ID user OAuth credentials:

- OAuth callback saves verified access/refresh credentials only when `VK_OAUTH_ENCRYPTION_KEY` is configured;
- public wall reads use the managed access token and refresh it automatically;
- GitHub OIDC `wall.list` and `wall.edit` currently use the managed user token (or the legacy explicit user-token fallback);
- `wall.post` is routed separately through the existing community `VK_ACCESS_TOKEN` for the configured community only: the production VK ID token returned VK error 1051 for `wall.post`, while the community token successfully created post #64;
- production `wall.delete` with the managed VK ID token also returned error 1051, so `wall.delete` is routed through the community token as an isolated compatibility probe; support must be confirmed by a real production delete before this boundary is considered stable;
- `wall.pin` is not available through either configured token class in production: managed VK ID returned error 1051 and community token returned error 27; therefore `wall.pin` and `wall.unpin` are fail-closed at the control boundary and do not call VK;
- community-token actions must fail closed when `VK_ACCESS_TOKEN` is absent and must never fall back to the managed user token;
- `wall.list` must never fall back to the community token;
- `wall.edit` remains a user-token operation until independently verified in production;
- legacy `VK_USER_ACCESS_TOKEN` remains an explicit compatibility fallback for user-token operations only.

This wiring must be instantiated in `api/src/server.js`; defining the vault/manager classes alone is insufficient. Each token-class boundary must be regression-tested and then verified against production VK separately; successful support for one wall method is not assumed to imply support for another. Pinning currently requires a manual action in the VK interface.
