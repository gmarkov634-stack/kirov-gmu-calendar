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
VK_ACCESS_TOKEN=<Cloud.ru secret reference>
```

Optional API version override:

```text
VK_API_VERSION=5.199
```

Do not commit the community access token itself.
