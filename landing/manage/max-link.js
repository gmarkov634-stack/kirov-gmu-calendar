const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{32,}$/;
const MAX_LINK_BRIDGE_CHANNEL = "kgmu-management-max-link-v1";

export const MAX_LINK_PENDING_STORAGE_KEY = "kgmu-management-pending-max-link";

function usesBearerSession(config) {
  return config.managementSessionTransport === "bearer";
}

function apiUrl(config, windowObj, path) {
  return new URL(path, config.apiBase || windowObj.location.origin).toString();
}

function validCredential(value) {
  return typeof value === "string" && CREDENTIAL_PATTERN.test(value);
}

function setStatus(documentObj, text, kind = "") {
  const node = documentObj?.querySelector?.("#management-status");
  if (!node) return;
  node.textContent = text;
  node.className = `manage-status${kind ? ` ${kind}` : ""}`;
}

function readPendingLinkToken(storage) {
  if (!storage) return null;
  try {
    const value = storage.getItem(MAX_LINK_PENDING_STORAGE_KEY);
    if (validCredential(value)) return value;
    if (value !== null) storage.removeItem(MAX_LINK_PENDING_STORAGE_KEY);
  } catch {}
  return null;
}

function savePendingLinkToken(storage, linkToken) {
  if (!storage || !validCredential(linkToken)) return;
  try { storage.setItem(MAX_LINK_PENDING_STORAGE_KEY, linkToken); } catch {}
}

function clearPendingLinkToken(storage, linkToken = null) {
  if (!storage) return;
  try {
    if (linkToken !== null && storage.getItem(MAX_LINK_PENDING_STORAGE_KEY) !== linkToken) return;
    storage.removeItem(MAX_LINK_PENDING_STORAGE_KEY);
  } catch {}
}

export function captureManagementFragments(windowObj) {
  const params = new URLSearchParams(windowObj.location.hash.replace(/^#/, ""));
  const magicToken = params.get("token");
  const linkToken = params.get("link_token");

  if (magicToken !== null || linkToken !== null) {
    windowObj.history.replaceState(
      null,
      "",
      `${windowObj.location.pathname}${windowObj.location.search}`
    );
  }

  return { magicToken, linkToken };
}

async function managementRequest({ config, windowObj, fetchImpl }, path, options = {}) {
  const headers = {
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers ?? {})
  };

  return fetchImpl(apiUrl(config, windowObj, path), {
    mode: "cors",
    credentials: usesBearerSession(config) ? "omit" : "include",
    cache: "no-store",
    ...options,
    headers
  });
}

function randomRequestId(windowObj) {
  if (typeof windowObj.crypto?.randomUUID === "function") return windowObj.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createBridge({ windowObj, storage, BroadcastChannelImpl, documentObj }) {
  if (typeof BroadcastChannelImpl !== "function") return null;
  const channel = new BroadcastChannelImpl(MAX_LINK_BRIDGE_CHANNEL);

  channel.addEventListener("message", (event) => {
    const message = event?.data;
    if (!message || typeof message !== "object") return;

    if (message.type === "request-pending-link" && typeof message.requestId === "string") {
      const pending = readPendingLinkToken(storage);
      if (!pending) return;
      channel.postMessage({
        type: "pending-link",
        requestId: message.requestId,
        linkToken: pending
      });
      return;
    }

    if (message.type === "max-link-resolved" && validCredential(message.linkToken)) {
      const pending = readPendingLinkToken(storage);
      if (pending !== message.linkToken) return;
      clearPendingLinkToken(storage, pending);
      if (message.outcome === "linked") {
        setStatus(documentObj, "MAX успешно привязан к вашему аккаунту.", "success");
      } else if (message.outcome === "expired") {
        setStatus(documentObj, "Ссылка MAX недействительна или истекла. Запросите новую ссылку в MAX.", "error");
      } else if (message.outcome === "conflict") {
        setStatus(documentObj, "Этот MAX-аккаунт уже связан с другим аккаунтом.", "error");
      }
    }
  });

  return channel;
}

function retainBridge(windowObj, channel) {
  if (!channel) return;
  const previous = windowObj.__KGMU_MAX_LINK_BRIDGE__;
  if (previous && previous !== channel && typeof previous.close === "function") previous.close();
  windowObj.__KGMU_MAX_LINK_BRIDGE__ = channel;
}

function releaseBridge(windowObj, channel) {
  if (!channel) return;
  if (windowObj.__KGMU_MAX_LINK_BRIDGE__ === channel) {
    delete windowObj.__KGMU_MAX_LINK_BRIDGE__;
  }
  channel.close();
}

function requestPendingLinkFromOtherTab(windowObj, channel, timeoutMs) {
  if (!channel) return Promise.resolve(null);
  const requestId = randomRequestId(windowObj);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.removeEventListener("message", onMessage);
      resolve(value);
    };
    const onMessage = (event) => {
      const message = event?.data;
      if (
        message?.type === "pending-link"
        && message.requestId === requestId
        && validCredential(message.linkToken)
      ) {
        finish(message.linkToken);
      }
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    channel.addEventListener("message", onMessage);
    channel.postMessage({ type: "request-pending-link", requestId });
  });
}

function notifyResolved(channel, linkToken, outcome) {
  channel?.postMessage?.({ type: "max-link-resolved", linkToken, outcome });
}

async function hasAuthenticatedSession(context) {
  const response = await managementRequest(context, "/management/subscriptions", { method: "GET" });
  if (response.status === 401) return false;
  if (!response.ok) throw new Error("management session check failed");
  return true;
}

async function verifyMagicToken(context, magicToken) {
  return managementRequest(context, "/management/verify", {
    method: "POST",
    body: JSON.stringify({ magicToken })
  });
}

async function completeMaxLink(context, linkToken) {
  return managementRequest(context, "/management/max/link", {
    method: "POST",
    body: JSON.stringify({ linkToken })
  });
}

export async function bootstrapMaxManagement({
  windowObj = window,
  documentObj = document,
  config = globalThis.KGMU_CALENDAR_CONFIG ?? {},
  fetchImpl = windowObj.fetch.bind(windowObj),
  storage = windowObj.sessionStorage,
  BroadcastChannelImpl = windowObj.BroadcastChannel,
  bridgeWaitMs = 350
} = {}) {
  const context = { config, windowObj, fetchImpl };
  const { magicToken, linkToken: fragmentLinkToken } = captureManagementFragments(windowObj);

  if (fragmentLinkToken !== null) {
    if (!validCredential(fragmentLinkToken)) {
      clearPendingLinkToken(storage);
      setStatus(documentObj, "Ссылка MAX имеет неверный формат. Запросите новую ссылку в MAX.", "error");
      return { magicVerified: false, maxLink: "invalid" };
    }
    savePendingLinkToken(storage, fragmentLinkToken);
  }

  let pendingLinkToken = readPendingLinkToken(storage);
  const bridge = createBridge({ windowObj, storage, BroadcastChannelImpl, documentObj });
  if (pendingLinkToken) retainBridge(windowObj, bridge);

  const bridgedPendingPromise = magicToken && !pendingLinkToken
    ? requestPendingLinkFromOtherTab(windowObj, bridge, bridgeWaitMs)
    : Promise.resolve(null);

  let magicVerified = false;
  if (magicToken !== null) {
    if (!validCredential(magicToken)) {
      setStatus(documentObj, "Ссылка подтверждения email недействительна, использована или истекла.", "error");
      retainBridge(windowObj, bridge);
      return { magicVerified: false, maxLink: pendingLinkToken ? "pending-auth" : "none" };
    }

    setStatus(documentObj, "Подтверждаем одноразовую ссылку…");
    const response = await verifyMagicToken(context, magicToken);
    if (!response.ok) {
      setStatus(documentObj, "Ссылка подтверждения email недействительна, использована или истекла.", "error");
      retainBridge(windowObj, bridge);
      return { magicVerified: false, maxLink: pendingLinkToken ? "pending-auth" : "none" };
    }
    magicVerified = true;
    setStatus(documentObj, "Email подтверждён.", "success");
  }

  if (!pendingLinkToken && magicVerified) {
    pendingLinkToken = await bridgedPendingPromise;
  }

  if (!pendingLinkToken) {
    releaseBridge(windowObj, bridge);
    return { magicVerified, maxLink: "none" };
  }

  let authenticated = magicVerified;
  if (!authenticated) {
    try {
      authenticated = await hasAuthenticatedSession(context);
    } catch {
      setStatus(documentObj, "Не удалось проверить сессию управления. Попробуйте открыть ссылку MAX ещё раз.", "error");
      retainBridge(windowObj, bridge);
      return { magicVerified, maxLink: "session-check-failed" };
    }
  }

  if (!authenticated) {
    setStatus(
      documentObj,
      "Чтобы привязать MAX, сначала подтвердите email. Не закрывайте эту страницу; ссылку из письма откройте в новой вкладке.",
      "error"
    );
    retainBridge(windowObj, bridge);
    return { magicVerified, maxLink: "pending-auth" };
  }

  setStatus(documentObj, "Привязываем MAX к подтверждённому аккаунту…");
  const response = await completeMaxLink(context, pendingLinkToken);

  if (response.status === 204) {
    clearPendingLinkToken(storage, pendingLinkToken);
    notifyResolved(bridge, pendingLinkToken, "linked");
    setStatus(documentObj, "MAX успешно привязан к вашему аккаунту.", "success");
    releaseBridge(windowObj, bridge);
    return { magicVerified, maxLink: "linked" };
  }

  if (response.status === 401) {
    setStatus(documentObj, "Сессия управления истекла. Подтвердите email ещё раз, затем повторите привязку MAX.", "error");
    retainBridge(windowObj, bridge);
    return { magicVerified, maxLink: "pending-auth" };
  }

  if (response.status === 400) {
    clearPendingLinkToken(storage, pendingLinkToken);
    notifyResolved(bridge, pendingLinkToken, "expired");
    setStatus(documentObj, "Ссылка MAX недействительна или истекла. Запросите новую ссылку в MAX.", "error");
    releaseBridge(windowObj, bridge);
    return { magicVerified, maxLink: "expired" };
  }

  if (response.status === 409) {
    clearPendingLinkToken(storage, pendingLinkToken);
    notifyResolved(bridge, pendingLinkToken, "conflict");
    setStatus(documentObj, "Этот MAX-аккаунт уже связан с другим аккаунтом.", "error");
    releaseBridge(windowObj, bridge);
    return { magicVerified, maxLink: "conflict" };
  }

  setStatus(documentObj, "Не удалось завершить привязку MAX. Попробуйте открыть ссылку ещё раз.", "error");
  retainBridge(windowObj, bridge);
  return { magicVerified, maxLink: "failed" };
}
