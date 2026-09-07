(() => {
  const config = globalThis.KGMU_CALENDAR_CONFIG ?? {};
  const STORAGE_KEY = "kgmu-calendar:max-account-link-v1";
  const PENDING_TTL_MS = 15 * 60 * 1000;
  const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
  const statusNode = document.getElementById("management-status");
  let memoryPending = null;
  let completionPromise = null;

  function setStatus(message, kind = "") {
    if (!statusNode) return;
    statusNode.textContent = message;
    statusNode.className = `manage-status${kind ? ` ${kind}` : ""}`;
  }

  function clearStoredPending() {
    memoryPending = null;
    try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function validPending(value) {
    if (!value || typeof value !== "object") return null;
    if (!CREDENTIAL_PATTERN.test(value.token ?? "")) return null;
    if (!Number.isSafeInteger(value.capturedAt)) return null;
    const age = Date.now() - value.capturedAt;
    if (age < 0 || age >= PENDING_TTL_MS) return null;
    return { token: value.token, capturedAt: value.capturedAt };
  }

  function readPending() {
    const inMemory = validPending(memoryPending);
    if (inMemory) return inMemory;
    memoryPending = null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const stored = validPending(JSON.parse(raw));
      if (!stored) {
        window.localStorage.removeItem(STORAGE_KEY);
        return null;
      }
      memoryPending = stored;
      return stored;
    } catch {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
      return null;
    }
  }

  function storePending(token) {
    const pending = { token, capturedAt: Date.now() };
    memoryPending = pending;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pending)); } catch {}
    return pending;
  }

  function stripLinkTokenFromFragment() {
    const rawHash = window.location.hash.replace(/^#/, "");
    if (!rawHash) return null;
    const params = new URLSearchParams(rawHash);
    const tokens = params.getAll("link_token");
    if (!tokens.length) return null;
    params.delete("link_token");
    const remaining = params.toString();
    const cleanUrl = `${window.location.pathname}${window.location.search}${remaining ? `#${remaining}` : ""}`;
    window.history.replaceState(null, "", cleanUrl);
    return tokens.length === 1 ? tokens[0] : "";
  }

  const fragmentToken = stripLinkTokenFromFragment();
  if (fragmentToken !== null) {
    if (!CREDENTIAL_PATTERN.test(fragmentToken)) {
      clearStoredPending();
      setStatus("Ссылка MAX недействительна. Откройте новую ссылку в MAX.", "error");
    } else if (config.managementEnabled !== true) {
      clearStoredPending();
      setStatus("Привязка MAX сейчас недоступна.", "error");
    } else {
      storePending(fragmentToken);
      setStatus("Для привязки MAX подтвердите email. Одноразовая ссылка действует 15 минут.");
    }
  } else if (readPending()) {
    setStatus("После подтверждения email завершим привязку MAX автоматически.");
  }

  if (config.managementEnabled !== true || typeof window.fetch !== "function") return;

  const apiBase = new URL(config.apiBase || window.location.origin, window.location.origin);
  const apiOrigin = apiBase.origin;
  const nativeFetch = window.fetch.bind(window);

  function managementUrl(input) {
    const raw = input instanceof Request ? input.url : input;
    try {
      const url = new URL(raw, window.location.href);
      return url.origin === apiOrigin && url.pathname.startsWith("/management/") ? url : null;
    } catch {
      return null;
    }
  }

  async function completePendingLink() {
    const pending = readPending();
    if (!pending) return;
    if (completionPromise) return completionPromise;

    completionPromise = (async () => {
      let response;
      try {
        response = await nativeFetch(new URL("/management/max/link", apiBase).toString(), {
          method: "POST",
          mode: "cors",
          cache: "no-store",
          credentials: config.managementSessionTransport === "cookie" ? "include" : "omit",
          referrerPolicy: "no-referrer",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ linkToken: pending.token })
        });
      } catch {
        setStatus("Не удалось завершить привязку MAX. Повторите попытку в течение 15 минут.", "error");
        return;
      }

      if (response.status === 204) {
        clearStoredPending();
        setStatus("MAX успешно привязан к аккаунту календаря.", "success");
        return;
      }
      if (response.status === 400) {
        clearStoredPending();
        setStatus("Ссылка MAX недействительна или истекла. Откройте новую ссылку в MAX.", "error");
        return;
      }
      if (response.status === 409) {
        clearStoredPending();
        setStatus("Этот MAX-аккаунт уже привязан к другому аккаунту календаря.", "error");
        return;
      }
      if (response.status === 401) {
        setStatus("Сессия управления истекла. Подтвердите email ещё раз.", "error");
        return;
      }
      if (response.status === 429) {
        setStatus("Слишком много попыток привязки MAX. Подождите и повторите.", "error");
        return;
      }
      setStatus("Не удалось завершить привязку MAX. Повторите попытку в течение 15 минут.", "error");
    })().finally(() => {
      completionPromise = null;
    });

    return completionPromise;
  }

  window.fetch = async (input, init = {}) => {
    const response = await nativeFetch(input, init);
    const url = managementUrl(input);
    const method = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url?.pathname === "/management/subscriptions" && method === "GET" && response.ok) {
      await completePendingLink();
    }
    return response;
  };
})();
