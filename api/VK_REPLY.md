# VK test reply

The production callback remains passive for ordinary messages.

A single explicit command is enabled for connection testing:

```text
/calendar-test
```

When `VK_ACCESS_TOKEN` is configured, the bot replies:

```text
calendar-api подключён ✅
```

Required environment variable:

```text
VK_ACCESS_TOKEN=<Cloud.ru community secret reference>
```

`VK_ACCESS_TOKEN` is the community token used for Callback API / messaging only. Wall reads and wall management must use the separate `VK_USER_ACCESS_TOKEN` described in `ops/vk/README.md`; wall code must not fall back to this community token.

Optional API version override:

```text
VK_API_VERSION=5.199
```

Do not commit either VK access token itself.
